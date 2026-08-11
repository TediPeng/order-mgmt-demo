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

/**
 * Every line named, one per row — what hovering the summary reveals.
 *
 * "+2 more" is the right width for a list column but it is the only thing said
 * about two of the three things the customer is buying, and finding out what
 * they are meant opening the order. The rows are already on the page.
 *
 * Empty for a single line, because the cell beneath already says it, and an
 * empty string becomes no tooltip at all rather than one repeating the text
 * under the cursor.
 */
export function listItemNames(items: { product_name: string; quantity?: string | number }[]): string {
  if (items.length < 2) return "";
  return items
    .map((item) => {
      // Pack size lives in the product name here ("6 CLOVES COFFEE"), so a line
      // quantity of one is the normal case and saying "×1" would only be noise.
      const quantity = Number(item.quantity ?? 1);
      return quantity > 1 ? `${item.product_name} ×${quantity}` : item.product_name;
    })
    .join("\n");
}
