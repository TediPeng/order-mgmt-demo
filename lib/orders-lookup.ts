import { supabaseAdmin } from "@/lib/supabaseAdmin";

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
