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
export async function startSession(agentId: string, orderId: string): Promise<StartResult> {
  const { data, error } = await supabaseAdmin
    .from("call_sessions")
    .insert({ agent_id: agentId, order_id: orderId })
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

export interface CallDayTotals {
  count: number;
  seconds: number;
}

export interface CallRecord {
  id: string;
  agent_id: string;
  order_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  new_status: string | null;
  order_number: string;
  customer_name: string;
  customer_phone: string;
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
      "id, agent_id, order_id, started_at, ended_at, duration_seconds, new_status, orders!inner(order_number, customer_name, customer_phone)",
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
    const embedded = (Array.isArray(r.orders) ? r.orders[0] : r.orders) as Record<string, unknown> | undefined;
    return {
      id: String(r.id),
      agent_id: String(r.agent_id),
      order_id: String(r.order_id),
      started_at: String(r.started_at),
      ended_at: r.ended_at ? String(r.ended_at) : null,
      duration_seconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
      new_status: r.new_status ? String(r.new_status) : null,
      order_number: String(embedded?.order_number ?? ""),
      customer_name: String(embedded?.customer_name ?? ""),
      customer_phone: String(embedded?.customer_phone ?? ""),
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
    .select("agent_id, duration_seconds")
    .in("agent_id", agentIds)
    .not("ended_at", "is", null)
    .gte("started_at", `${workDate}T00:00:00Z`)
    .lte("started_at", `${workDate}T23:59:59Z`);
  if (error) throw new Error(`call_sessions read failed: ${error.message}`);

  for (const row of data || []) {
    const key = String(row.agent_id);
    const current = out.get(key) || { count: 0, seconds: 0 };
    current.count += 1;
    current.seconds += Number(row.duration_seconds ?? 0);
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
    const current = out.get(key) || { count: 0, seconds: 0 };
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
