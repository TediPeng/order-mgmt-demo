"use server";

import { redirect } from "next/navigation";
import { writeDb, uuid, nowIso, queueDelete } from "@/lib/db";
import { uploadFile, deleteFile } from "@/lib/storage";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { requireUserLite, requirePermission } from "./guards";
import { CALL_LOG_HEADERS, callLogRowSchema } from "@/lib/validation";
import { parseSpreadsheetToRows } from "@/lib/call-log-parser";
import type { CallLog, CallLogRecord } from "@/lib/types";

const MAX_SIZE = 10 * 1024 * 1024;

export async function uploadCallLogAction(formData: FormData) {
  const { user, db } = await requireUserLite();
  requirePermission(user, "call_logs", "upload", db, "/call-logs");

  const file = formData.get("file") as File | null;

  if (!file || file.size === 0) {
    redirect(`/call-logs?error=${encodeURIComponent("Please choose a file to upload.")}`);
  }

  const ext = file!.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : file!.name.toLowerCase().endsWith(".csv") ? "csv" : null;
  if (!ext) {
    redirect(`/call-logs?error=${encodeURIComponent("Invalid file type. Please upload a .xlsx or .csv file.")}`);
  }
  if (file!.size > MAX_SIZE) {
    redirect(`/call-logs?error=${encodeURIComponent("File is too large. Maximum size is 10 MB.")}`);
  }

  const buffer = Buffer.from(await file!.arrayBuffer());
  let rows: string[][];
  try {
    rows = parseSpreadsheetToRows(buffer, ext as "xlsx" | "csv");
  } catch {
    redirect(`/call-logs?error=${encodeURIComponent("Could not read this file. Please make sure it is not corrupted.")}`);
  }

  if (!rows! || rows.length === 0) {
    redirect(`/call-logs?error=${encodeURIComponent("The uploaded file contains no records.")}`);
  }

  const headerRow = rows[0].map((h) => h.trim());
  const headersOk = CALL_LOG_HEADERS.every((h, i) => headerRow[i] === h);
  if (!headersOk) {
    redirect(
      `/call-logs?error=${encodeURIComponent("The file format is incorrect. Please download and use the official template.")}`
    );
  }

  const dataRows = rows.slice(1).filter((r) => r.some((c) => c.trim() !== ""));
  if (dataRows.length === 0) {
    redirect(`/call-logs?error=${encodeURIComponent("The uploaded file contains no records.")}`);
  }

  const errors: string[] = [];
  const parsedRecords: Omit<CallLogRecord, "id" | "call_log_id">[] = [];

  dataRows.forEach((row, idx) => {
    // Two columns, in the template's order. The rest of the record's fields
    // still exist and still render for logs uploaded before this change; they
    // are simply no longer asked for.
    const raw = {
      call_date: row[0] || "",
      phone_number: row[1] || "",
    };
    const result = callLogRowSchema.safeParse(raw);
    if (!result.success) {
      errors.push(`Row ${idx + 2}: ${result.error.issues[0]?.message || "Invalid row"}`);
      return;
    }

    parsedRecords.push({
      caller_name: result.data.caller_name,
      phone_number: result.data.phone_number,
      call_date: result.data.call_date,
      duration_seconds: result.data.duration_seconds,
      call_type: result.data.call_type,
      notes: result.data.notes,
      // Whose log this is comes from who is uploading it, not from a name typed
      // into a spreadsheet. The name had to be matched against a profile, so a
      // misspelling failed the whole file, and two people could disagree about
      // how one agent is written. The account doing the upload cannot be
      // misspelled and is already the thing the audit entry records.
      agent_id: user.id,
    });
  });

  if (errors.length > 0) {
    redirect(`/call-logs?error=${encodeURIComponent(`Some rows are invalid — ${errors.slice(0, 5).join("; ")}`)}`);
  }

  const storedName = `${uuid()}-${file!.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await uploadFile(`call-logs/${storedName}`, buffer);

  const callLog: CallLog = {
    id: uuid(),
    file_name: file!.name,
    storage_path: storedName,
    file_size_bytes: file!.size,
    record_count: parsedRecords.length,
    uploaded_by: user.id,
    uploaded_at: nowIso(),
  };
  db.call_logs.push(callLog);
  parsedRecords.forEach((r) => {
    db.call_log_records.push({ id: uuid(), call_log_id: callLog.id, ...r });
  });

  const info = await getRequestInfo();
  logActivity(
    db,
    user.id,
    "CALL_LOG_UPLOADED",
    "call_log",
    callLog.id,
    { file_name: callLog.file_name, record_count: callLog.record_count },
    { module: "call_logs", ...info }
  );
  await writeDb(db);
  redirect(`/call-logs?uploaded=1`);
}

export async function deleteCallLogAction(callLogId: string) {
  "use server";
  const { user, db } = await requireUserLite();
  requirePermission(user, "call_logs", "delete", db, "/call-logs");

  const idx = db.call_logs.findIndex((c) => c.id === callLogId);
  if (idx === -1) redirect("/call-logs");
  const [removed] = db.call_logs.splice(idx, 1);
  queueDelete(db, "call_logs", callLogId);
  // The records go too, and each is named individually — writeDb drains them
  // before the log itself, so the foreign key is never left dangling.
  for (const r of db.call_log_records.filter((r) => r.call_log_id === callLogId)) {
    queueDelete(db, "call_log_records", r.id);
  }
  db.call_log_records = db.call_log_records.filter((r) => r.call_log_id !== callLogId);

  await deleteFile(`call-logs/${removed.storage_path}`);

  const info = await getRequestInfo();
  logActivity(db, user.id, "CALL_LOG_DELETED", "call_log", callLogId, { file_name: removed.file_name }, {
    module: "call_logs",
    previous_value: removed,
    ...info,
  });
  await writeDb(db);
  redirect("/call-logs?deleted=1");
}
