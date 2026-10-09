import type { PancakeAccount } from "@/lib/types";
import type { CreateOrderResult, ForwardPayload } from "./types";
import {
  CREATE_ORDER_PATH,
  CREATE_STATUS_PACKAGING,
  CREATE_STATUS_PACKAGING_LABEL,
  OUTBOUND_FIELDS,
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
  return {
    // `custom_id` is deliberately NOT sent. Pancake adopts whatever custom_id it
    // is given AS the order's own id, which is why its screens were showing our
    // internal ORD-YYYYMMDD-#### instead of a Pancake number. Omitting it lets
    // Pancake generate the order id itself; we read that back off the response
    // and store it as the order's primary reference.
    //
    // Idempotency no longer rides on custom_id, so it rests on the remaining
    // guards: the pre-send duplicate check, the atomic claim to `syncing`, and
    // the successful-forward log check in forward.ts.
    // Every order must land in Pancake as Packaging.
    status: CREATE_STATUS_PACKAGING,
    bill_full_name: payload.customer_name,
    bill_phone_number: payload.phone,
    // Internal Note is sent EMPTY, always. It used to carry a composed summary
    // of the order; that leaked internal wording into a field the fulfillment
    // team writes in, so nothing is ever populated here now.
    [OUTBOUND_FIELDS.internal_note]: "",
    // Order Source and Care Staff are IDs resolved from Pancake's own lists
    // (lib/pancake/lookups.ts). Pancake ignores raw names here, which is why
    // both fields used to arrive empty. Omitted entirely when unresolved rather
    // than sent blank, so a partial payload never silently clears them.
    ...(payload.order_source_id ? { [OUTBOUND_FIELDS.order_source_id]: payload.order_source_id } : {}),
    ...(payload.care_staff_id ? { [OUTBOUND_FIELDS.customer_care_staff_id]: payload.care_staff_id } : {}),
    // Landmark → Extra Note → Printing.
    [OUTBOUND_FIELDS.note_print]: payload.landmark,
    shipping_fee: payload.shipping_fee ?? 0,
    total_discount: payload.discount ?? 0,
    shipping_address: {
      full_name: payload.customer_name,
      phone_number: payload.phone,
      // Purok / street stays a manual free-text field and maps to Full Address.
      // Pancake auto-parses `address` into province/district/commune ONLY when
      // no province_id is supplied — we always supply IDs, so that guesswork
      // never runs and the location is exactly what the agent picked.
      address: payload.purok || payload.complete_address,
      full_address: payload.purok || payload.complete_address,
      // Pancake's own IDs from its Select Address data. These are what actually
      // set the location; sending names alone left it null on their side.
      province_id: payload.province_id,
      district_id: payload.district_id,
      commune_id: payload.commune_id,
      // Names ride along as display labels only.
      province_name: payload.province,
      district_name: payload.city,
      commnue_name: payload.barangay, // (sic) misspelled in Pancake's own schema
    },
    // One Pancake item per line. This used to be a single item carrying the
    // order's TOTAL quantity under the summarised product name, so a
    // two-product order arrived as one line of quantity 2 priced at the first
    // product's price, and the second product never arrived at all.
    items: payload.items.map((line) => ({
      ...(line.one_time_product ? {} : { variation_id: line.variation_id }),
      one_time_product: line.one_time_product,
      quantity: line.quantity,
      discount_each_product: line.discount,
      is_bonus_product: false,
      is_discount_percent: false,
      is_wholesale: false,
      variation_info: {
        name: [line.product_name, line.variant].filter(Boolean).join(" — ") || "Item",
        // A freebie is a line at zero, which is what the agent entered.
        retail_price: line.unit_price,
      },
    })),
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
  // Pancake's own generated order id, now that we no longer impose a custom_id.
  // Stored verbatim — never generated or reformatted here.
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
          // Pancake's per-shop sequence number, kept for troubleshooting so a
          // Pancake order can still be located if the id ever looks wrong.
          system_id: data.system_id ?? null,
          order_link: data.order_link ?? null,
        }
      : null,
    requestPayload: body,
    responsePayload: (res.body as Record<string, unknown>) ?? null,
  };
}
