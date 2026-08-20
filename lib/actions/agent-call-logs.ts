"use server";

import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { uploadFile, deleteFile } from "@/lib/storage";
import { canonicalPhone } from "@/lib/utils";
import { isDialablePhone } from "@/lib/validation";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { writeDb } from "@/lib/db";
import { requireUserLite } from "./guards";
import { isFullAccess } from "@/lib/permissions";
import { detectDateOrder, parseCallDate, type DateOrder } from "@/lib/call-date";

const PATH = "/call-logs";

export interface AgentUploadRowError {
  row: number;
  reason: string;
  value: string;
}

export interface AgentUploadSummary {
  /** Lets the caller attach the original file to this upload afterwards. */
  uploadId: string | null;
  total: number;
  imported: number;
  duplicates: number;
  invalid: number;
  failed: number;
  dateOrder: DateOrder;
  /** True when the file's date convention had to be inferred rather than read. */
  dateOrderAssumed: boolean;
  errors: AgentUploadRowError[];
}

export interface RawCallRow {
  row: number;
  call_name: string;
  phone: string;
  call_date: string;
}

const IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Imports an agent's call log.
 *
 * Every row is attributed to the logged-in agent — the file has no say in it,
 * so an agent cannot file calls against someone else. Rejected rows are never
 * counted towards the daily total; the summary reports them separately with
 * the row number and the offending value so the file can be corrected. */
export async function importAgentCallLogAction(rows: RawCallRow[], fileName: string): Promise<AgentUploadSummary> {
  const { user, db } = await requireUserLite();

  // One pass to settle the file's date convention, then a second to apply it.
  const rawDates = rows.map((r) => r.call_date);
  const dateOrder = detectDateOrder(rawDates);
  const unambiguous = rawDates.some((v) => {
    const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(String(v ?? "").trim());
    return m && (Number(m[1]) > 12 || Number(m[2]) > 12);
  });

  const errors: AgentUploadRowError[] = [];
  const valid: { call_name: string; phone_raw: string; phone_normalized: string; call_date: string }[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  for (const r of rows) {
    const phoneRaw = String(r.phone ?? "").trim();
    if (!phoneRaw) {
      errors.push({ row: r.row, reason: "Phone number is required", value: phoneRaw });
      continue;
    }
    // A call log is matched to a customer on the number and nothing else, so a
    // row carrying something that is not a number records a call against
    // nobody. "Any digit at all" let those through; a real mobile is the bar.
    if (!isDialablePhone(phoneRaw)) {
      errors.push({ row: r.row, reason: "Not a mobile number — expected something like 09171234567", value: phoneRaw });
      continue;
    }
    const parsed = parseCallDate(r.call_date, dateOrder);
    if (!parsed.date) {
      errors.push({ row: r.row, reason: parsed.reason || "Unreadable call date", value: String(r.call_date ?? "") });
      continue;
    }
    const phone = canonicalPhone(phoneRaw);
    const key = `${phone}|${parsed.date}`;
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    valid.push({ call_name: String(r.call_name ?? "").trim(), phone_raw: phoneRaw, phone_normalized: phone, call_date: parsed.date });
  }

  // Rows already stored for this agent on the same number and day are
  // duplicates too, not just repeats inside the file.
  let imported = 0;
  let failed = 0;
  let uploadId: string | null = null;

  const { data: upload, error: uploadError } = await supabaseAdmin
    .from("agent_call_log_uploads")
    .insert({
      agent_id: user.id,
      file_name: fileName,
      total_rows: rows.length,
      imported_rows: 0,
      duplicate_rows: duplicates,
      invalid_rows: errors.length,
      failed_rows: 0,
    })
    .select("id")
    .single();
  if (uploadError) throw new Error(`Could not record the upload: ${uploadError.message}`);
  uploadId = upload.id as string;

  if (valid.length > 0) {
    const payload = valid.map((v) => ({ ...v, upload_id: uploadId, agent_id: user.id }));
    // ignoreDuplicates leans on the (agent, phone, date) unique index, so an
    // already-stored call is skipped rather than failing the whole batch.
    const { data: inserted, error } = await supabaseAdmin
      .from("agent_call_log_records")
      .upsert(payload, { onConflict: "agent_id,phone_normalized,call_date", ignoreDuplicates: true })
      .select("id");
    if (error) {
      failed = valid.length;
    } else {
      imported = (inserted || []).length;
      duplicates += valid.length - imported;
    }
  }

  await supabaseAdmin
    .from("agent_call_log_uploads")
    .update({ imported_rows: imported, duplicate_rows: duplicates, invalid_rows: errors.length, failed_rows: failed })
    .eq("id", uploadId);

  const info = await getRequestInfo();
  logActivity(db, user.id, "AGENT_CALL_LOG_UPLOADED", "call_log", uploadId, {
    file_name: fileName,
    total: rows.length,
    imported,
    duplicates,
    invalid: errors.length,
    failed,
  }, { module: "call_logs", ...info });
  await writeDb(db);

  return {
    uploadId,
    total: rows.length,
    imported,
    duplicates,
    invalid: errors.length,
    failed,
    dateOrder,
    dateOrderAssumed: !unambiguous,
    errors,
  };
}

/** Stores a call-log screenshot against the agent, in the private bucket. */
export async function uploadCallLogImageAction(formData: FormData) {
  const { user, db } = await requireUserLite();

  const file = formData.get("image") as File | null;
  const relatedDate = String(formData.get("related_call_date") || "").trim();
  if (!file || file.size === 0) {
    redirect(`${PATH}?error=${encodeURIComponent("Choose an image to upload.")}`);
  }
  if (!IMAGE_TYPES.includes(file!.type)) {
    redirect(`${PATH}?error=${encodeURIComponent("Images must be JPG, PNG or WEBP.")}`);
  }
  if (file!.size > MAX_IMAGE_BYTES) {
    redirect(`${PATH}?error=${encodeURIComponent("Images must be 10 MB or smaller.")}`);
  }

  const buffer = Buffer.from(await file!.arrayBuffer());
  const storagePath = `call-log-images/${user.id}/${Date.now()}-${file!.name.replace(/[^\w.-]/g, "_")}`;
  await uploadFile(storagePath, buffer);

  const { error } = await supabaseAdmin.from("call_log_images").insert({
    agent_id: user.id,
    storage_path: storagePath,
    original_filename: file!.name,
    file_size_bytes: file!.size,
    related_call_date: relatedDate || null,
  });
  if (error) {
    redirect(`${PATH}?error=${encodeURIComponent(`Could not save the image: ${error.message}`)}`);
  }

  const info = await getRequestInfo();
  logActivity(db, user.id, "CALL_LOG_IMAGE_UPLOADED", "call_log", null, {
    original_filename: file!.name,
    related_call_date: relatedDate || null,
  }, { module: "call_logs", ...info });
  await writeDb(db);

  redirect(`${PATH}?image_uploaded=1`);
}

/** Stores the original file behind an upload, after its rows are imported.
 *
 * Kept as a second step rather than folded into the import: the import sends
 * parsed rows, and pushing the raw bytes through the same call would put a
 * whole spreadsheet into a server-action payload. Failure here is deliberately
 * not fatal — the rows are already recorded, and losing the ability to download
 * the original is far better than failing an import that actually succeeded. */
export async function attachOriginalCallLogFileAction(formData: FormData): Promise<{ ok: boolean }> {
  const { user } = await requireUserLite();

  const uploadId = String(formData.get("upload_id") || "");
  const file = formData.get("file") as File | null;
  if (!uploadId || !file || file.size === 0) return { ok: false };

  // Only the agent who owns the upload may attach its file.
  const { data: upload } = await supabaseAdmin
    .from("agent_call_log_uploads")
    .select("id, agent_id, storage_path")
    .eq("id", uploadId)
    .maybeSingle();
  if (!upload || upload.agent_id !== user.id || upload.storage_path) return { ok: false };

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = file.name.replace(/[^\w.-]/g, "_");
    const storagePath = `call-logs/${user.id}/${uploadId}-${safeName}`;
    await uploadFile(storagePath, buffer);
    await supabaseAdmin.from("agent_call_log_uploads").update({ storage_path: storagePath }).eq("id", uploadId);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Removes an upload and everything recorded from it.
 *
 * Management-only, and deliberately a hard delete: the point is to undo a
 * mistaken upload, and leaving the rows behind would keep inflating the
 * agent's call-log count. The records go via the FK cascade; the audit entry
 * keeps what was removed. */
export async function deleteCallLogUploadAction(uploadId: string) {
  const { user, db } = await requireUserLite();
  if (!isFullAccess(user.role)) {
    redirect(`${PATH}?error=${encodeURIComponent("Only an Administrator can delete an upload.")}`);
  }

  const { data: upload } = await supabaseAdmin
    .from("agent_call_log_uploads")
    .select("*")
    .eq("id", uploadId)
    .maybeSingle();
  if (!upload) redirect(`${PATH}?error=${encodeURIComponent("Upload not found.")}`);

  if (upload!.storage_path) await deleteFile(upload!.storage_path as string).catch(() => undefined);
  const { error } = await supabaseAdmin.from("agent_call_log_uploads").delete().eq("id", uploadId);
  if (error) redirect(`${PATH}?error=${encodeURIComponent(error.message)}`);

  const info = await getRequestInfo();
  logActivity(db, user.id, "AGENT_CALL_LOG_DELETED", "call_log", uploadId, {
    file_name: upload!.file_name,
    agent_id: upload!.agent_id,
    imported_rows: upload!.imported_rows,
  }, { module: "call_logs", previous_value: upload, ...info });
  await writeDb(db);

  redirect(`${PATH}?upload_deleted=1`);
}
