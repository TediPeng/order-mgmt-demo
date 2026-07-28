import {
  PACKAGING_REQUIRED_FIELDS,
  REQUIRES_PRIOR_PACKAGING,
  LEAD_STATUS_LABELS,
  PACKAGING_STATUS,
  AGENT_EDITABLE_STATUSES,
} from "@/lib/validation";
import { normalizePhone } from "@/lib/utils";
import type { DbShape, Order, OrderStatus } from "@/lib/types";

/** Missing-field labels blocking a transition into Packaging. Address codes are
 * checked here for presence only; whether the province/city/barangay actually
 * nest is a database question, answered by validateAddressCodes in lib/psgc.ts. */
export function validatePackaging(candidate: {
  customer_name: string;
  customer_phone: string;
  purok?: string;
  barangay: string;
  city: string;
  province: string;
  product_id?: string | null;
  unit_price?: number | null;
}): string[] {
  const values: Record<string, unknown> = {
    customer_name: candidate.customer_name,
    customer_phone: candidate.customer_phone,
    purok: candidate.purok,
    barangay: candidate.barangay,
    city: candidate.city,
    province: candidate.province,
    product_id: candidate.product_id,
    unit_price: candidate.unit_price,
  };
  return PACKAGING_REQUIRED_FIELDS.filter(({ key }) => {
    const v = values[key];
    // Unit Price must be present AND greater than zero.
    if (key === "unit_price") return v === null || v === undefined || Number(v) <= 0;
    return !String(v ?? "").trim();
  }).map((f) => f.label);
}

/** Every fulfillment stage past Packaging is downstream of it — a lead must
 * already have an order_date (i.e. have passed through Packaging at least once)
 * before it can move into any of them. */
export function pipelineBlockReason(order: Pick<Order, "order_date">, newStatus: OrderStatus): string | null {
  if ((REQUIRES_PRIOR_PACKAGING as readonly string[]).includes(newStatus) && !order.order_date) {
    return `This lead must pass through Packaging before it can be marked as ${LEAD_STATUS_LABELS[newStatus]}.`;
  }
  return null;
}

/** Statuses past Packaging belong to Pancake sync, so only full-access users
 * may set them by hand — at any point in the lead's life, not just after it has
 * been forwarded. Callers turn this into a 403. */
export function restrictedStatusBlockReason(newStatus: OrderStatus, userIsFullAccess: boolean): string | null {
  if (userIsFullAccess) return null;
  if ((AGENT_EDITABLE_STATUSES as readonly string[]).includes(newStatus)) return null;
  return `${LEAD_STATUS_LABELS[newStatus]} is set by fulfillment, not by agents. You can set ${AGENT_EDITABLE_STATUSES.map(
    (s) => LEAD_STATUS_LABELS[s]
  ).join(", ")}.`;
}

/** Once an order has been forwarded to Pancake POS, its status is driven by
 * sync — manual changes are Management-only. Pre-forward leads are unaffected. */
export function fulfillmentOverrideBlockReason(
  order: Pick<Order, "pancake_order_id" | "forwarded_to_pancake_at" | "status">,
  newStatus: OrderStatus,
  userIsFullAccess: boolean
): string | null {
  const forwarded = Boolean(order.pancake_order_id || order.forwarded_to_pancake_at);
  if (!forwarded || newStatus === order.status || userIsFullAccess) return null;
  return "This order was forwarded to Pancake POS; its status is managed by sync. Only Management can change it manually.";
}

/** Order Date is stamped/overwritten only when entering Packaging (including
 * re-entry — the latest Packaging date wins); every other transition leaves it
 * untouched. */
export function computeOrderDate(order: Pick<Order, "order_date">, newStatus: OrderStatus, today: string): string | null {
  if (newStatus === PACKAGING_STATUS) return today;
  return order.order_date;
}

/** Most recent packaged lead for this phone number (normalized), used to
 * auto-fill Previous Order Date/Product/Amount when the file/form doesn't
 * supply them. Any lead with an order_date has reached Packaging, so the date
 * is the marker rather than the current status — an order that has since moved
 * on to Shipped or Delivered still counts as a previous order. */
export function findPreviousOrderInfo(
  db: DbShape,
  phone: string
): { date: string; product: string; amount: number } | null {
  const target = normalizePhone(phone);
  if (!target) return null;
  const candidates = db.orders.filter((o) => o.order_date && normalizePhone(o.customer_phone) === target);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (b.order_date as string).localeCompare(a.order_date as string));
  const best = candidates[0];
  const product = best.product_id ? db.products.find((p) => p.id === best.product_id)?.name : best.product_name;
  return { date: best.order_date as string, product: product || best.product_name || "", amount: best.total_amount };
}
