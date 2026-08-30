import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isFullAccess } from "@/lib/permissions";
import { normalizePhone } from "@/lib/utils";
import { statusesMatching } from "@/lib/validation";
import {
  MAX_PHONE_TERMS,
  MAX_SEARCH_TERMS,
  phoneListKeys,
  safeTerm,
  splitTerms,
} from "@/lib/leads-query-terms";
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

/**
 * How many leads one page may show, and therefore how many can be ticked at
 * once.
 *
 * Here rather than on the page because the bulk delete has to agree with it.
 * Those two numbers were written separately and drifted the moment the page
 * size was raised: the selection cap still described "twenty-five rows a page,
 * so this is far above what the UI can hand over", while the UI had started
 * handing over five hundred. Ticking a full page then failed on the limit.
 *
 * No "all". At 110,000 leads one page is a table the browser cannot lay out,
 * and PostgREST caps a response at a thousand rows regardless.
 */
export const LEAD_PAGE_SIZES = [25, 50, 100, 200, 500] as const;
export const MAX_LEAD_PAGE_SIZE = LEAD_PAGE_SIZES[LEAD_PAGE_SIZES.length - 1];

/** Mirrors scopeOrders() in lib/order-access.ts, as a set of agent ids.
 *
 * The two now agree exactly. They did not until 2026-08-11: the in-memory
 * version also required an order's assigned_agent_email to match the agent's,
 * which cannot be expressed against another table in one query, so this list
 * showed leads that every action then refused. agent_id is the column every
 * write sets and the one both sides treat as the owner. */
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
  /** Matched case-insensitively: previous_order_status is free text, so an
   * import may have written DELIVERED, Delivered or delivered. */
  prev_status?: string;
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

/**
 * The search box, split into the separate things being looked for.
 *
 * The splitting itself lives in leads-query-terms.ts, shared with the box so
 * that the count it shows and the count that is used are the same number.
 */
export function searchTerms(value: string | undefined | null): string[] {
  return splitTerms(value).slice(0, MAX_SEARCH_TERMS);
}

/**
 * A pasted column of phone numbers, resolved to the leads carrying them.
 *
 * Long lists cannot go through the ordinary path, and the reason is the URL
 * rather than the data: every term becomes five ilike conditions in one
 * PostgREST or(), so fifty numbers is already a 9KB query string and four
 * hundred is refused outright with a 414.
 *
 * So the numbers are sent in a request body instead. The database matches them
 * on lead_phone_key against orders_phone_key_idx — one index scan, measured at
 * 9ms for three hundred — and answers with ids. Those ids then go into the
 * ordinary list query, which is the point of doing it in two steps: status,
 * dates, product, agent, the scope, the ordering and the pager all keep working
 * untouched, instead of being reimplemented here and silently losing whichever
 * one was forgotten.
 *
 * Null means "not this path" — use the ordinary one.
 */
async function leadIdsForPhoneList(keys: string[]): Promise<{ ids: string[]; truncated: boolean }> {
  const { data, error } = await supabaseAdmin.rpc("lead_ids_by_phone_keys", {
    p_keys: keys,
    p_max: MAX_PHONE_TERMS,
  });
  if (error) throw new Error(`Phone list lookup failed: ${error.message}`);
  const answer = (data || {}) as { ids?: string[]; truncated?: boolean };
  return { ids: answer.ids || [], truncated: Boolean(answer.truncated) };
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
  if (filters.prev_status) query = query.ilike("previous_order_status", filters.prev_status);

  /**
   * A long list of phone numbers takes the other route.
   *
   * Only when it is long: below the ordinary ceiling nothing changes, because
   * the two routes do not match identically. The ordinary one looks for the
   * digits in the order number, the tracking number and the customer name as
   * well, and somebody searching a single number may well mean one of those.
   * Above fifty it is a pasted column of contact numbers and nothing else, and
   * the exact phone-key match is both what is wanted and the only thing that
   * fits in a request.
   */
  const rawSearch = isAgentView ? filters.q || filters.phone || "" : filters.q || "";
  const allTerms = splitTerms(rawSearch);
  const phoneKeys = allTerms.length > MAX_SEARCH_TERMS ? phoneListKeys(allTerms) : null;

  if (phoneKeys) {
    const { ids } = await leadIdsForPhoneList(phoneKeys.slice(0, MAX_PHONE_TERMS));
    // No matches must return nothing, not everything. An empty in() list is a
    // condition that cannot be satisfied, which is right, but PostgREST is
    // asked for an impossible id instead so the intent survives the round trip.
    query = query.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  } else if (isAgentView) {
    // The agent's single box: their own leads, by any reference they might
    // have written down.
    const terms = searchTerms(filters.q || filters.phone || "");
    if (terms.length) {
      // One OR across every term and every column, so a pasted list of order
      // ids comes back together instead of one lookup at a time. A Set because
      // the status conditions repeat across terms and the URL has a length.
      const conditions = new Set<string>();
      for (const term of terms) {
        conditions.add(`order_number.ilike.*${term}*`);
        conditions.add(`pancake_order_id.ilike.*${term}*`);
        conditions.add(`customer_name.ilike.*${term}*`);
        conditions.add(`tracking_number.ilike.*${term}*`);
        const digits = normalizePhone(term);
        if (digits) conditions.add(`customer_phone.ilike.*${digits}*`);
        // …and by what the lead IS: typing "delivered" finds the delivered ones.
        for (const s of statusesMatching(term)) conditions.add(`status.eq.${s}`);
      }
      query = query.or(Array.from(conditions).join(","));
    }
  } else {
    const terms = searchTerms(filters.q);
    if (terms.length) {
      const conditions = new Set<string>();
      for (const term of terms) {
        conditions.add(`order_number.ilike.*${term}*`);
        conditions.add(`pancake_order_id.ilike.*${term}*`);
        conditions.add(`customer_name.ilike.*${term}*`);
        conditions.add(`customer_phone.ilike.*${term}*`);
        // Management's box also matches an agent's username, which lives on
        // another table — resolved to ids by the caller, since a join here
        // would cost more than the handful of profiles it looks at.
        // …and by status name, so "returned" narrows the list without
        // reaching for a second control.
        for (const s of statusesMatching(term)) conditions.add(`status.eq.${s}`);
        const agentIds = input.usernameToIds.get(term.toLowerCase()) || [];
        for (const id of agentIds) conditions.add(`agent_id.eq.${id}`);
      }
      query = query.or(Array.from(conditions).join(","));
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
  // The id is the tie-break, and it is not optional here. An import stamps one
  // created_at across the whole batch — ROMA_aaliyah's 2,060 open leads share a
  // single timestamp, as do bernadeth's 1,650 — so ordering by created_at alone
  // leaves Postgres free to return a different arbitrary 25 rows every time the
  // query runs. Paging skipped leads that way, and the shell's 60-second
  // refresh made a lead an agent was typing into disappear from under them.
  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + pageSize - 1);
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

/**
 * How many contact numbers appear on more than one lead, for the badge.
 *
 * Cached for ten minutes. Counting them means evaluating lead_phone_key()
 * twice for every one of 51,500 rows — around 103,000 regexp calls, measured
 * at 1.4 seconds — and it ran on every Leads page load, which made it the
 * single most expensive thing the database did. Every index it could want
 * already exists; the scan is not the cost, the function is.
 *
 * Ten minutes stale is the right trade for a number on a button: it changes
 * when somebody creates or edits a lead, and nothing is decided on the
 * difference between 4 and 5. The Duplicates page itself always counts live.
 */
export async function duplicatePhoneCount(scope: AgentScope): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("lead_duplicate_phone_count_cached", {
    p_agent_ids: scope,
    p_max_age_seconds: 600,
  });
  if (error) throw new Error(`Duplicate lead count failed: ${error.message}`);
  return Number(data ?? 0);
}

/**
 * The PREV STATUS values that actually appear in the leads, with counts.
 *
 * Not the status enum. previous_order_status is free text — imports and the
 * floor have written REJECT UPSELL, TRANSFERRED TO POS, "meron pa", "walang
 * budget" into it, and REJECT UPSELL alone is on nearly five thousand leads
 * while never having been a status this system has. A filter built from the
 * enum would offer names that match nothing and hide the ones that matter.
 *
 * Folded to upper case in the function, so CANCEL and cancel are one line.
 */
export async function previousStatusCounts(
  scope: AgentScope,
  includeRegular = false
): Promise<{ value: string; count: number }[]> {
  const { data, error } = await supabaseAdmin.rpc("previous_status_counts", {
    p_agent_ids: scope,
    p_include_regular: includeRegular,
  });
  if (error) throw new Error(`Previous status counts failed: ${error.message}`);
  return ((data || []) as { value: string; n: number }[]).map((r) => ({ value: r.value, count: Number(r.n) }));
}
