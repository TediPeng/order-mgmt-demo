import { READY_TO_SHIP_REQUIRED_FIELDS, REQUIRES_PRIOR_READY_TO_SHIP, LEAD_STATUS_LABELS } from "@/lib/validation";
import { normalizePhone } from "@/lib/utils";
import type { DbShape, Order, OrderStatus } from "@/lib/types";

/** Missing-field labels blocking a transition into Ready to Ship (Section 11). */
export function validateReadyToShip(candidate: {
  customer_name: string;
  customer_phone: string;
  barangay: string;
  city: string;
  province: string;
  product_id?: string | null;
  unit_price?: number | null;
}): string[] {
  const values: Record<string, unknown> = {
    customer_name: candidate.customer_name,
    customer_phone: candidate.customer_phone,
    barangay: candidate.barangay,
    city: candidate.city,
    province: candidate.province,
    product_id: candidate.product_id,
    unit_price: candidate.unit_price,
  };
  return READY_TO_SHIP_REQUIRED_FIELDS.filter(({ key }) => {
    const v = values[key];
    if (key === "unit_price") return v === null || v === undefined;
    return !String(v ?? "").trim();
  }).map((f) => f.label);
}

/** Printed/Shipped/Delivered/Returned are downstream of Ready to Ship — a lead
 * must already have an order_date (i.e. have passed through Ready to Ship at
 * least once) before it can move into any of them. */
export function pipelineBlockReason(order: Pick<Order, "order_date">, newStatus: OrderStatus): string | null {
  if ((REQUIRES_PRIOR_READY_TO_SHIP as readonly string[]).includes(newStatus) && !order.order_date) {
    return `This lead must pass through Ready to Ship before it can be marked as ${LEAD_STATUS_LABELS[newStatus]}.`;
  }
  return null;
}

/** Once an order has been forwarded to Pancake POS, its status is normally
 * driven by Pancake sync — manual changes are Management-only (Section 0.1).
 * Pre-forward leads are unaffected. */
export function fulfillmentOverrideBlockReason(
  order: Pick<Order, "pancake_order_id" | "forwarded_to_pancake_at" | "status">,
  newStatus: OrderStatus,
  userIsFullAccess: boolean
): string | null {
  const forwarded = Boolean(order.pancake_order_id || order.forwarded_to_pancake_at);
  if (!forwarded || newStatus === order.status || userIsFullAccess) return null;
  return "This order was forwarded to Pancake POS; its status is managed by sync. Only Management can change it manually.";
}

/** Order Date is stamped/overwritten only when entering ready_to_ship (including
 * re-entry — latest Ready-to-Ship date wins); every other transition leaves it untouched. */
export function computeOrderDate(order: Pick<Order, "order_date">, newStatus: OrderStatus, today: string): string | null {
  if (newStatus === "ready_to_ship") return today;
  return order.order_date;
}

/** Most recent Ready-to-Ship lead for this phone number (normalized), used to
 * auto-fill Previous Order Date/Product/Amount when the file/form doesn't supply them. */
export function findPreviousOrderInfo(
  db: DbShape,
  phone: string
): { date: string; product: string; amount: number } | null {
  const target = normalizePhone(phone);
  if (!target) return null;
  const candidates = db.orders.filter(
    (o) => o.status === "ready_to_ship" && o.order_date && normalizePhone(o.customer_phone) === target
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (b.order_date as string).localeCompare(a.order_date as string));
  const best = candidates[0];
  const product = best.product_id ? db.products.find((p) => p.id === best.product_id)?.name : best.product_name;
  return { date: best.order_date as string, product: product || best.product_name || "", amount: best.total_amount };
}
