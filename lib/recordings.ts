import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { dayRangeUtc } from "@/lib/utils";

/**
 * Stored call audio, as a thing in its own right.
 *
 * Recordings have always been reachable — a player sits in a column on Numbers
 * Called — but only ever as an attribute of a call an agent made on a day
 * somebody already knew to look at. That is the wrong shape for the question
 * they are actually kept for. "Let me hear what was said to this customer" and
 * "let me listen to a few calls from yesterday" both start from the recording,
 * not from the agent's daily list, and neither was answerable without first
 * guessing whose day to open.
 *
 * So this reads the other way round: every call that HAS audio, newest first,
 * narrowed by day, by agent, or by the number that was rung.
 *
 * Administrators only, enforced by the page and independently by
 * /api/recordings/<id>, which mints the playback address. A recording is a
 * customer's voice and an agent's work at the same time; a screen that lays
 * the whole floor's out for browsing is a different trust from a player on the
 * row of a call you were already entitled to see.
 */

/** How long audio is kept. Mirrors KEEP_DAYS in the retention cron — said here
 * so the page can tell people why last month is empty. */
export const RECORDING_KEEP_DAYS = 30;

export interface RecordingRow {
  /** pbx_calls id. Playback is /api/recordings/<id>, never a storage path. */
  id: string;
  startedAt: string;
  answeredAt: string | null;
  extension: string | null;
  agentId: string | null;
  /** The number as the dialplan saw it. */
  dialedRaw: string | null;
  /** Seconds of actual conversation, after pickup. */
  billsec: number | null;
  bytes: number | null;
  /** The ROMA call this was matched to, when it was matched to one. */
  callSessionId: string | null;
  /** From the order or regular customer behind that session. */
  customerName: string | null;
  orderId: string | null;
  orderNumber: string | null;
}

export interface RecordingQuery {
  /** Calendar day in the company's timezone. Ignored when `phone` is given. */
  date: string;
  agentId?: string | null;
  /** Digits to look for in the number dialled. Searches every stored day. */
  phone?: string | null;
  page: number;
  pageSize: number;
}

export async function listRecordings(q: RecordingQuery): Promise<{ rows: RecordingRow[]; total: number }> {
  const from = (q.page - 1) * q.pageSize;

  let query = supabaseAdmin
    .from("pbx_calls")
    .select(
      "id, started_at, answered_at, extension, agent_id, dialed_raw, billsec, recording_bytes, call_session_id",
      { count: "exact" }
    )
    .not("recording_path", "is", null)
    // Newest first, and an explicit order because the range below is
    // meaningless without one — see the 1000-row cap the hard way.
    .order("started_at", { ascending: false })
    .range(from, from + q.pageSize - 1);

  // A number search deliberately ignores the day.
  //
  // Somebody typing a phone number wants THAT customer, not that customer on
  // the day that happens to be in the box — and the day in the box is today,
  // which is exactly the day a complaint about last week is not on.
  const digits = String(q.phone ?? "").replace(/[^0-9]/g, "");
  if (digits) {
    query = query.ilike("dialed_raw", `%${digits}%`);
  } else {
    const { start, endExclusive } = dayRangeUtc(q.date);
    query = query.gte("started_at", start).lt("started_at", endExclusive);
  }

  if (q.agentId) query = query.eq("agent_id", q.agentId);

  const { data, error, count } = await query;
  if (error) throw new Error(`recordings read failed: ${error.message}`);

  const calls = data || [];
  if (calls.length === 0) return { rows: [], total: count || 0 };

  // Who was on the other end, in two more small queries rather than an embed.
  //
  // pbx_calls is not part of the app's whole-database read, and PostgREST
  // embedding here would tie this to the names of foreign keys two levels down
  // — call_sessions to orders to customers. A page of fifty ids is cheap.
  const sessionIds = [...new Set(calls.map((c) => c.call_session_id).filter((v): v is string => Boolean(v)))];
  const sessions = sessionIds.length
    ? (
        await supabaseAdmin
          .from("call_sessions")
          .select("id, order_id, customer_id")
          .in("id", sessionIds)
      ).data || []
    : [];
  const sessionById = new Map(sessions.map((s) => [String(s.id), s]));

  const orderIds = [...new Set(sessions.map((s) => s.order_id).filter((v): v is string => Boolean(v)))];
  const orders = orderIds.length
    ? (
        await supabaseAdmin
          .from("orders")
          .select("id, order_number, customer_name")
          .in("id", orderIds)
      ).data || []
    : [];
  const orderById = new Map(orders.map((o) => [String(o.id), o]));

  const customerIds = [...new Set(sessions.map((s) => s.customer_id).filter((v): v is string => Boolean(v)))];
  const customers = customerIds.length
    ? (
        await supabaseAdmin
          .from("customers")
          .select("id, full_name")
          .in("id", customerIds)
      ).data || []
    : [];
  const customerById = new Map(customers.map((c) => [String(c.id), c]));

  const rows: RecordingRow[] = calls.map((c) => {
    const session = c.call_session_id ? sessionById.get(String(c.call_session_id)) : undefined;
    const order = session?.order_id ? orderById.get(String(session.order_id)) : undefined;
    const customer = session?.customer_id ? customerById.get(String(session.customer_id)) : undefined;
    return {
      id: String(c.id),
      startedAt: String(c.started_at),
      answeredAt: c.answered_at ? String(c.answered_at) : null,
      extension: c.extension ? String(c.extension) : null,
      agentId: c.agent_id ? String(c.agent_id) : null,
      dialedRaw: c.dialed_raw ? String(c.dialed_raw) : null,
      billsec: c.billsec == null ? null : Number(c.billsec),
      bytes: c.recording_bytes == null ? null : Number(c.recording_bytes),
      callSessionId: c.call_session_id ? String(c.call_session_id) : null,
      // The order's name first: it is the name on the sale. A regular
      // customer's own record is the answer only when no order came of it.
      customerName: order?.customer_name || customer?.full_name || null,
      orderId: order ? String(order.id) : null,
      orderNumber: order?.order_number ? String(order.order_number) : null,
    };
  });

  return { rows, total: count || 0 };
}
