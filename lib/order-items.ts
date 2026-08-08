import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { OrderItem, OrderItemInput } from "@/lib/types";

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

/** quantity × unit price − discount, rounded to centavos. One definition,
 * used when writing a line and when totalling an order, so the parts can
 * never disagree with the whole. */
export function lineTotal(item: { quantity: number; unit_price: number; discount: number }): number {
  const gross = (item.unit_price || 0) * (item.quantity || 0);
  return Math.round((gross - (item.discount || 0)) * 100) / 100;
}

export interface OrderTotals {
  /** Units across every line — what orders.quantity carries. */
  quantity: number;
  /** Summed line discounts — what orders.discount carries. Agents enter
   * discounts per line; the order-level column is their sum rather than a
   * second figure someone types, because two competing inputs produce totals
   * that disagree with themselves. */
  discount: number;
  /** Lines only, before shipping. */
  subtotal: number;
  /** Grand total: subtotal + shipping. Line discounts are already deducted
   * inside each line_total. */
  total: number;
}

export function totalsFor(items: { quantity: number; unit_price: number; discount: number }[], shippingFee: number | null): OrderTotals {
  const subtotal = items.reduce((sum, i) => sum + lineTotal(i), 0);
  return {
    quantity: items.reduce((sum, i) => sum + (i.quantity || 0), 0),
    discount: Math.round(items.reduce((sum, i) => sum + (i.discount || 0), 0) * 100) / 100,
    subtotal: Math.round(subtotal * 100) / 100,
    total: Math.round((subtotal + (shippingFee ?? 0)) * 100) / 100,
  };
}

/** The summary shown wherever one order gets one line of text — lists,
 * exports, the Pancake label. Names the first product and counts the rest,
 * rather than concatenating every line into something unreadable. */
export function summarizeItems(items: { product_name: string }[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0].product_name;
  return `${items[0].product_name} +${items.length - 1} more`;
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
