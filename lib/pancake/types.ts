import type { Order, PancakeAccount } from "@/lib/types";

/** Internal, adapter-agnostic forward payload. createOrder.ts maps this onto
 * the real Pancake field names from config.ts. */
/**
 * One line of the order as Pancake receives it.
 *
 * There is one of these per order_items row. There used to be exactly one item
 * built from the order's summary fields, which folded a two-product order into
 * a single Pancake line: "4 AVOCADO COFFEE +1 more", quantity 2, at the FIRST
 * line's price. The second product was never sent, and Pancake's arithmetic
 * doubled the first one. Five real orders went out that way on 2026-08-10.
 */
export interface ForwardItem {
  product_name: string;
  variant: string | null;
  /** Pancake variation ID or SKU. Empty only when one_time_product is set. */
  variation_id: string;
  one_time_product: boolean;
  quantity: number;
  /** Per-unit price for THIS line. A freebie is a line at zero, not a silent
   * addition to somebody else's quantity. */
  unit_price: number;
  discount: number;
}

export interface ForwardPayload {
  internal_order_id: string;
  /** Stable external reference / idempotency key sent to Pancake. */
  system_order_id: string;
  order_number: string;
  order_date: string | null;
  agent_name: string;
  agent_account: string;
  agent_email: string;
  /** Pancake Order Source ID, resolved by matching the agent's Call Name against
   * Pancake's own Order Sources list. Null means unresolved — the forward is
   * refused rather than sent with an empty source. */
  order_source_id: string | null;
  /** Pancake staff (user) ID, resolved by matching the agent's email against
   * Pancake's staff list. Becomes `assigning_care_id`. */
  care_staff_id: string | null;
  customer_name: string;
  phone: string;
  purok: string;
  barangay: string;
  city: string;
  province: string;
  /** Pancake's own address IDs — the values that actually set the location. */
  province_id: string;
  district_id: string;
  commune_id: string;
  landmark: string;
  complete_address: string;
  product: string;
  variant: string | null;
  /** Pancake variation ID or SKU. Empty only when one_time_product is set. */
  variation_id: string;
  /** Send as a Pancake "quick add" (one-time) product with no catalog entry. */
  one_time_product: boolean;
  quantity: number;
  unit_price: number | null;
  discount: number;
  /** The order's lines, one Pancake item each. Never empty: an order with no
   * order_items falls back to a single item built from the fields above, which
   * is the shape the single-product form used to produce. */
  items: ForwardItem[];
  total_amount: number;
  shipping_fee: number | null;
  courier: string | null;
  payment_method: string | null;
  order_source: string | null;
  notes: string;
  current_status: string;
}

export interface CreateOrderResult {
  ok: boolean;
  /** Pancake's own order id, stored verbatim — never generated or reformatted here. */
  pancakeOrderId: string | null;
  /** Pancake-side status label as reported back (expected: Packaging). */
  pancakeStatus: string | null;
  /** Pancake's own updated_at for the created order — the event-clock anchor. */
  eventTimestamp: string | null;
  /** True when Pancake did NOT report the requested Packaging status. */
  statusMismatch: boolean;
  httpStatus: number | null;
  error: string | null;
  /** Redacted summary safe for pancake_sync_logs.payload_summary. */
  responseSummary: Record<string, unknown> | null;
  /** Full redacted payloads persisted on the order for troubleshooting. */
  requestPayload: Record<string, unknown> | null;
  responsePayload: Record<string, unknown> | null;
}

export interface GetOrderResult {
  ok: boolean;
  httpStatus: number | null;
  error: string | null;
  rawStatus: string | null; // Pancake's raw status code — what the status map keys on
  statusName: string | null; // Pancake's own label for that code, for display
  /** partner.extend_code — the courier's own shipping-order code. */
  trackingNumber: string | null;
  /** partner.partner_name (or delivery_name) — written to orders.courier. */
  courier: string | null;
  /** tracking_link — Pancake calls this "Link confirm order". Kept for
   * reference; it is NOT a tracking number and never goes in that column. */
  confirmLink: string | null;
  eventTimestamp: string | null; // Pancake's updated_at, for out-of-order protection
  tags: string[]; // Pancake order tags, read by the ODZ tag rule
  responseSummary: Record<string, unknown> | null;
}

/** Normalized incoming update (from webhook or polling) after field mapping. */
export interface IncomingUpdate {
  pancakeOrderId: string | null;
  externalReference: string | null; // our system_order_id, echoed by Pancake
  orderNumber: string | null;
  phone: string | null;
  rawStatus: string | null;
  statusName?: string | null;
  trackingNumber?: string | null;
  /** Courier name from the shipment partner, written to orders.courier. */
  courier?: string | null;
  eventTimestamp: string | null;
  shopId: string | null;
  /** Pancake order tags. An `ODZ` tag here overrides the mapped status. */
  tags?: string[] | null;
}

export interface AccountWithSecrets {
  account: PancakeAccount;
  apiKey: string; // decrypted — NEVER log or return to the client
  webhookSecret: string | null;
}

export function buildForwardPayload(
  order: Order,
  agentName: string,
  agentAccount: string,
  variationId: string,
  oneTimeProduct = false,
  resolved: { orderSourceId?: string | null; careStaffId?: string | null } = {},
  /** One per order_items row, already resolved against the Pancake catalogue.
   * Omitted or empty, the order's own summary fields stand in — an order
   * saved before the line editor existed has no rows to map. */
  items: ForwardItem[] = []
): ForwardPayload {
  const lines: ForwardItem[] =
    items.length > 0
      ? items
      : [
          {
            product_name: order.product_name,
            variant: order.variant,
            variation_id: variationId,
            one_time_product: oneTimeProduct,
            quantity: order.quantity,
            unit_price: order.unit_price ?? 0,
            discount: order.discount ?? 0,
          },
        ];
  return {
    internal_order_id: order.id,
    system_order_id: order.system_order_id || order.order_number,
    order_number: order.order_number,
    order_date: order.order_date,
    agent_name: agentName,
    agent_account: agentAccount,
    agent_email: order.assigned_agent_email,
    order_source_id: resolved.orderSourceId ?? null,
    care_staff_id: resolved.careStaffId ?? null,
    customer_name: order.customer_name,
    phone: order.customer_phone,
    purok: order.purok,
    barangay: order.barangay,
    city: order.city,
    province: order.province,
    province_id: order.pancake_province_id || "",
    district_id: order.pancake_district_id || "",
    commune_id: order.pancake_commune_id || "",
    landmark: order.landmark,
    complete_address: [order.purok, order.barangay, order.city, order.province].filter(Boolean).join(", "),
    product: order.product_name,
    variant: order.variant,
    variation_id: variationId,
    one_time_product: oneTimeProduct,
    quantity: order.quantity,
    unit_price: order.unit_price,
    discount: order.discount ?? 0,
    items: lines,
    total_amount: order.total_amount,
    shipping_fee: order.shipping_fee,
    courier: order.courier,
    payment_method: order.payment_method,
    order_source: order.order_source,
    notes: order.notes,
    current_status: order.status,
  };
}
