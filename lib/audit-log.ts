import { supabaseAdmin } from "./supabaseAdmin";
import type { ActivityLogEntry } from "./types";

/**
 * Scoped reads of the audit trail.
 *
 * activity_log is the fastest-growing table in the system and the widest:
 * previous_value/updated_value hold entire order snapshots, so a single row can
 * be kilobytes. It used to be loaded in full, unbounded, by readDb() — which
 * runs on every request — and then scanned in memory by whichever page needed
 * three fields out of it.
 *
 * It is now the one table readDb() does not load at all. DbShape.activity_log
 * is an outbox holding only what the current request has logged, and every read
 * of history goes through one of the scoped queries below. Anything needing the
 * trail must ask for the slice it wants; there is no in-memory copy to scan.
 */

const TABLE = "activity_log";

export interface AuditFilters {
  user?: string;
  module?: string;
  action?: string;
  entity_id?: string;
  /** Inclusive, YYYY-MM-DD. */
  from?: string;
  /** Inclusive, YYYY-MM-DD. */
  to?: string;
}

/** The day after `ymd`, so an inclusive "to" date keeps entries logged during
 * that day. Comparing created_at <= "2026-08-07" would silently drop everything
 * after midnight, which the previous in-memory `created_at.slice(0, 10) <= to`
 * did include. Dates are compared in UTC, as they were before. */
function dayAfter(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/** The equality filters as a plain object for .match(). Kept separate from the
 * date bounds because those are range comparisons, and because threading the
 * builder through a generic helper defeats its type inference. */
function equalityFilters(f: AuditFilters): Record<string, string> {
  const eq: Record<string, string> = {};
  if (f.user) eq.user_id = f.user;
  if (f.module) eq.module = f.module;
  if (f.action) eq.action = f.action;
  if (f.entity_id) eq.entity_id = f.entity_id;
  return eq;
}

function asEntries(data: unknown): ActivityLogEntry[] {
  return (data || []) as ActivityLogEntry[];
}

/** One page of the audit log, newest first, plus the total matching the
 * filters so the pager can size itself. */
export async function queryAuditLog(
  filters: AuditFilters,
  page: number,
  pageSize: number
): Promise<{ entries: ActivityLogEntry[]; total: number }> {
  const offset = (page - 1) * pageSize;
  let q = supabaseAdmin.from(TABLE).select("*", { count: "exact" }).match(equalityFilters(filters));
  if (filters.from) q = q.gte("created_at", `${filters.from}T00:00:00Z`);
  if (filters.to) q = q.lt("created_at", dayAfter(filters.to));

  const { data, error, count } = await q
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1);
  if (error) throw new Error(`Audit log query failed: ${error.message}`);
  return { entries: asEntries(data), total: count ?? 0 };
}

/** Every entry matching the filters, newest first. Deliberately unbounded —
 * this backs the CSV export, where a truncated file would be worse than a slow
 * one. Nothing else should use it. */
export async function queryAuditLogForExport(filters: AuditFilters): Promise<ActivityLogEntry[]> {
  let q = supabaseAdmin.from(TABLE).select("*").match(equalityFilters(filters));
  if (filters.from) q = q.gte("created_at", `${filters.from}T00:00:00Z`);
  if (filters.to) q = q.lt("created_at", dayAfter(filters.to));

  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) throw new Error(`Audit log export query failed: ${error.message}`);
  return asEntries(data);
}

/** Distinct actions and modules, for the audit page's filter dropdowns.
 *
 * This does read every row, but only two short text columns rather than the
 * snapshot payloads — and only on the audit page, not on every request. If the
 * table grows large enough for this to matter, replace it with a view doing
 * SELECT DISTINCT in Postgres. */
export async function auditFacets(): Promise<{ actions: string[]; modules: string[] }> {
  const { data, error } = await supabaseAdmin.from(TABLE).select("action, module");
  if (error) throw new Error(`Audit facet query failed: ${error.message}`);
  const rows = (data || []) as { action: string; module: string | null }[];
  return {
    actions: Array.from(new Set(rows.map((r) => r.action))).sort(),
    modules: Array.from(new Set(rows.map((r) => r.module).filter(Boolean))) as string[],
  };
}

/** The full history of one record, newest first — the lead and product detail
 * timelines. Unbounded on purpose: a single record's history is small, and it
 * is the whole point of the panel. */
export async function auditForEntity(entityId: string, module: string): Promise<ActivityLogEntry[]> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("entity_id", entityId)
    .eq("module", module)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Audit history query failed: ${error.message}`);
  return asEntries(data);
}

/** Recent entries for the dashboard feed, optionally narrowed to one user
 * (agents only ever see their own). */
export async function recentActivity(limit: number, userId?: string | null): Promise<ActivityLogEntry[]> {
  let q = supabaseAdmin.from(TABLE).select("*");
  if (userId) q = q.eq("user_id", userId);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`Recent activity query failed: ${error.message}`);
  return asEntries(data);
}

/** Entries for one action, newest first. `limit` omitted means all of them. */
export async function auditByAction(action: string, limit?: number): Promise<ActivityLogEntry[]> {
  const q = supabaseAdmin.from(TABLE).select("*").eq("action", action).order("created_at", { ascending: false });
  const { data, error } = await (limit === undefined ? q : q.limit(limit));
  if (error) throw new Error(`Audit action query failed: ${error.message}`);
  return asEntries(data);
}

/** Who created each account, from the USER_CREATED events — profiles has no
 * created_by column. Maps the created user's id to the id of whoever created
 * them; the newest event wins, matching the previous scan. */
export async function accountCreatorIds(): Promise<Map<string, string>> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("entity_id, user_id, created_at")
    .eq("action", "USER_CREATED")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Account creator query failed: ${error.message}`);
  const out = new Map<string, string>();
  for (const row of (data || []) as { entity_id: string | null; user_id: string | null }[]) {
    if (!row.entity_id || !row.user_id) continue;
    if (!out.has(row.entity_id)) out.set(row.entity_id, row.user_id);
  }
  return out;
}

export interface LatestStatusChange {
  status: string;
  at: string;
}

/** The most recent status change for each of the given orders — the "last
 * updated" column on the Leads table. Scoped to the ids on the page rather
 * than scanning the whole trail. */
export async function latestStatusChangeByOrder(
  orderIds: string[]
): Promise<Record<string, LatestStatusChange>> {
  if (orderIds.length === 0) return {};
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("entity_id, updated_value, created_at")
    .eq("action", "LEAD_STATUS_CHANGED")
    .eq("module", "orders")
    .in("entity_id", orderIds)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Status history query failed: ${error.message}`);

  const out: Record<string, LatestStatusChange> = {};
  for (const row of (data || []) as { entity_id: string | null; updated_value: unknown; created_at: string }[]) {
    if (!row.entity_id || out[row.entity_id]) continue;
    const status = (row.updated_value as { status?: string } | null)?.status;
    if (status) out[row.entity_id] = { status, at: row.created_at };
  }
  return out;
}

/** How many audit rows belong to a user — shown before deleting an account.
 * A head count, so no rows cross the wire. */
export async function countAuditForUser(userId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw new Error(`Audit count query failed: ${error.message}`);
  return count ?? 0;
}
