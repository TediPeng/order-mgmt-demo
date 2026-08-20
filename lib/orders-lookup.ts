import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { PreviousOrderInfo } from "@/lib/lead-workflow";
import type { Order } from "@/lib/types";
import { normalizePhone } from "@/lib/utils";

/**
 * The small questions about orders that pages outside Leads need answered.
 *
 * Each of these was a filter over db.orders — correct, and paid for by
 * fetching all 57,000 rows to look at one column of a few dozen of them. The
 * Products page asked which products are in use; System Settings asked how
 * many orders reached Pancake; the sync log asked for order numbers. None of
 * them displays an order, so none of them should be reading the table.
 *
 * See readDbLite() in lib/db.ts for why the full read is worth avoiding.
 */

/**
 * Every order on a set of phone numbers — the history a lead import needs.
 *
 * The import asks history two questions, and both turn on the phone number:
 * is this row a duplicate, and what did this customer last order. The dedupe
 * key contains the number, so an order on a different one can never collide;
 * the previous-order index is keyed by it outright. So the import does not
 * need the orders table, only the orders on the numbers in the file.
 *
 * It used to read all of them — 52,000 rows per batch, four times over for a
 * 1,600-row file — which is what ran past the function's time limit and left
 * the import stopped halfway with a "upload the file again" message.
 *
 * `phones` are raw as typed; normalisation happens in SQL against the index on
 * lead_phone_key(customer_phone), which is the same rule normalizePhone
 * applies here.
 */
export async function ordersForPhones(phones: string[]): Promise<Order[]> {
  const keys = Array.from(new Set(phones.map((p) => normalizePhone(p)).filter(Boolean)));
  if (keys.length === 0) return [];
  const { data, error } = await supabaseAdmin.rpc("orders_for_phone_keys", { p_keys: keys });
  if (error) throw new Error(`Order history lookup failed: ${error.message}`);
  return (data || []) as Order[];
}

/** How a number's parcels have actually ended, once Pancake has said. */
export interface ReturnStats {
  /** Parcels the customer accepted. */
  delivered: number;
  /** Parcels that came back. `returning` is deliberately not counted — it is in
   * transit and may yet be delivered, and a rate that moves backwards is worse
   * than one that arrives late. */
  returned: number;
}

/**
 * Delivered and returned counts per phone number.
 *
 * The rate this feeds is `returned / (delivered + returned)` — a share of the
 * deliveries that finished, which is what Pancake's own customer indicator
 * shows and the only form that survives one order.
 *
 * Deliberately NOT computeRtsPercentage's `returned / delivered`. That works
 * for an agent, who has hundreds of deliveries under them, and breaks for a
 * person: a return and a delivery are different statuses on the same order, so
 * a customer whose only parcel came back has zero delivered, and dividing by it
 * reports 0% for exactly the customer worth flagging. Every one of the six
 * returns in the live data is that shape.
 *
 * Aggregated here rather than in SQL because the row set is already bounded by
 * the numbers on one page, and a new database function is a migration for
 * arithmetic a loop does in microseconds.
 */
export async function returnStatsForPhones(phones: string[]): Promise<Record<string, ReturnStats>> {
  const orders = await ordersForPhones(phones);
  const stats: Record<string, ReturnStats> = {};
  for (const order of orders) {
    const key = normalizePhone(order.customer_phone || "");
    if (!key) continue;
    const row = (stats[key] ??= { delivered: 0, returned: 0 });
    if (order.status === "delivered") row.delivered += 1;
    else if (order.status === "returned") row.returned += 1;
  }
  return stats;
}

/** Products that appear on at least one order — the Delete/Deactivate rule. */
export async function productIdsInUse(): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin.rpc("product_ids_in_use");
  if (error) throw new Error(`Product usage lookup failed: ${error.message}`);
  return new Set((data || []) as string[]);
}

/** Whether one product is on any order. Indexed on orders.product_id, and it
 * stops at the first hit rather than counting. */
export async function productIsInUse(productId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from("orders").select("id").eq("product_id", productId).limit(1);
  if (error) throw new Error(`Product usage lookup failed: ${error.message}`);
  return (data || []).length > 0;
}

/** Orders that have reached Pancake POS, counted in the database. `head` means
 * the rows are never sent — only the count comes back. */
export async function syncedOrderCount(): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .or("pancake_order_id.not.is.null,forwarded_to_pancake_at.not.is.null");
  if (error) throw new Error(`Synced order count failed: ${error.message}`);
  return count ?? 0;
}

/** order_number for each id, for a page of rows that reference orders. */
export async function orderNumbersByIds(ids: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return new Map();
  const { data, error } = await supabaseAdmin.from("orders").select("id,order_number").in("id", unique);
  if (error) throw new Error(`Order number lookup failed: ${error.message}`);
  return new Map((data || []).map((o) => [o.id as string, o.order_number as string]));
}

/**
 * The customer's most recent completed order, for the previous-order fields
 * the lead form fills in by itself.
 *
 * findPreviousOrderInfo() in lib/lead-workflow.ts is the definition of record;
 * previous_order_for_phone() in SQL is a transcription of it and must change
 * with it. The walk stays for the import, which holds every order in memory
 * for its own reasons and would otherwise pay a round trip per row.
 */
export async function previousOrderForPhone(phone: string): Promise<PreviousOrderInfo | null> {
  if (!phone.trim()) return null;
  const { data, error } = await supabaseAdmin.rpc("previous_order_for_phone", { p_phone: phone });
  if (error) throw new Error(`Previous order lookup failed: ${error.message}`);
  if (!data) return null;
  const row = data as { date: string; product: string; amount: number | string; note: string; status: string };
  return {
    date: row.date,
    product: row.product,
    amount: Number(row.amount),
    note: row.note,
    status: row.status,
  };
}

/**
 * Every order behind a set of regular customers, in one query.
 *
 * The caller groups them with ordersForCustomer() in lib/customers.ts, which
 * is unchanged and still the definition of record — it is simply handed these
 * rows instead of every order in the system.
 */
export async function ordersForCustomers(
  customers: { id: string; phone_normalized: string }[]
): Promise<Order[]> {
  if (customers.length === 0) return [];
  const { data, error } = await supabaseAdmin.rpc("orders_for_customers", {
    p_customer_ids: customers.map((c) => c.id),
    p_phones: customers.map((c) => c.phone_normalized).filter(Boolean),
  });
  if (error) throw new Error(`Customer orders lookup failed: ${error.message}`);
  return (data || []) as Order[];
}

/** Every order one agent holds on a phone number — the set that moves out of
 * the Leads list when that customer is tagged as a regular. Raw rows, for
 * adoptOrders() to put into the shape so they can be edited and written. */
export async function orderRowsForPhoneAndAgent(
  phone: string,
  agentId: string
): Promise<Record<string, unknown>[]> {
  if (!phone.trim()) return [];
  const { data, error } = await supabaseAdmin.rpc("orders_for_phone_and_agent", {
    p_phone: phone,
    p_agent_id: agentId,
  });
  if (error) throw new Error(`Customer order lookup failed: ${error.message}`);
  return (data || []) as Record<string, unknown>[];
}

/** Every order linked to a customer record — the set that moves back to the
 * Leads list when the customer is untagged. */
export async function orderRowsForCustomer(customerId: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabaseAdmin.from("orders").select("*").eq("customer_id", customerId);
  if (error) throw new Error(`Customer order lookup failed: ${error.message}`);
  return (data || []) as Record<string, unknown>[];
}

/** How many orders belong to a regular customer's record. Indexed on
 * orders.customer_id, and only the count comes back. */
export async function customerOrderCount(customerId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId);
  if (error) throw new Error(`Customer order count failed: ${error.message}`);
  return count ?? 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The id behind an order number a person typed, or null.
 *
 * Accepts an id too, because the sync log's own links carry one — but only
 * when it is shaped like a uuid, since comparing a uuid column to "ORD-…"
 * is an error rather than a miss.
 */
export async function findOrderIdByNumberOrId(term: string): Promise<string | null> {
  const value = term.trim();
  if (!value) return null;
  const query = supabaseAdmin.from("orders").select("id").limit(1);
  const { data, error } = await (UUID.test(value)
    ? query.or(`id.eq.${value},order_number.eq.${value}`)
    : query.ilike("order_number", value));
  if (error) throw new Error(`Order lookup failed: ${error.message}`);
  return (data || [])[0]?.id ?? null;
}
