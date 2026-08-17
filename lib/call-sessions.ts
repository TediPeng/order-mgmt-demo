import { supabaseAdmin } from "@/lib/supabaseAdmin";
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
  for (const row of data || []) out.set(String(row.agent_id), map(row));
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
   * Whether the person called ended up ordering.
   *
   * Keyed on `order_date`, not on the status, because that is how Total Orders
   * and Sales are defined everywhere else in the app — the date is stamped when
   * the lead reaches Packaging and it survives the fulfillment statuses that
   * follow. Deliberately the CURRENT state of the order rather than what this
   * particular call did: Result already says what the call changed, and the
   * question being asked here is the other one.
   */
  ordered: boolean;
  /** The order's total, for a lead that converted. */
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
 */
export async function listCallsForDay(
  agentIds: string[],
  workDate: string,
  page: number,
  pageSize: number
): Promise<{ rows: CallRecord[]; total: number }> {
  if (agentIds.length === 0) return { rows: [], total: 0 };

  const from = (page - 1) * pageSize;
  const { data, count, error } = await supabaseAdmin
    .from("call_sessions")
    .select(
      // Both embeds are LEFT joins. `orders!inner` was right while every call
      // had an order; a call raised from a Regular Customer's record has none
      // until the order is written, and an inner join would drop exactly the
      // calls that never produced a sale — the ones this page is for.
      "id, agent_id, order_id, customer_id, started_at, ended_at, duration_seconds, new_status, orders(order_number, customer_name, customer_phone, is_regular_customer, order_date, status, total_amount), customers(full_name, phone_raw)",
      { count: "exact" }
    )
    .in("agent_id", agentIds)
    .gte("started_at", `${workDate}T00:00:00Z`)
    .lte("started_at", `${workDate}T23:59:59Z`)
    // started_at is unique enough in practice, but id is the tie-break that
    // keeps a row from appearing on two pages when two calls share a second.
    .order("started_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) throw new Error(`call_sessions read failed: ${error.message}`);

  const rows = (data || []).map((row) => {
    const r = row as unknown as Record<string, unknown>;
    // PostgREST returns the embedded row as an object for a to-one relation,
    // but types it as an array; either shape is accepted here rather than cast.
    const order = (Array.isArray(r.orders) ? r.orders[0] : r.orders) as Record<string, unknown> | undefined;
    const customer = (Array.isArray(r.customers) ? r.customers[0] : r.customers) as Record<string, unknown> | undefined;
    // The customer record wins the naming when there is one, because that is
    // who the agent chose to ring; the order's own fields are what a lead call
    // has and are the fallback.
    return {
      id: String(r.id),
      agent_id: String(r.agent_id),
      order_id: r.order_id ? String(r.order_id) : null,
      started_at: String(r.started_at),
      ended_at: r.ended_at ? String(r.ended_at) : null,
      duration_seconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
      new_status: r.new_status ? String(r.new_status) : null,
      kind: (r.customer_id || order?.is_regular_customer ? "regular_customer" : "lead") as CallKind,
      order_number: String(order?.order_number ?? ""),
      customer_name: String(customer?.full_name ?? order?.customer_name ?? ""),
      customer_phone: String(customer?.phone_raw ?? order?.customer_phone ?? ""),
      ordered: Boolean(order?.order_date),
      order_amount: order?.total_amount == null ? null : Number(order.total_amount),
      order_status: order?.status ? String(order.status) : null,
    };
  });
  return { rows, total: count ?? 0 };
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
    .gte("started_at", `${workDate}T00:00:00Z`)
    .lte("started_at", `${workDate}T23:59:59Z`);
  if (error) throw new Error(`call_sessions read failed: ${error.message}`);

  for (const row of data || []) {
    const key = String(row.agent_id);
    const current = out.get(key) || { count: 0, seconds: 0, lastEndedAt: null };
    current.count += 1;
    current.seconds += Number(row.duration_seconds ?? 0);
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
    .gte("started_at", `${from}T00:00:00Z`)
    .lte("started_at", `${to}T23:59:59Z`);
  if (error) throw new Error(`call_sessions read failed: ${error.message}`);

  for (const row of data || []) {
    const key = String(row.agent_id);
    const current = out.get(key) || { count: 0, seconds: 0, lastEndedAt: null };
    current.count += 1;
    current.seconds += Number(row.duration_seconds ?? 0);
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
    .gte("started_at", `${from}T00:00:00Z`)
    .lte("started_at", `${to}T23:59:59Z`);
  if (error) throw new Error(`call_sessions read failed: ${error.message}`);

  for (const row of data || []) {
    if (minSeconds > 0 && Number(row.duration_seconds ?? 0) < minSeconds) continue;
    const key = `${row.agent_id}|${String(row.started_at).slice(0, 10)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}
