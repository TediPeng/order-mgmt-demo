import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDbLite, writeDb, loadOrderInto } from "@/lib/db";
import { orderInScope, allowedAssigneeIds } from "@/lib/order-access";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { startSession, endSession, getActiveSession, type CallTarget } from "@/lib/call-sessions";
import { getActiveBioBreak } from "@/lib/bio-breaks";
import { getCustomer } from "@/lib/customers";
import { timeInBlockReason, TIME_IN_HREF } from "@/lib/time-in-gate";
import type { Customer, Order } from "@/lib/types";

export const dynamic = "force-dynamic";

/** The order or the regular customer already holding this agent's call, so the
 * client can offer a way back to whichever it is. */
async function describeActive(
  db: Awaited<ReturnType<typeof readDbLite>>,
  session: { order_id: string | null; customer_id: string | null }
) {
  const order = session.order_id ? await loadOrderInto(db, session.order_id) : null;
  const customer = !session.order_id && session.customer_id ? await getCustomer(session.customer_id) : null;
  return {
    activeOrder: order ? { id: order.id, order_number: order.order_number } : null,
    activeCustomer: customer ? { id: customer.id, full_name: customer.full_name } : null,
  };
}

/** Opens a calling session on an order, or on a regular customer who has no
 * order yet — the agent rings them from their record and writes the order
 * during the call, which createLeadAction then attaches to this session.
 *
 * Answers 409 with the order already in progress when the agent has another
 * call open, so the client can offer a way back to it rather than silently
 * failing — one active call per agent is enforced by a partial unique index,
 * not by this check, so two simultaneous clicks cannot both win. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: { orderId?: string; customerId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  const orderId = String(body.orderId || "");
  const customerId = String(body.customerId || "");
  if (!orderId && !customerId) {
    return NextResponse.json({ ok: false, error: "orderId or customerId is required." }, { status: 400 });
  }

  // The lead being called, not the table it lives in — this runs at the start
  // of every call.
  const db = await readDbLite();

  let order: Order | null = null;
  let customer: Customer | null = null;
  let target: CallTarget;

  if (orderId) {
    order = await loadOrderInto(db, orderId);
    if (!order) return NextResponse.json({ ok: false, error: "Lead not found." }, { status: 404 });
    if (!orderInScope(user, order, db)) {
      return NextResponse.json({ ok: false, error: "You do not have access to that lead." }, { status: 403 });
    }
    target = { orderId };
  } else {
    customer = await getCustomer(customerId);
    if (!customer || !customer.is_regular_customer) {
      return NextResponse.json({ ok: false, error: "Regular customer not found." }, { status: 404 });
    }
    // The same rule that decides who a new order may be attributed to, which is
    // what this call is about to become. An agent cannot ring another agent's
    // customer by guessing an id.
    if (!allowedAssigneeIds(user, db).includes(customer.owner_agent_id)) {
      return NextResponse.json({ ok: false, error: "You do not have access to that customer." }, { status: 403 });
    }
    target = { customerId };
  }

  // No call may start before the agent has timed in for the day (Section 2).
  const notTimedIn = timeInBlockReason(db, user);
  if (notTimedIn) {
    return NextResponse.json({ ok: false, error: notTimedIn, timeInRequired: true, timeInHref: TIME_IN_HREF }, { status: 403 });
  }

  // Bio breaks and calls are mutually exclusive, so an agent is never both On
  // Call and On Break at once and the monitor's standby arithmetic has no
  // overlapping intervals to reconcile. The reverse guard lives in
  // startBioBreak().
  const onBioBreak = await getActiveBioBreak(user.id);
  if (onBioBreak) {
    return NextResponse.json(
      { ok: false, error: "End your bio break before starting a call." },
      { status: 409 }
    );
  }

  const result = await startSession(user.id, target);
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "You already have a call in progress.",
        activeSession: result.session,
        ...(await describeActive(db, result.session)),
      },
      { status: 409 }
    );
  }

  // Logged against whichever record the call is of, so the customer's own audit
  // trail carries the calls made to them and not only the orders they produced.
  if (order) {
    logActivity(db, user.id, "CALL_SESSION_STARTED", "order", order.id, { order_number: order.order_number }, {
      module: "orders",
      ...(await getRequestInfo()),
    });
  } else if (customer) {
    logActivity(db, user.id, "CALL_SESSION_STARTED", "customer", customer.id, {
      customer_name: customer.full_name,
      customer_phone: customer.phone_raw,
      regular_customer: true,
    }, { module: "regular_customers", ...(await getRequestInfo()) });
  }
  await writeDb(db);

  return NextResponse.json({ ok: true, session: result.session });
}

/** Ends the active session without changing the order.
 *
 * Without this an agent who opens a call and then has nothing to record would
 * be stuck: the popup refuses to close quietly on an open call, and the unique
 * index would block their next one. */
export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const active = await getActiveSession(user.id);
  if (!active) return NextResponse.json({ ok: true, ended: false });

  await endSession(active.id, { previousStatus: null, newStatus: null, remarks: "Ended without a status update" });

  const db = await readDbLite();
  // A call ended before any order was written is recorded against the customer
  // — there is no order to hang it on, and the call still happened.
  if (active.order_id) {
    const order = await loadOrderInto(db, active.order_id);
    logActivity(db, user.id, "CALL_SESSION_ENDED", "order", active.order_id, {
      order_number: order?.order_number,
      without_update: true,
    }, { module: "orders", ...(await getRequestInfo()) });
  } else if (active.customer_id) {
    const customer = await getCustomer(active.customer_id);
    logActivity(db, user.id, "CALL_SESSION_ENDED", "customer", active.customer_id, {
      customer_name: customer?.full_name,
      without_update: true,
      no_order_created: true,
    }, { module: "regular_customers", ...(await getRequestInfo()) });
  }
  await writeDb(db);

  return NextResponse.json({ ok: true, ended: true });
}

/** The active session, if any — lets a reopened popup restore its timer. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const active = await getActiveSession(user.id);
  return NextResponse.json({ ok: true, session: active });
}
