import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { OrderItem, OrderItemInput } from "@/lib/types";
// Re-exported so server callers keep a single import, while the browser takes
// the same arithmetic from lib/order-totals directly and never reaches this
// module or the service-role client it holds.
import { lineTotal } from "@/lib/order-totals";
export { lineTotal, totalsFor, summarizeItems, type OrderTotals } from "@/lib/order-totals";

/** Order line items.
 *
 * Targeted queries rather than DbShape, for the reason recorded on the table
 * itself: readDb() pulls whole tables, so lines living there would load every
 * line of every order on every page. That is the payload problem the orders
 * refactor exists to remove, and adding to it now would mean unpicking it
 * twice.
 *
 * It also sidesteps the concurrency hazard in the whole-database write, which
 * is still live for orders themselves: two agents editing different orders
 * write disjoint rows here, and cannot touch each other's lines at all.
 */

function map(row: Record<string, unknown>): OrderItem {
  return {
    id: String(row.id),
    order_id: String(row.order_id),
    position: Number(row.position ?? 0),
    product_id: row.product_id ? String(row.product_id) : null,
    product_name: String(row.product_name ?? ""),
    variant: row.variant ? String(row.variant) : null,
    quantity: Number(row.quantity ?? 0),
    unit_price: Number(row.unit_price ?? 0),
    discount: Number(row.discount ?? 0),
    line_total: Number(row.line_total ?? 0),
  };
}

export async function listItems(orderId: string): Promise<OrderItem[]> {
  const { data, error } = await supabaseAdmin
    .from("order_items")
    .select("*")
    .eq("order_id", orderId)
    .order("position", { ascending: true });
  if (error) throw new Error(`order_items read failed: ${error.message}`);
  return (data || []).map(map);
}

/** Lines for several orders at once, grouped by order. One query rather than
 * one per order — an order list showing lines would otherwise issue a query
 * per row. */
export async function listItemsFor(orderIds: string[]): Promise<Map<string, OrderItem[]>> {
  const out = new Map<string, OrderItem[]>();
  if (orderIds.length === 0) return out;

  const { data, error } = await supabaseAdmin
    .from("order_items")
    .select("*")
    .in("order_id", orderIds)
    .order("position", { ascending: true });
  if (error) throw new Error(`order_items read failed: ${error.message}`);

  for (const row of data || []) {
    const item = map(row);
    const list = out.get(item.order_id) || [];
    list.push(item);
    out.set(item.order_id, list);
  }
  return out;
}

/** Replaces an order's lines wholesale.
 *
 * Delete-then-insert rather than diffing: a line has no identity an agent
 * would recognise — reordering, swapping a product and editing a quantity are
 * indistinguishable from the form's point of view — so matching old rows to
 * new ones would be guesswork that occasionally guesses wrong. The rows are
 * small and an order has a handful of them.
 *
 * Scoped to one order_id, so it can never touch another order's lines the way
 * the whole-database write can.
 */
export async function replaceItems(orderId: string, items: OrderItemInput[]): Promise<void> {
  const { error: delError } = await supabaseAdmin.from("order_items").delete().eq("order_id", orderId);
  if (delError) throw new Error(`order_items delete failed: ${delError.message}`);

  if (items.length === 0) return;

  const rows = items.map((item, index) => ({
    order_id: orderId,
    position: index,
    product_id: item.product_id,
    product_name: item.product_name,
    variant: item.variant,
    quantity: item.quantity,
    unit_price: item.unit_price,
    discount: item.discount,
    line_total: lineTotal(item),
    updated_at: new Date().toISOString(),
  }));

  const { error: insError } = await supabaseAdmin.from("order_items").insert(rows);
  if (insError) throw new Error(`order_items insert failed: ${insError.message}`);
}
