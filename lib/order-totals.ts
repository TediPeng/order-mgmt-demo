/** Order line arithmetic, shared by the server and the browser.
 *
 * Deliberately its own module with no imports. The functions live here rather
 * than in lib/order-items.ts because that file imports supabaseAdmin, which
 * reads the service-role key at module load and throws when it is absent —
 * which it always is in a browser. A client component importing one of these
 * helpers from there took the whole page down with a client-side exception,
 * and would have pulled a server-only module into the client bundle besides.
 *
 * Keeping the arithmetic in one place is the point: the editor shows these
 * figures while someone types and the server stores them, and the two must not
 * be able to disagree.
 */

/** quantity × unit price − discount, rounded to centavos. */
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
   * inside each line total. */
  total: number;
}

export function totalsFor(
  items: { quantity: number; unit_price: number; discount: number }[],
  shippingFee: number | null
): OrderTotals {
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

// listItemNames() lived here: it built the tooltip behind the "+N more"
// summary in the leads tables. Both tables list every product outright now, so
// there is nothing left for a tooltip to reveal and nothing calling it.
