"use server";

import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { uploadFile } from "@/lib/storage";
import { canonicalPhone, normalizePhone } from "@/lib/utils";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { writeDb } from "@/lib/db";
import { requireUser } from "./guards";
import { detectDateOrder, parseCallDate, type DateOrder } from "@/lib/call-date";

const PATH = "/call-logs";

export interface AgentUploadRowError {
  row: number;
  reason: string;
  value: string;
}

export interface AgentUploadSummary {
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
  const { user, db } = await requireUser();

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
    if (!phoneRaw || !normalizePhone(phoneRaw)) {
      errors.push({ row: r.row, reason: "Phone number is required", value: phoneRaw });
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
  const { user, db } = await requireUser();

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
