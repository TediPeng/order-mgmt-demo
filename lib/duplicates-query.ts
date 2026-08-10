import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizePhone } from "@/lib/utils";
import type { AgentScope } from "@/lib/leads-query";
import type { OrderStatus } from "@/lib/types";

/**
 * Duplicate leads, asked of the database instead of assembled in memory.
 *
 * The page and its actions used to call readDb() — all 57,000 orders, ~50MB,
 * fifty-eight round trips — group them in JavaScript and show fifty groups.
 * Everything here is one bounded call to a function that does the grouping
 * where the rows already are.
 *
 * Each RPC returns a single jsonb value rather than a row set, deliberately:
 * PostgREST caps a result at 1,000 rows, so a set-returning function would
 * silently turn a sweep of six thousand duplicates into a sweep of one
 * thousand. See the migration duplicate_leads_query_functions.
 */

/** The group's identity, from a phone number as typed.
 *
 * Must produce what lead_phone_key() produces in SQL — digits only, PH trunk
 * prefix stripped — because a form submits this string and the database looks
 * up the group by it. */
export function phoneKeyOf(phone: string): string {
  return normalizePhone(phone || "");
}

export interface DuplicateOrderRow {
  id: string;
  order_number: string;
  customer_name: string;
  purok: string | null;
  barangay: string | null;
  city: string | null;
  province: string | null;
  agent_id: string;
  status: OrderStatus;
  created_at: string;
  /** The earliest lead of the group — the one that is kept. */
  is_keeper: boolean;
  /** Why this row may not be deleted here, or null. */
  protected_reason: string | null;
}

export interface DuplicateGroupRow {
  phone_key: string;
  /** What an agent typed, from the keeper — for display. */
  phone_display: string;
  group_size: number;
  orders: DuplicateOrderRow[];
}

export interface DuplicateSummary {
  groups: number;
  duplicateRows: number;
  removableRows: number;
  protectedRows: number;
}

export async function duplicateSummary(scope: AgentScope): Promise<DuplicateSummary> {
  const { data, error } = await supabaseAdmin.rpc("lead_duplicate_summary", { p_agent_ids: scope });
  if (error) throw new Error(`Duplicate summary failed: ${error.message}`);
  const row = (data || {}) as Record<string, number>;
  return {
    groups: Number(row.groups ?? 0),
    duplicateRows: Number(row.duplicate_rows ?? 0),
    removableRows: Number(row.removable_rows ?? 0),
    protectedRows: Number(row.protected_rows ?? 0),
  };
}

/** One page of groups, worst first. */
export async function duplicateGroupPage(
  scope: AgentScope,
  page: number,
  pageSize: number
): Promise<DuplicateGroupRow[]> {
  const { data, error } = await supabaseAdmin.rpc("lead_duplicate_page", {
    p_agent_ids: scope,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });
  if (error) throw new Error(`Duplicate leads query failed: ${error.message}`);
  return (data || []) as DuplicateGroupRow[];
}

export interface RemovableDuplicates {
  /** False when the number has no duplicates at all any more — a different
   * message to the agent than a group whose every duplicate is protected. */
  groupExists: boolean;
  protectedCount: number;
  ids: string[];
}

/**
 * What a cleanup would actually remove, re-derived from the database.
 *
 * `phoneKey` restricts it to one number's group; omitted, it is every
 * removable duplicate in scope. The caller passes an id or a number, never a
 * decision — a stale page must not be able to delete a row that has since been
 * sent to Pancake.
 */
export async function duplicateRemovable(scope: AgentScope, phoneKey?: string): Promise<RemovableDuplicates> {
  const { data, error } = await supabaseAdmin.rpc("lead_duplicate_removable", {
    p_agent_ids: scope,
    p_phone_key: phoneKey ?? null,
  });
  if (error) throw new Error(`Duplicate lead lookup failed: ${error.message}`);
  const row = (data || {}) as { group_exists?: boolean; protected?: number; removable?: string[] };
  return {
    groupExists: Boolean(row.group_exists),
    protectedCount: Number(row.protected ?? 0),
    ids: (row.removable || []) as string[],
  };
}

/** The rows behind a set of ids, for the audit entry — the audit trail holds
 * the only remaining copy once these are deleted, so it takes whole rows. */
export async function ordersByIds(ids: string[]): Promise<Record<string, unknown>[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabaseAdmin.from("orders").select("*").in("id", ids);
  if (error) throw new Error(`Order snapshot failed: ${error.message}`);
  return (data || []) as Record<string, unknown>[];
}
