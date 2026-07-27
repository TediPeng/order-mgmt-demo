import type { Order, PancakeAccount } from "@/lib/types";

/** Internal, adapter-agnostic forward payload. createOrder.ts maps this onto
 * the real Pancake field names from config.ts. */
export interface ForwardPayload {
  internal_order_id: string; // also the idempotency key / external reference
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
  quantity: number;
  unit_price: number | null;
  total_amount: number;
  shipping_fee: number | null;
  courier: string | null;
  payment_method: string | null;
  notes: string;
  current_status: string;
}

export interface CreateOrderResult {
  ok: boolean;
  pancakeOrderId: string | null;
  httpStatus: number | null;
  error: string | null;
  /** Redacted summary safe for pancake_sync_logs.payload_summary. */
  responseSummary: Record<string, unknown> | null;
}

export interface GetOrderResult {
  ok: boolean;
  httpStatus: number | null;
  error: string | null;
  rawStatus: string | null; // Pancake's raw status code
  eventTimestamp: string | null; // Pancake's updated_at, for out-of-order protection
  responseSummary: Record<string, unknown> | null;
}

/** Normalized incoming update (from webhook or polling) after field mapping. */
export interface IncomingUpdate {
  pancakeOrderId: string | null;
  externalReference: string | null; // should be our internal order id
  orderNumber: string | null;
  phone: string | null;
  rawStatus: string | null;
  eventTimestamp: string | null;
  shopId: string | null;
}

export interface AccountWithSecrets {
  account: PancakeAccount;
  apiKey: string; // decrypted — NEVER log or return to the client
  webhookSecret: string | null;
}

export function buildForwardPayload(order: Order, agentName: string, agentAccount: string): ForwardPayload {
  return {
    internal_order_id: order.id,
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
    quantity: order.quantity,
    unit_price: order.unit_price,
    total_amount: order.total_amount,
    shipping_fee: order.shipping_fee,
    courier: order.courier,
    payment_method: order.payment_method,
    notes: order.notes,
    current_status: order.status,
  };
}
