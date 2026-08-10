import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isFullAccess } from "@/lib/permissions";
import { normalizePhone } from "@/lib/utils";
import type { DbShape, Order, Profile } from "@/lib/types";

/**
 * The Leads list, asked of the database instead of assembled in memory.
 *
 * The page used to load every order — 57,000 of them, ~50MB — filter and sort
 * them in JavaScript, and then show twenty-five. Everything here is one
 * bounded query: a page of rows, a count per status, a count of duplicated
 * numbers.
 *
 * `null` scope means no agent restriction (Administrator). An array restricts
 * to those agents, which is how a Team Lead sees their team and an agent sees
 * only their own.
 */

export type AgentScope = string[] | null;

/** Mirrors scopeOrders() in lib/order-access.ts, as a set of agent ids.
 *
 * The one difference is deliberate: the in-memory version also checks that an
 * order's assigned_agent_email matches the agent's, a data-integrity guard
 * against a row whose two agent fields disagree. That cannot be expressed
 * against another table in one query; agent_id is the column every write sets
 * and the one the app treats as authoritative. */
export function leadScopeFor(user: Profile, db: DbShape): AgentScope {
  if (isFullAccess(user.role)) {
    // A test account's orders are real rows but not the floor's work, so
    // nothing that measures the floor counts them: this scope feeds the Leads
    // list, its status cards, the duplicates and the whole Dashboard.
    //
    // Null still means "no restriction", and is still what is returned when
    // there is nothing to leave out — naming every agent would otherwise
    // change the shape of every query for no reason.
    if (!db.profiles.some((p) => p.is_test_account && p.id !== user.id)) return null;
    return db.profiles.filter((p) => !p.is_test_account || p.id === user.id).map((p) => p.id);
  }
  if (user.role === "team_lead") {
    return [
      user.id,
      ...db.profiles
        .filter((p) => p.team_lead_id === user.id && (!p.is_test_account || p.id === user.id))
        .map((p) => p.id),
    ];
  }
  // The test account itself still sees its own leads — it is somebody's
  // account, and they are testing the live system with it.
  return [user.id];
}

export interface LeadFilters {
  status?: string;
  /** Free-text box. Agent and management views search slightly different sets. */
  q?: string;
  order_number?: string;
  agent?: string;
  customer_name?: string;
  phone?: string;
  city?: string;
  province?: string;
  product?: string;
  date_from?: string;
  date_to?: string;
  prev_from?: string;
  prev_to?: string;
}

/** PostgREST's or() takes a comma-separated list, so a term containing a comma
 * or a parenthesis would be read as more conditions. Those characters never
 * carry meaning in a name or a reference, so they are dropped rather than
 * escaped. */
function safeTerm(value: string): string {
  return value.replace(/[(),*]/g, " ").trim();
}

function applyScope<T extends { in: (col: string, values: string[]) => T }>(query: T, scope: AgentScope): T {
  return scope ? query.in("agent_id", scope) : query;
}

export interface LeadPage {
  rows: Order[];
  total: number;
}

/**
 * One page of the list, newest first, with the total the pager needs.
 *
 * Regular customers are excluded here rather than after the fact — they live
 * in their own section, and filtering them out in the application would mean
 * asking for rows only to throw them away and paging on a wrong total.
 *
 * `includeRegular` puts them back, for the agent who wants one list of
 * everything they have worked. It is off by default, so the section keeps its
 * meaning; what it fixes is that their work was invisible here, with no way to
 * ask for it.
 */
export async function queryLeads(input: {
  scope: AgentScope;
  filters: LeadFilters;
  isAgentView: boolean;
  page: number;
  pageSize: number;
  usernameToIds: Map<string, string[]>;
  includeRegular?: boolean;
}): Promise<LeadPage> {
  const { scope, filters, isAgentView, page, pageSize, includeRegular } = input;

  let query = supabaseAdmin.from("orders").select("*", { count: "exact" });
  if (!includeRegular) query = query.not("is_regular_customer", "is", true);
  query = applyScope(query, scope);

  if (filters.status) query = query.eq("status", filters.status);

  if (isAgentView) {
    // The agent's single box: their own leads, by any reference they might
    // have written down.
    const term = safeTerm(filters.q || filters.phone || "");
    if (term) {
      const digits = normalizePhone(term);
      const conditions = [
        `order_number.ilike.*${term}*`,
        `pancake_order_id.ilike.*${term}*`,
        `customer_name.ilike.*${term}*`,
        `tracking_number.ilike.*${term}*`,
      ];
      if (digits) conditions.push(`customer_phone.ilike.*${digits}*`);
      query = query.or(conditions.join(","));
    }
  } else {
    if (filters.q) {
      const term = safeTerm(filters.q);
      const conditions = [
        `order_number.ilike.*${term}*`,
        `pancake_order_id.ilike.*${term}*`,
        `customer_name.ilike.*${term}*`,
        `customer_phone.ilike.*${term}*`,
      ];
      // Management's box also matches an agent's username, which lives on
      // another table — resolved to ids by the caller, since a join here would
      // cost more than the handful of profiles it looks at.
      const agentIds = input.usernameToIds.get(term.toLowerCase()) || [];
      for (const id of agentIds) conditions.push(`agent_id.eq.${id}`);
      query = query.or(conditions.join(","));
    }
    if (filters.order_number) {
      const term = safeTerm(filters.order_number);
      query = query.or(`order_number.ilike.*${term}*,pancake_order_id.ilike.*${term}*`);
    }
    if (filters.agent) query = query.eq("agent_id", filters.agent);
    if (filters.customer_name) query = query.ilike("customer_name", `%${safeTerm(filters.customer_name)}%`);
    if (filters.phone) query = query.ilike("customer_phone", `%${safeTerm(filters.phone)}%`);
    if (filters.city) query = query.ilike("city", `%${safeTerm(filters.city)}%`);
    if (filters.province) query = query.ilike("province", `%${safeTerm(filters.province)}%`);
    if (filters.product) query = query.eq("product_id", filters.product);
    if (filters.date_from) query = query.gte("order_date", filters.date_from);
    if (filters.date_to) query = query.lte("order_date", filters.date_to);
    if (filters.prev_from) query = query.gte("previous_order_date", filters.prev_from);
    if (filters.prev_to) query = query.lte("previous_order_date", filters.prev_to);
  }

  const from = (page - 1) * pageSize;
  const { data, count, error } = await query.order("created_at", { ascending: false }).range(from, from + pageSize - 1);
  if (error) throw new Error(`Leads query failed: ${error.message}`);
  return { rows: (data || []) as unknown as Order[], total: count ?? 0 };
}

/**
 * One order by id, if the viewer is allowed to see it.
 *
 * For deep links that must work regardless of the page, the filters or the
 * regular-customer exclusion — "Return to active call" being the one that
 * matters, since the panel that ends a call lives in this table's modal.
 * Scope is still enforced: a link cannot fetch somebody else's lead.
 */
export async function orderForScope(orderId: string, scope: AgentScope): Promise<Order | null> {
  let query = supabaseAdmin.from("orders").select("*").eq("id", orderId);
  query = applyScope(query, scope);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Lead lookup failed: ${error.message}`);
  return (data as unknown as Order) ?? null;
}

/** Counts per status for the cards, from one grouped query. Deliberately
 * ignores the current status filter: selecting a card must not zero the
 * others. */
export async function leadStatusCounts(
  scope: AgentScope,
  includeRegular = false
): Promise<Map<string, number>> {
  const { data, error } = await supabaseAdmin.rpc("lead_status_counts", {
    p_agent_ids: scope,
    p_include_regular: includeRegular,
  });
  if (error) throw new Error(`Lead status counts failed: ${error.message}`);
  const counts = new Map<string, number>();
  for (const row of (data || []) as { status: string; n: number }[]) counts.set(row.status, Number(row.n));
  return counts;
}

/**
 * Orders in scope that belong to a regular customer.
 *
 * They are deliberately absent from the list, which on 2026-08-10 meant every
 * status card read 0 while the floor had worked eleven orders that day. The
 * card this feeds says how much work is sitting in the other section.
 */
export async function regularCustomerOrderCount(scope: AgentScope): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("regular_customer_order_count", { p_agent_ids: scope });
  if (error) throw new Error(`Regular customer order count failed: ${error.message}`);
  return Number(data ?? 0);
}

/** How many contact numbers appear on more than one lead, for the badge. */
export async function duplicatePhoneCount(scope: AgentScope): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("lead_duplicate_phone_count", { p_agent_ids: scope });
  if (error) throw new Error(`Duplicate lead count failed: ${error.message}`);
  return Number(data ?? 0);
}
