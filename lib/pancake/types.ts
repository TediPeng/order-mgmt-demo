import type { Order, PancakeAccount } from "@/lib/types";

/** Internal, adapter-agnostic forward payload. createOrder.ts maps this onto
 * the real Pancake field names from config.ts. */
export interface ForwardPayload {
  internal_order_id: string;
  /** Stable external reference / idempotency key sent to Pancake. */
  system_order_id: string;
  order_number: string;
  order_date: string | null;
  agent_name: string;
  agent_account: string;
  customer_name: string;
  phone: string;
  purok: string;
  barangay: string;
  city: string;
  province: string;
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
  eventTimestamp: string | null; // Pancake's updated_at, for out-of-order protection
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
  eventTimestamp: string | null;
  shopId: string | null;
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
  oneTimeProduct = false
): ForwardPayload {
  return {
    internal_order_id: order.id,
    system_order_id: order.system_order_id || order.order_number,
    order_number: order.order_number,
    order_date: order.order_date,
    agent_name: agentName,
    agent_account: agentAccount,
    customer_name: order.customer_name,
    phone: order.customer_phone,
    purok: order.purok,
    barangay: order.barangay,
    city: order.city,
    province: order.province,
    landmark: order.landmark,
    complete_address: [order.purok, order.barangay, order.city, order.province].filter(Boolean).join(", "),
    product: order.product_name,
    variant: order.variant,
    variation_id: variationId,
    one_time_product: oneTimeProduct,
    quantity: order.quantity,
    unit_price: order.unit_price,
    discount: order.discount ?? 0,
    total_amount: order.total_amount,
    shipping_fee: order.shipping_fee,
    courier: order.courier,
    payment_method: order.payment_method,
    order_source: order.order_source,
    notes: order.notes,
    current_status: order.status,
  };
}
