import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isFullAccess } from "@/lib/permissions";

/** Read side of the agent call-log tables.
 *
 * These live outside DbShape (like the Pancake and call-session tables): they
 * grow per upload and are read by one screen, so loading them into the
 * whole-database object on every page would cost every other page nothing but
 * bytes. */

export interface AgentCallLogUpload {
  id: string;
  agent_id: string;
  file_name: string;
  /** Set only for uploads made once the original file began being retained. */
  storage_path: string | null;
  total_rows: number | null;
  imported_rows: number | null;
  duplicate_rows: number | null;
  invalid_rows: number | null;
  failed_rows: number | null;
  uploaded_at: string;
}

export interface CallLogImage {
  id: string;
  agent_id: string;
  storage_path: string;
  original_filename: string;
  file_size_bytes: number | null;
  related_call_date: string | null;
  uploaded_at: string;
}

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

/** Uploads, newest first. `agentIds` scopes the result to a team or a single
 * agent; omitted, every agent's uploads are returned (Management). */
export async function listAgentCallLogUploads(agentIds?: string[]): Promise<AgentCallLogUpload[]> {
  let query = supabaseAdmin.from("agent_call_log_uploads").select("*").order("uploaded_at", { ascending: false });
  if (agentIds) query = query.in("agent_id", agentIds);
  const { data, error } = await query.limit(200);
  if (error) throw new Error(`agent_call_log_uploads read failed: ${error.message}`);
  return (data || []).map((r) => ({
    ...(r as unknown as AgentCallLogUpload),
    total_rows: num(r.total_rows),
    imported_rows: num(r.imported_rows),
    duplicate_rows: num(r.duplicate_rows),
    invalid_rows: num(r.invalid_rows),
    failed_rows: num(r.failed_rows),
  }));
}

export async function listCallLogImages(agentIds?: string[]): Promise<CallLogImage[]> {
  let query = supabaseAdmin.from("call_log_images").select("*").order("uploaded_at", { ascending: false });
  if (agentIds) query = query.in("agent_id", agentIds);
  const { data, error } = await query.limit(200);
  if (error) throw new Error(`call_log_images read failed: ${error.message}`);
  return (data || []).map((r) => ({ ...(r as unknown as CallLogImage), file_size_bytes: num(r.file_size_bytes) }));
}

/** Per-agent totals of recorded calls in a date range, for the daily
 * call-log quantity figure shown alongside calling sessions. */
export async function countCallLogRecords(agentIds: string[], from: string, to: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (agentIds.length === 0) return counts;
  const { data, error } = await supabaseAdmin
    .from("agent_call_log_records")
    .select("agent_id, call_date")
    .in("agent_id", agentIds)
    .gte("call_date", from)
    .lte("call_date", to);
  if (error) throw new Error(`agent_call_log_records read failed: ${error.message}`);
  for (const row of data || []) {
    const key = String(row.agent_id);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/** The rows behind one upload, for drilling into what was actually recorded. */
export async function listRecordsForUpload(uploadId: string) {
  const { data, error } = await supabaseAdmin
    .from("agent_call_log_records")
    .select("*")
    .eq("upload_id", uploadId)
    .order("call_date", { ascending: false })
    .limit(500);
  if (error) throw new Error(`agent_call_log_records read failed: ${error.message}`);
  return data || [];
}

export async function getCallLogImage(id: string): Promise<CallLogImage | null> {
  const { data, error } = await supabaseAdmin.from("call_log_images").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`call_log_images read failed: ${error.message}`);
  return data ? ({ ...(data as unknown as CallLogImage), file_size_bytes: num(data.file_size_bytes) }) : null;
}

/** Whether a viewer may see records belonging to `agentId`.
 *
 * One rule, used by every call-log surface — the review list, the record
 * preview, the file download and the image route — so a new entry point cannot
 * accidentally apply a laxer check than the screen that links to it. */
export function canViewAgentRecords(
  viewer: { id: string; role: string },
  agentId: string,
  profiles: { id: string; team_lead_id: string | null }[]
): boolean {
  if (isFullAccess(viewer.role)) return true;
  if (viewer.id === agentId) return true;
  if (viewer.role === "team_lead") {
    return profiles.some((p) => p.id === agentId && p.team_lead_id === viewer.id);
  }
  return false;
}

export async function getUpload(id: string): Promise<AgentCallLogUpload | null> {
  const { data, error } = await supabaseAdmin.from("agent_call_log_uploads").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`agent_call_log_uploads read failed: ${error.message}`);
  if (!data) return null;
  return {
    ...(data as unknown as AgentCallLogUpload),
    total_rows: num(data.total_rows),
    imported_rows: num(data.imported_rows),
    duplicate_rows: num(data.duplicate_rows),
    invalid_rows: num(data.invalid_rows),
    failed_rows: num(data.failed_rows),
  };
}

export interface CallLogRecordRow {
  id: string;
  call_name: string | null;
  phone_raw: string | null;
  phone_normalized: string | null;
  call_date: string;
}

/** A page of an upload's stored records.
 *
 * Searching, sorting and paging all happen in the query rather than in the
 * browser, so a large file is never shipped whole just to show 25 rows. These
 * are the same rows the daily call-log count is computed from, so the preview
 * cannot disagree with the figure it sits beside. */
export async function listRecordsPage(opts: {
  uploadId: string;
  search?: string;
  sort?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}): Promise<{ rows: CallLogRecordRow[]; total: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, opts.pageSize ?? 50));
  const from = (page - 1) * pageSize;

  let query = supabaseAdmin
    .from("agent_call_log_records")
    .select("id, call_name, phone_raw, phone_normalized, call_date", { count: "exact" })
    .eq("upload_id", opts.uploadId);

  const search = (opts.search || "").trim();
  if (search) {
    // Call Name or phone, matched against both the raw and canonical forms so
    // "0917…" finds a row stored as "+63917…".
    const digits = search.replace(/\D/g, "");
    const clauses = [`call_name.ilike.%${search}%`, `phone_raw.ilike.%${search}%`];
    if (digits) clauses.push(`phone_normalized.ilike.%${digits}%`);
    query = query.or(clauses.join(","));
  }

  const { data, error, count } = await query
    .order("call_date", { ascending: opts.sort !== "desc" })
    .range(from, from + pageSize - 1);
  if (error) throw new Error(`agent_call_log_records read failed: ${error.message}`);

  return { rows: (data || []) as unknown as CallLogRecordRow[], total: count ?? 0 };
}
