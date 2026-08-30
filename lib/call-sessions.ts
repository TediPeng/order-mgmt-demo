import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { SALE_STATUSES } from "@/lib/validation";
import { dayRangeUtc, APP_TIMEZONE } from "@/lib/utils";
import type { CallSession } from "@/lib/types";

/** Calling sessions.
 *
 * A session is what licenses an agent to edit an order: the fields stay locked
 * until one is open, and the status-update path refuses to run without one, so
 * a crafted request fails exactly like the disabled button does.
 *
 * The timer is never held in the client. `started_at` is the only source of
 * truth, so a refresh, a reopened popup or a second tab all show the same
 * elapsed time rather than restarting from zero.
 *
 * One active session per agent is a database guarantee, not a check here: the
 * partial unique index `one_active_call_per_agent` rejects the insert, which is
 * the only way to make it hold against two simultaneous clicks. */

function map(row: Record<string, unknown>): CallSession {
  return {
    ...(row as unknown as CallSession),
    duration_seconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
  };
}

/** Postgres unique-violation, raised by one_active_call_per_agent. */
const UNIQUE_VIOLATION = "23505";

/**
 * What is being called.
 *
 * An order for a lead, or a regular customer who has no order yet — the agent
 * rings their saved number from Regular Customers and the order is written
 * during the call. `call_sessions_has_target` requires one of the two.
 */
export type CallTarget = { orderId: string; customerId?: string | null } | { customerId: string; orderId?: string | null };

export async function getActiveSession(agentId: string): Promise<CallSession | null> {
  const { data, error } = await supabaseAdmin
    .from("call_sessions")
    .select("*")
    .eq("agent_id", agentId)
    .is("ended_at", null)
    .maybeSingle();
  if (error) throw new Error(`call_sessions read failed: ${error.message}`);
  return data ? map(data) : null;
}

export async function getActiveSessionForOrder(agentId: string, orderId: string): Promise<CallSession | null> {
  const active = await getActiveSession(agentId);
  return active && active.order_id === orderId ? active : null;
}

/**
 * The longest an open session is still believed to be a call.
 *
 * Nothing closes a session except the agent pressing End, so one left behind by
 * a closed tab or a dead battery runs until somebody notices. Measured over the
 * 13,364 sessions on record: 72 ran past fifteen minutes, and those 72 hold 90
 * of the 433 recorded talk hours — a fifth of all talk time, out of half a
 * percent of the calls. The longest was 13.6 hours.
 *
 * Three things go wrong while one is open. The board shows the agent On Call
 * indefinitely. The day's standby is elapsed-minus-talk, so it collapses to
 * zero once the session finally closes. And the partial unique index allows one
 * open session per agent, so the agent cannot start their next call at all —
 * every press of Start answers 409 until they think to press End first.
 *
 * Thirty minutes is far past a real retention call — the median is 70 seconds
 * and the mean 97 — and past all but 27 sessions ever recorded, so a genuinely
 * long call is left alone.
 */
export const MAX_CALL_SECONDS = 30 * 60;

/** True once an open session has run longer than any real call would. */
export function isAbandoned(startedAt: string, now: number = Date.now()): boolean {
  return now - new Date(startedAt).getTime() > MAX_CALL_SECONDS * 1000;
}

export type StartResult =
  | { ok: true; session: CallSession }
  | { ok: false; reason: "already_active"; session: CallSession };

/** Opens a session. If the agent already has one — including on this same
 * order, which happens when a popup is reopened — the existing session is
 * returned rather than a second one being created. */
export async function startSession(agentId: string, target: CallTarget): Promise<StartResult> {
  const { data, error } = await supabaseAdmin
    .from("call_sessions")
    .insert({
      agent_id: agentId,
      order_id: target.orderId ?? null,
      customer_id: target.customerId ?? null,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      const active = await getActiveSession(agentId);
      // An abandoned session is not a call in progress, and refusing the new
      // call because of one strands the agent: the only way out was to press
      // End on a call that finished hours ago, and an agent who does not know
      // that simply stops using the button — which is exactly when the board
      // starts reporting them as standing by while they are on the phone.
      if (active && isAbandoned(active.started_at)) {
        // Tolerant of a race: if another request closed it first, fall through
        // and report what is actually open rather than failing the call.
        try {
          await endSession(active.id, { remarks: "Closed automatically — left open past the maximum call length." });
          return startSession(agentId, target);
        } catch {
          const still = await getActiveSession(agentId);
          if (still) return { ok: false, reason: "already_active", session: still };
          return startSession(agentId, target);
        }
      }
      if (active) return { ok: false, reason: "already_active", session: active };
    }
    throw new Error(`Could not start the call: ${error.message}`);
  }
  return { ok: true, session: map(data) };
}

/**
 * Points a customer call at the order it just produced.
 *
 * A call raised from a Regular Customer's record starts with no order — there
 * is none yet — and the agent writes one while still on the phone. Attaching it
 * here is what makes that call indistinguishable from a lead call afterwards:
 * it shows in the order's call history, the monitor names the order, and the
 * status-update gate (getActiveSessionForOrder) recognises the open session.
 *
 * Guarded on `order_id is null` so this can only ever fill a gap: a session
 * already pointing at an order is never redirected to another one.
 */
export async function attachOrderToSession(sessionId: string, orderId: string): Promise<CallSession | null> {
  const { data, error } = await supabaseAdmin
    .from("call_sessions")
    .update({ order_id: orderId })
    .eq("id", sessionId)
    .is("order_id", null)
    .is("ended_at", null)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`Could not attach the call to the order: ${error.message}`);
  return data ? map(data) : null;
}

/** Closes a session, recording the status transition it produced (if any).
 * Duration is computed from the stored `started_at` rather than anything the
 * client reports, so a tampered or drifting clock cannot inflate it. */
export async function endSession(
  sessionId: string,
  fields: { previousStatus?: string | null; newStatus?: string | null; remarks?: string | null }
): Promise<CallSession> {
  const { data: existing, error: readError } = await supabaseAdmin
    .from("call_sessions")
    .select("started_at")
    .eq("id", sessionId)
    .single();
  if (readError) throw new Error(`call_sessions read failed: ${readError.message}`);

  const endedAt = new Date();
  const startedAt = new Date(String(existing.started_at));
  const duration = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));

  const { data, error } = await supabaseAdmin
    .from("call_sessions")
    .update({
      ended_at: endedAt.toISOString(),
      duration_seconds: duration,
      previous_status: fields.previousStatus ?? null,
      new_status: fields.newStatus ?? null,
      remarks: fields.remarks ?? null,
    })
    .eq("id", sessionId)
    .is("ended_at", null)
    .select("*")
    .single();
  if (error) throw new Error(`Could not end the call: ${error.message}`);
  return map(data);
}

/** Call history for an order, newest first. */
export async function listSessionsForOrder(orderId: string): Promise<CallSession[]> {
  const { data, error } = await supabaseAdmin
    .from("call_sessions")
    .select("*")
    .eq("order_id", orderId)
    .order("started_at", { ascending: false });
  if (error) throw new Error(`call_sessions read failed: ${error.message}`);
  return (data || []).map(map);
}

/**
 * Call history for a page of orders, keyed by order id — one query, not one
 * per row.
 *
 * The Leads page used to call listSessionsForOrder() inside a loop, which is
 * survivable at twenty-five rows and is what stopped the page size being
 * raised: a hundred rows meant a hundred round trips before anything rendered.
 */
export async function listSessionsForOrders(orderIds: string[]): Promise<Map<string, CallSession[]>> {
  const byOrder = new Map<string, CallSession[]>();
  if (orderIds.length === 0) return byOrder;

  const { data, error } = await supabaseAdmin
    .from("call_sessions")
    .select("*")
    .in("order_id", orderIds)
    .order("started_at", { ascending: false });
  if (error) throw new Error(`call_sessions read failed: ${error.message}`);

  for (const row of data || []) {
    const session = map(row);
    const key = session.order_id;
    if (!key) continue;
    const list = byOrder.get(key);
    if (list) list.push(session);
    else byOrder.set(key, [session]);
  }
  return byOrder;
}

/** Every agent currently on a call, keyed by agent id — one query for the whole
 * monitor rather than one per row. */
export async function getActiveSessions(agentIds: string[]): Promise<Map<string, CallSession>> {
  const out = new Map<string, CallSession>();
  if (agentIds.length === 0) return out;
  const { data, error } = await supabaseAdmin
    .from("call_sessions")
    .select("*")
    .in("agent_id", agentIds)
    .is("ended_at", null);
  if (error) throw new Error(`call_sessions read failed: ${error.message}`);
  for (const row of data || []) {
    const session = map(row);
    // An open session past the maximum call length is a leftover, not a live
    // call. Showing it as one had the board reporting "On Call 6:41:22" — which
    // is worse than saying nothing, because a supervisor reads it as a real
    // conversation. It is closed on the agent's next Start; until then the row
    // simply does not count as a call in progress.
    if (isAbandoned(session.started_at)) continue;
    out.set(String(row.agent_id), session);
  }
  return out;
}

/** What a live call is a call OF, for the monitor. */
export interface CallTargetInfo {
  kind: CallKind;
  /** Null while a regular customer's order has not been written yet. */
  orderNumber: string | null;
  /** The person being rung. Null only if the record behind the call vanished. */
  customerName: string | null;
}

/**
 * Describes the calls in progress — a lead, or one of the agent's own regular
 * customers, and who.
 *
 * The monitor showed an order number and nothing else, which said what was
 * being worked but not what kind of work it was. A supervisor watching the
 * board wants to know whether the floor is calling fresh leads or its repeat
 * buyers, and a call raised from a Regular Customer's record has no order
 * number at all until the order is written.
 *
 * Two queries at most, both keyed by primary key over the handful of calls
 * actually running. Keyed by session id in the returned map, since one agent's
 * call is one session.
 */
export async function describeCallTargets(sessions: CallSession[]): Promise<Map<string, CallTargetInfo>> {
  const out = new Map<string, CallTargetInfo>();
  if (sessions.length === 0) return out;

  const orderIds = Array.from(new Set(sessions.map((s) => s.order_id).filter((id): id is string => Boolean(id))));
  const customerIds = Array.from(new Set(sessions.map((s) => s.customer_id).filter((id): id is string => Boolean(id))));

  const [orders, customers] = await Promise.all([
    orderIds.length
      ? supabaseAdmin.from("orders").select("id, order_number, customer_name, is_regular_customer").in("id", orderIds)
      : Promise.resolve({ data: [], error: null }),
    customerIds.length
      ? supabaseAdmin.from("customers").select("id, full_name").in("id", customerIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (orders.error) throw new Error(`Call target lookup failed: ${orders.error.message}`);
  if (customers.error) throw new Error(`Call target lookup failed: ${customers.error.message}`);

  const orderById = new Map((orders.data || []).map((o) => [String(o.id), o as Record<string, unknown>]));
  const customerById = new Map((customers.data || []).map((c) => [String(c.id), c as Record<string, unknown>]));

  for (const session of sessions) {
    const order = session.order_id ? orderById.get(session.order_id) : undefined;
    const customer = session.customer_id ? customerById.get(session.customer_id) : undefined;
    // A call started from a customer's record is a regular-customer call for
    // the whole of its life, order or no order. A lead call becomes one only
    // if the order itself is tagged — which is how a repeat buyer rung through
    // the Leads list still reads correctly.
    const kind: CallKind = session.customer_id || order?.is_regular_customer ? "regular_customer" : "lead";
    out.set(session.id, {
      kind,
      orderNumber: order ? String(order.order_number) : null,
      customerName: customer ? String(customer.full_name) : order ? String(order.customer_name || "") || null : null,
    });
  }
  return out;
}

export interface CallDayTotals {
  count: number;
  seconds: number;
  /** When the last completed call ended, ISO. Null when there were none.
   *
   * Carried so the monitor can tell when standby actually began: an agent who
   * has just hung up is seconds into standby, not hours, however long ago they
   * timed in. */
  lastEndedAt: string | null;
}

/** Who was on the other end: a lead being worked, or the agent's own repeat
 * buyer rung from their Regular Customers record. */
export type CallKind = "lead" | "regular_customer";

export interface CallRecord {
  id: string;
  agent_id: string;
  /** Null for a call on a regular customer that produced no order. */
  order_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  new_status: string | null;
  kind: CallKind;
  /** Empty when the call never produced an order. */
  order_number: string;
  customer_name: string;
  customer_phone: string;
  /**
   * Whether THIS call closed the sale — its recorded status transition landed
   * on a sale status.
   *
   * Not "the order it was on eventually became a sale", which is what keying on
   * `order_date` gave and which was wrong on the page: a lead rung at 08:26 and
   * left at Ringing, then rung again at 09:01 and moved to Packaging, carried
   * the tick on both rows. The first call did not produce an order — its own
   * Result column said Ringing beside the tick — and the day's "N ordered"
   * figure counted one sale once per call made to it.
   */
  ordered: boolean;
  /** The order's total, on the call that closed it. */
  order_amount: number | null;
  /** Where the order stands now — not necessarily what this call set. */
  order_status: string | null;
}

/**
 * The calls themselves for one day — who was rung, on what number, and what came
 * of it.
 *
 * Everything else about calling reports a COUNT: the monitor's Calls column, the
 * activity report, the dashboard. An agent halfway through a list of five
 * hundred imported leads wants the other thing — which numbers they have already
 * been through — and there was nowhere in the app that said.
 *
 * The customer comes from the order in the same query. Six hundred calls a day
 * would otherwise be six hundred round trips, or one URL carrying six hundred
 * uuids.
 *
 * The day window matches callTotalsForDay exactly, deliberately: a list that
 * disagreed with the count on the tile above it would be worse than either.
 *
 * SQL (`calls_for_day`) rather than PostgREST, because of the filters. Whether
 * a call is a regular customer's is true when it was raised from their record
 * OR when the order behind it is tagged — an OR across call_sessions and
 * orders, which PostgREST can only express by inner joining the embed, and that
 * would drop exactly the regular-customer calls that produced no order.
 * Filtering the page in TypeScript instead would make the count and the paging
 * lie.
 */
export interface CallListFilters {
  /** "all", or only leads, or only the agent's own regular customers. */
  kind?: CallKind | "all";
  /** Only the calls that closed a sale. */
  orderedOnly?: boolean;
}

export async function listCallsForDay(
  agentIds: string[],
  workDate: string,
  page: number,
  pageSize: number,
  filters: CallListFilters = {}
): Promise<{ rows: CallRecord[]; total: number }> {
  if (agentIds.length === 0) return { rows: [], total: 0 };

  const { data, error } = await supabaseAdmin.rpc("calls_for_day", {
    p_agent_ids: agentIds,
    p_date: workDate,
    p_page: page,
    p_page_size: pageSize,
    p_kind: filters.kind ?? "all",
    p_ordered_only: Boolean(filters.orderedOnly),
    // The day is a local calendar day, and the function has no way to know
    // which zone that is. Handed in for the same reason p_sale_statuses is:
    // one definition, in the app, rather than a second copy living in SQL.
    p_timezone: APP_TIMEZONE,
    // Handed in rather than written in SQL, following agent_daily_order_stats:
    // lib/validation.ts stays the only place that defines what counts as a sale.
    p_sale_statuses: SALE_STATUSES as unknown as string[],
  });
  if (error) throw new Error(`call_sessions read failed: ${error.message}`);

  const payload = (data || { rows: [], total: 0 }) as { rows: Record<string, unknown>[]; total: number };
  const rows = (payload.rows || []).map((r) => ({
    id: String(r.id),
    agent_id: String(r.agent_id),
    order_id: r.order_id ? String(r.order_id) : null,
    started_at: String(r.started_at),
    ended_at: r.ended_at ? String(r.ended_at) : null,
    duration_seconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
    new_status: r.new_status ? String(r.new_status) : null,
    kind: (r.is_regular ? "regular_customer" : "lead") as CallKind,
    order_number: String(r.order_number ?? ""),
    // The customer record wins the naming when there is one, because that is
    // who the agent chose to ring; the order's own fields are the fallback.
    // Resolved in SQL, so both sides of that choice are one column here.
    customer_name: String(r.customer_name ?? ""),
    customer_phone: String(r.customer_phone ?? ""),
    ordered: Boolean(r.ordered),
    order_amount: r.total_amount == null ? null : Number(r.total_amount),
    order_status: r.order_status ? String(r.order_status) : null,
  }));
  return { rows, total: Number(payload.total ?? 0) };
}

/** Completed call count and talk time for one day, per agent. Unlike
 * countCompletedSessions this applies no minimum-duration floor: the monitor
 * reports what actually happened, and the floor is a performance-scoring rule
 * rather than a reporting one. The call in progress is excluded, so the monitor
 * can add its live elapsed time and keep ticking. */
export async function callTotalsForDay(agentIds: string[], workDate: string): Promise<Map<string, CallDayTotals>> {
  const out = new Map<string, CallDayTotals>();
  if (agentIds.length === 0) return out;

  const { data, error } = await supabaseAdmin
    .from("call_sessions")
    .select("agent_id, duration_seconds, ended_at")
    .in("agent_id", agentIds)
    .not("ended_at", "is", null)
    // The local day, not the UTC one. See dayRangeUtc: bounding a Manila date
    // with UTC midnight opened the window at 08:00 and dropped the calls before
    // it.
    .gte("started_at", dayRangeUtc(workDate).start)
    .lt("started_at", dayRangeUtc(workDate).endExclusive);
  if (error) throw new Error(`call_sessions read failed: ${error.message}`);

  for (const row of data || []) {
    const key = String(row.agent_id);
    const current = out.get(key) || { count: 0, seconds: 0, lastEndedAt: null };
    current.count += 1;
    // Capped: an abandoned session would otherwise donate its whole open-ended
    // length to the day, and standby is what is left after talk is subtracted.
    current.seconds += Math.min(Number(row.duration_seconds ?? 0), MAX_CALL_SECONDS);
    const ended = row.ended_at ? String(row.ended_at) : null;
    if (ended && (!current.lastEndedAt || ended > current.lastEndedAt)) current.lastEndedAt = ended;
    out.set(key, current);
  }
  return out;
}

/** The same totals across a date range, for the activity report.
 *
 * A separate query rather than looping callTotalsForDay over the range: a
 * month would be thirty round trips to a database two Pacific crossings away,
 * and the report only ever wants the sum. Like the day version it applies no
 * minimum-duration floor -- that floor is a performance-scoring rule, and this
 * reports what actually happened. */
export async function callTotalsForRange(
  agentIds: string[],
  from: string,
  to: string
): Promise<Map<string, CallDayTotals>> {
  const out = new Map<string, CallDayTotals>();
  if (agentIds.length === 0) return out;

  const { data, error } = await supabaseAdmin
    .from("call_sessions")
    .select("agent_id, duration_seconds")
    .in("agent_id", agentIds)
    .not("ended_at", "is", null)
    .gte("started_at", dayRangeUtc(from, to).start)
    .lt("started_at", dayRangeUtc(from, to).endExclusive);
  if (error) throw new Error(`call_sessions read failed: ${error.message}`);

  for (const row of data || []) {
    const key = String(row.agent_id);
    const current = out.get(key) || { count: 0, seconds: 0, lastEndedAt: null };
    current.count += 1;
    // Same cap as the daily totals, so the Activity Report and the monitor
    // cannot disagree about how long an agent spent talking.
    current.seconds += Math.min(Number(row.duration_seconds ?? 0), MAX_CALL_SECONDS);
    out.set(key, current);
  }
  return out;
}

/** Completed sessions per agent per day — the basis for Calls Made.
 * `minSeconds` comes from Settings and is 0 by default, so nothing is filtered
 * out until there is real session data to justify a floor. */
export async function countCompletedSessions(
  agentIds: string[],
  from: string,
  to: string,
  minSeconds: number
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (agentIds.length === 0) return counts;

  const { data, error } = await supabaseAdmin
    .from("call_sessions")
    .select("agent_id, started_at, duration_seconds")
    .in("agent_id", agentIds)
    .not("ended_at", "is", null)
    .gte("started_at", dayRangeUtc(from, to).start)
    .lt("started_at", dayRangeUtc(from, to).endExclusive);
  if (error) throw new Error(`call_sessions read failed: ${error.message}`);

  for (const row of data || []) {
    if (minSeconds > 0 && Number(row.duration_seconds ?? 0) < minSeconds) continue;
    const key = `${row.agent_id}|${String(row.started_at).slice(0, 10)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}
