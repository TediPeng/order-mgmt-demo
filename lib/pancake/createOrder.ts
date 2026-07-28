import type { PancakeAccount } from "@/lib/types";
import type { CreateOrderResult, ForwardPayload } from "./types";
import {
  CREATE_ORDER_PATH,
  CREATE_STATUS_PACKAGING,
  CREATE_STATUS_PACKAGING_LABEL,
  PANCAKE_STATUS_HINTS,
  RESPONSE_FIELDS,
  mockMode,
} from "./config";
import { pancakeFetch, resolvePath, unwrapData } from "./client";

/** Builds the outbound create-order body. Kept separate so the exact payload
 * can be persisted on the order (and shown in the UI) even when the call
 * itself fails. Contains no credentials — the API key travels as a query
 * parameter added inside pancakeFetch and never appears here.
 *
 * NOTE on items: a catalog line references an existing Pancake variation via
 * variation_id; an unmapped product is sent as a "quick add" one-time product
 * instead (name + price only, no Pancake inventory movement). */
export function buildCreateOrderBody(payload: ForwardPayload): Record<string, unknown> {
  const productLabel = [payload.product, payload.variant].filter(Boolean).join(" — ");
  const noteParts = [
    `Order ${payload.order_number} (agent: ${payload.agent_name || payload.agent_account})`,
    `${productLabel} x${payload.quantity}` + (payload.unit_price != null ? ` @ ${payload.unit_price}` : ""),
    payload.discount ? `Discount: ${payload.discount}` : null,
    payload.payment_method ? `Payment: ${payload.payment_method}` : null,
    payload.courier ? `Courier: ${payload.courier}` : null,
    payload.order_source ? `Source: ${payload.order_source}` : null,
    payload.notes || null,
  ].filter(Boolean);

  return {
    // Stable external reference — also what incoming updates are matched on.
    custom_id: payload.system_order_id,
    // Every order must land in Pancake as Packaging.
    status: CREATE_STATUS_PACKAGING,
    bill_full_name: payload.customer_name,
    bill_phone_number: payload.phone,
    note: noteParts.join(" | "),
    shipping_fee: payload.shipping_fee ?? 0,
    total_discount: payload.discount ?? 0,
    shipping_address: {
      full_name: payload.customer_name,
      phone_number: payload.phone,
      // PH address mapped onto Pancake's VN-shaped address fields:
      // province -> province_name, city -> district_name, barangay -> commune_name.
      address: [payload.purok, payload.landmark].filter(Boolean).join(", ") || payload.complete_address,
      full_address: [payload.complete_address, payload.landmark].filter(Boolean).join(" — "),
      province_name: payload.province,
      district_name: payload.city,
      commnue_name: payload.barangay, // (sic) misspelled in Pancake's own schema
    },
    items: [
      {
        ...(payload.one_time_product ? {} : { variation_id: payload.variation_id }),
        one_time_product: payload.one_time_product,
        quantity: payload.quantity,
        discount_each_product: 0,
        is_bonus_product: false,
        is_discount_percent: false,
        is_wholesale: false,
        variation_info: {
          name: productLabel || "Item",
          retail_price: payload.unit_price ?? 0,
        },
      },
    ],
  };
}

/** Pancake's own label for a returned status code, falling back to the code. */
function statusLabel(raw: unknown, statusName: unknown): string | null {
  if (statusName != null && String(statusName).trim()) return String(statusName);
  if (raw == null || raw === "") return null;
  return PANCAKE_STATUS_HINTS[String(raw)] || String(raw);
}

/** Creates the order in Pancake POS (POST /shops/{SHOP_ID}/orders) with the
 * Pancake-side status set to Packaging. The returned order id is stored
 * verbatim — this system never generates or reformats it. */
export async function createOrder(account: PancakeAccount, payload: ForwardPayload): Promise<CreateOrderResult> {
  const body = buildCreateOrderBody(payload);
  const mode = mockMode();

  if (mode === "success") {
    return {
      ok: true,
      pancakeOrderId: `MOCK-${payload.order_number}`,
      pancakeStatus: CREATE_STATUS_PACKAGING_LABEL,
      eventTimestamp: new Date().toISOString(),
      statusMismatch: false,
      httpStatus: 201,
      error: null,
      responseSummary: { mock: true, custom_id: payload.system_order_id, status: CREATE_STATUS_PACKAGING },
      requestPayload: body,
      responsePayload: { mock: true, id: `MOCK-${payload.order_number}`, status: CREATE_STATUS_PACKAGING },
    };
  }
  if (mode === "fail") {
    return {
      ok: false,
      pancakeOrderId: null,
      pancakeStatus: null,
      eventTimestamp: null,
      statusMismatch: false,
      httpStatus: 503,
      error: "MOCK_MODE=fail: simulated Pancake API failure",
      responseSummary: { mock: true },
      requestPayload: body,
      responsePayload: { mock: true, error: "simulated failure" },
    };
  }

  const res = await pancakeFetch(account, resolvePath(CREATE_ORDER_PATH, account), { method: "POST", body });
  const data = unwrapData(res.body);
  const rawId = data[RESPONSE_FIELDS.order_id];
  const pancakeOrderId = rawId != null && rawId !== "" ? String(rawId) : null;
  const returnedStatus = data[RESPONSE_FIELDS.status];
  const pancakeStatus = statusLabel(returnedStatus, data[RESPONSE_FIELDS.status_name]);
  const statusMismatch =
    res.ok && pancakeOrderId != null && returnedStatus != null && String(returnedStatus) !== String(CREATE_STATUS_PACKAGING);

  return {
    ok: res.ok && !!pancakeOrderId,
    pancakeOrderId,
    pancakeStatus,
    eventTimestamp: data[RESPONSE_FIELDS.updated_at] != null ? String(data[RESPONSE_FIELDS.updated_at]) : null,
    statusMismatch,
    httpStatus: res.httpStatus,
    error:
      res.ok && !pancakeOrderId
        ? "Pancake accepted the request but returned no order id (check RESPONSE_FIELDS in config.ts)"
        : res.error,
    responseSummary: res.body
      ? {
          id: pancakeOrderId,
          status: returnedStatus ?? null,
          status_name: pancakeStatus,
          custom_id: data[RESPONSE_FIELDS.external_reference] ?? null,
        }
      : null,
    requestPayload: body,
    responsePayload: (res.body as Record<string, unknown>) ?? null,
  };
}
