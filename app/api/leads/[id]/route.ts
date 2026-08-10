import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDbLite, writeDb } from "@/lib/db";
import { can } from "@/lib/permissions";
import { applyLeadUpdate, afterLeadUpdatePersisted } from "@/lib/actions/leads";
import { getOrderRow } from "@/lib/pancake/store";
import { z } from "zod";
import { orderItemSchema, type OrderItemFields } from "@/lib/validation";
import { replaceItems } from "@/lib/order-items";
import { logActivity } from "@/lib/activity";
import { describeParseFailure } from "@/lib/zod-error";

/** Powers the Order Details modal's Edit/Update Status flows -- same
 * validation, RTS gating, and activity logging as the full-page form
 * (lib/actions/leads.ts#applyLeadUpdate), but responds with JSON instead of
 * redirecting so the modal never navigates or reloads the Leads page. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  // applyLeadUpdate() loads the one order it is about; nothing else here
  // touches the table.
  const db = await readDbLite();
  if (!can(user.role, "orders", "edit", db.role_permissions)) {
    return NextResponse.json({ ok: false, error: "You do not have permission to perform this action." }, { status: 403 });
  }

  let raw: Record<string, unknown>;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  // Lines arrive as an array on the body rather than as repeated form fields.
  // Absent means this save is not about the products — the Update Status path
  // sends no items — and the order's existing lines must survive it.
  let postedItems: OrderItemFields[] | null = null;
  if (Array.isArray(raw.items)) {
    const parsed = z.array(orderItemSchema).safeParse(raw.items);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: describeParseFailure(parsed.error) }, { status: 400 });
    }
    postedItems = parsed.data;
  }
  delete raw.items;

  const result = await applyLeadUpdate(user, db, id, raw, postedItems);
  if (!result.ok) {
    const status = result.code === "not_found" ? 404 : result.code === "forbidden" ? 403 : 400;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }

  await writeDb(db);

  // After writeDb: the lines hold a foreign key to an order that has to exist
  // first. Null means the save was not about the products and the existing
  // lines stand. A failure is recorded rather than thrown, as on the form
  // paths — the order is saved, and reporting failure for a save that
  // succeeded invites the agent to repeat it.
  if (result.items) {
    try {
      await replaceItems(id, result.items);
    } catch (e) {
      logActivity(db, user.id, "ORDER_ITEMS_WRITE_FAILED", "order", id, {
        order_number: result.order.order_number,
        lines: result.items.length,
        error: (e as Error).message,
      }, { module: "orders" });
      await writeDb(db);
    }
  }

  await afterLeadUpdatePersisted(user, result);
  // The forward may have just updated sync fields — return the fresh row so
  // the modal's sync chip is current without an extra refresh.
  const fresh = result.enteredPackaging ? await getOrderRow(id) : null;
  return NextResponse.json({ ok: true, order: fresh || result.order });
}
