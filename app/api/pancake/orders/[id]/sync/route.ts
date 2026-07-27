import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDb } from "@/lib/db";
import { can } from "@/lib/permissions";
import { orderInScope } from "@/lib/order-access";
import { listSyncLogs, getAccount } from "@/lib/pancake/store";
import { manualRetrySync, manualSyncNow } from "@/lib/actions/pancake";

/** Sync data + actions behind the Order Details popup's Pancake section.
 * GET: sync history (visible to anyone who can view the lead).
 * POST {mode: "sync_now" | "retry"}: Management-only (integrations:manage). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const db = await readDb();
  const order = db.orders.find((o) => o.id === id);
  if (!order) return NextResponse.json({ ok: false, error: "Lead not found." }, { status: 404 });
  if (!orderInScope(user, order, db)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const logs = await listSyncLogs({ order_id: id, limit: 50 });
  const account = order.pancake_pos_account_id ? await getAccount(order.pancake_pos_account_id) : null;
  return NextResponse.json({
    ok: true,
    account_name: account?.account_name ?? null,
    logs: logs.map((l) => ({
      id: l.id,
      action: l.action,
      old_status: l.old_status,
      new_status: l.new_status,
      request_at: l.request_at,
      http_status: l.http_status,
      result: l.result,
      error_message: l.error_message,
      source: l.source,
    })),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const db = await readDb();
  if (!can(user.role, "integrations", "manage", db.role_permissions)) {
    return NextResponse.json({ ok: false, error: "Management access required." }, { status: 403 });
  }
  const order = db.orders.find((o) => o.id === id);
  if (!order) return NextResponse.json({ ok: false, error: "Lead not found." }, { status: 404 });

  let mode = "";
  try {
    mode = String(((await req.json()) as { mode?: string }).mode || "");
  } catch {
    /* fall through to invalid-mode error */
  }
  if (mode !== "sync_now" && mode !== "retry") {
    return NextResponse.json({ ok: false, error: "mode must be 'sync_now' or 'retry'." }, { status: 400 });
  }

  const result = mode === "retry" ? await manualRetrySync(user, id) : await manualSyncNow(user, id);
  return NextResponse.json({ ok: result.ok, message: result.message });
}
