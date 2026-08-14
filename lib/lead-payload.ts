import type { Order } from "@/lib/types";

/**
 * The full order, shaped the way PATCH /api/leads/[id] expects it.
 *
 * That route takes a whole lead and validates it as one, so any caller that
 * wants to change a single field sends everything else back unchanged.
 * The popup has always done this; the status dropdown in the leads row needs
 * exactly the same envelope, which is why this no longer lives inside the
 * popup component.
 */
export function buildRawFromOrder(o: Order, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    customer_name: o.customer_name,
    customer_phone: o.customer_phone,
    purok: o.purok,
    barangay: o.barangay,
    city: o.city,
    province: o.province,
    pancake_province_id: o.pancake_province_id || "",
    pancake_district_id: o.pancake_district_id || "",
    pancake_commune_id: o.pancake_commune_id || "",
    landmark: o.landmark,
    previous_order_date: o.previous_order_date || "",
    previous_order_product: o.previous_order_product || "",
    previous_order_amount: o.previous_order_amount,
    previous_order_note: o.previous_order_note || "",
    previous_order_status: o.previous_order_status || "",
    product_id: o.product_id || "",
    unit_price: o.unit_price,
    status: o.status,
    notes: o.notes,
    agent_id: o.agent_id,
    quantity: o.quantity,
    shipping_fee: o.shipping_fee,
    courier: o.courier || "",
    payment_method: o.payment_method || "",
    order_source: o.order_source || "",
    discount: o.discount ?? 0,
    variant: o.variant || "",
    ...overrides,
  };
}
