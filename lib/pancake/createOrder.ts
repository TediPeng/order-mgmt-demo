import type { PancakeAccount } from "@/lib/types";
import type { CreateOrderResult, ForwardPayload } from "./types";
import { CREATE_ORDER_PATH, RESPONSE_FIELDS, mockMode } from "./config";
import { pancakeFetch, resolvePath, unwrapData } from "./client";

/** Creates the order in Pancake POS (POST /shops/{SHOP_ID}/orders, field names
 * per the official OpenAPI spec). Our internal order id goes into `custom_id`
 * as the external reference; combined with the pre-send duplicate check this
 * keeps forwarding exactly-once.
 *
 * NOTE on items: Pancake's item schema wants a `variation_id` referencing a
 * product variation that already exists in the Pancake shop. This system's
 * products are not synced to Pancake, so the product is sent as
 * `variation_info` (name + retail_price) and also spelled out in the order
 * note. If your Pancake shop rejects variation-less items, link products to
 * Pancake variation ids and extend this mapping. */
export async function createOrder(account: PancakeAccount, payload: ForwardPayload): Promise<CreateOrderResult> {
  const mode = mockMode();
  if (mode === "success") {
    return {
      ok: true,
      pancakeOrderId: `MOCK-${payload.order_number}`,
      httpStatus: 201,
      error: null,
      responseSummary: { mock: true, custom_id: payload.internal_order_id },
    };
  }
  if (mode === "fail") {
    return {
      ok: false,
      pancakeOrderId: null,
      httpStatus: 503,
      error: "MOCK_MODE=fail: simulated Pancake API failure",
      responseSummary: { mock: true },
    };
  }

  const productLine = `${payload.product} x${payload.quantity}` + (payload.unit_price != null ? ` @ ${payload.unit_price}` : "");
  const noteParts = [
    `Order ${payload.order_number} (agent: ${payload.agent_name || payload.agent_account})`,
    productLine,
    payload.payment_method ? `Payment: ${payload.payment_method}` : null,
    payload.courier ? `Courier: ${payload.courier}` : null,
    payload.notes || null,
  ].filter(Boolean);

  const body: Record<string, unknown> = {
    custom_id: payload.internal_order_id,
    bill_full_name: payload.customer_name,
    bill_phone_number: payload.phone,
    note: noteParts.join(" | "),
    shipping_fee: payload.shipping_fee ?? 0,
    shipping_address: {
      full_name: payload.customer_name,
      phone_number: payload.phone,
      // PH address mapped onto Pancake's VN-shaped address fields:
      // province -> province_name, city -> district_name, barangay -> commune_name.
      address: [payload.purok, payload.landmark].filter(Boolean).join(", ") || payload.complete_address,
      full_address: [payload.complete_address, payload.landmark].filter(Boolean).join(" — "),
      province_name: payload.province,
      district_name: payload.city,
      commnue_name: payload.barangay, // (sic) field is misspelled in Pancake's own schema
    },
    items: [
      {
        // Catalog line: variation_id is Pancake's own id, or the variation SKU.
        // Quick-add line: one_time_product creates the product on the order
        // itself, so there is no variation to reference and the key is omitted.
        ...(payload.one_time_product ? {} : { variation_id: payload.variation_id }),
        one_time_product: payload.one_time_product,
        quantity: payload.quantity,
        discount_each_product: 0,
        is_bonus_product: false,
        is_discount_percent: false,
        is_wholesale: false,
        variation_info: {
          name: payload.product || "Item",
          retail_price: payload.unit_price ?? 0,
        },
      },
    ],
  };

  const res = await pancakeFetch(account, resolvePath(CREATE_ORDER_PATH, account), { method: "POST", body });
  const data = unwrapData(res.body);
  const rawId = data[RESPONSE_FIELDS.order_id];
  const pancakeOrderId = rawId != null && rawId !== "" ? String(rawId) : null;
  return {
    ok: res.ok && !!pancakeOrderId,
    pancakeOrderId,
    httpStatus: res.httpStatus,
    error:
      res.ok && !pancakeOrderId
        ? "Pancake response did not contain an order id (check RESPONSE_FIELDS in config.ts)"
        : res.error,
    responseSummary: res.body
      ? { id: pancakeOrderId, status: data[RESPONSE_FIELDS.status] ?? null, custom_id: data[RESPONSE_FIELDS.external_reference] ?? null }
      : null,
  };
}
