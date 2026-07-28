import { supabaseAdmin } from "@/lib/supabaseAdmin";

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
