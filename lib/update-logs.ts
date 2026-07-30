import { supabaseAdmin } from "./supabaseAdmin";
import type { UpdateLog } from "./types";

// Kept out of DbShape: the login page reads published release notes before any
// session exists, and entries are append-mostly rather than edited in bulk.

const COLUMNS =
  "id, version, release_date, title, new_features, fixes, improvements, known_issues, is_published, created_by, created_at";

/** Newest first. Ordered by release date, then version, so two releases sharing
 * a date still read in a stable order. */
export async function listUpdateLogs(opts: { publishedOnly: boolean }): Promise<UpdateLog[]> {
  let query = supabaseAdmin
    .from("update_logs")
    .select(COLUMNS)
    .order("release_date", { ascending: false })
    .order("version", { ascending: false });
  if (opts.publishedOnly) query = query.eq("is_published", true);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to read update logs: ${error.message}`);
  return (data || []) as UpdateLog[];
}

export async function getUpdateLog(id: string): Promise<UpdateLog | null> {
  const { data, error } = await supabaseAdmin.from("update_logs").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`Failed to read update log: ${error.message}`);
  return (data as UpdateLog) || null;
}

export async function insertUpdateLog(row: Omit<UpdateLog, "id" | "created_at">): Promise<UpdateLog> {
  const { data, error } = await supabaseAdmin.from("update_logs").insert(row).select(COLUMNS).single();
  if (error) throw new Error(`Failed to create update log: ${error.message}`);
  return data as UpdateLog;
}

export async function updateUpdateLog(id: string, patch: Partial<UpdateLog>): Promise<void> {
  const { error } = await supabaseAdmin.from("update_logs").update(patch).eq("id", id);
  if (error) throw new Error(`Failed to update update log: ${error.message}`);
}

export async function deleteUpdateLog(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from("update_logs").delete().eq("id", id);
  if (error) throw new Error(`Failed to delete update log: ${error.message}`);
}

/** Splits the one-item-per-line textareas the admin form uses. */
export function parseLines(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}
