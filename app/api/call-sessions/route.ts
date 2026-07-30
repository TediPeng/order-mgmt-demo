import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDb, writeDb } from "@/lib/db";
import { orderInScope } from "@/lib/order-access";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { startSession, endSession, getActiveSession } from "@/lib/call-sessions";
import { timeInBlockReason, TIME_IN_HREF } from "@/lib/time-in-gate";

export const dynamic = "force-dynamic";

/** Opens a calling session on an order.
 *
 * Answers 409 with the order already in progress when the agent has another
 * call open, so the client can offer a way back to it rather than silently
 * failing — one active call per agent is enforced by a partial unique index,
 * not by this check, so two simultaneous clicks cannot both win. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: { orderId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  const orderId = String(body.orderId || "");
  if (!orderId) return NextResponse.json({ ok: false, error: "orderId is required." }, { status: 400 });

  const db = await readDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return NextResponse.json({ ok: false, error: "Lead not found." }, { status: 404 });
  if (!orderInScope(user, order, db)) {
    return NextResponse.json({ ok: false, error: "You do not have access to that lead." }, { status: 403 });
  }

  // No call may start before the agent has timed in for the day (Section 2).
  const notTimedIn = timeInBlockReason(db, user);
  if (notTimedIn) {
    return NextResponse.json({ ok: false, error: notTimedIn, timeInRequired: true, timeInHref: TIME_IN_HREF }, { status: 403 });
  }

  const result = await startSession(user.id, orderId);
  if (!result.ok) {
    const activeOrder = db.orders.find((o) => o.id === result.session.order_id);
    return NextResponse.json(
      {
        ok: false,
        error: "You already have a call in progress.",
        activeSession: result.session,
        activeOrder: activeOrder ? { id: activeOrder.id, order_number: activeOrder.order_number } : null,
      },
      { status: 409 }
    );
  }

  logActivity(db, user.id, "CALL_SESSION_STARTED", "order", orderId, { order_number: order.order_number }, {
    module: "orders",
    ...(await getRequestInfo()),
  });
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

  const db = await readDb();
  const order = db.orders.find((o) => o.id === active.order_id);
  logActivity(db, user.id, "CALL_SESSION_ENDED", "order", active.order_id, {
    order_number: order?.order_number,
    without_update: true,
  }, { module: "orders", ...(await getRequestInfo()) });
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
