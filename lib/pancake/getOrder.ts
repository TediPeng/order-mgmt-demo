import type { Order, PancakeAccount } from "@/lib/types";
import type { GetOrderResult } from "./types";
import { GET_ORDER_PATH, RESPONSE_FIELDS, mockMode } from "./config";
import { pancakeFetch, resolvePath, unwrapData } from "./client";

/** Fetches the current Pancake-side state of a forwarded order
 * (GET /shops/{SHOP_ID}/orders/{ORDER_ID}). Status arrives as an INTEGER code;
 * it is stringified here and resolved through the editable status map. */
export async function getOrder(account: PancakeAccount, order: Pick<Order, "pancake_order_id">): Promise<GetOrderResult> {
  if (!order.pancake_order_id) {
    return {
      ok: false,
      httpStatus: null,
      error: "Order has no Pancake order id.",
      rawStatus: null,
      statusName: null,
      eventTimestamp: null,
      responseSummary: null,
    };
  }

  const mode = mockMode();
  if (mode === "success") {
    // Deterministic mock: pretend Pancake confirmed the order (code 1) just now.
    return {
      ok: true,
      httpStatus: 200,
      error: null,
      rawStatus: "1",
      statusName: "confirmed",
      eventTimestamp: new Date().toISOString(),
      responseSummary: { mock: true, status: "1" },
    };
  }
  if (mode === "fail") {
    return {
      ok: false,
      httpStatus: 503,
      error: "MOCK_MODE=fail: simulated Pancake API failure",
      rawStatus: null,
      statusName: null,
      eventTimestamp: null,
      responseSummary: { mock: true },
    };
  }

  const res = await pancakeFetch(account, resolvePath(GET_ORDER_PATH, account, order.pancake_order_id), { method: "GET" });
  const data = unwrapData(res.body);
  const rawStatus = data[RESPONSE_FIELDS.status] != null ? String(data[RESPONSE_FIELDS.status]) : null;
  // Pancake's own label ("packing", "shipped", …) so the UI shows words rather
  // than a bare status code. The raw code stays the value the map keys on.
  const statusName = data[RESPONSE_FIELDS.status_name] != null ? String(data[RESPONSE_FIELDS.status_name]) : null;
  const eventTimestamp = data[RESPONSE_FIELDS.updated_at] != null ? String(data[RESPONSE_FIELDS.updated_at]) : null;
  return {
    ok: res.ok,
    httpStatus: res.httpStatus,
    error: res.error,
    rawStatus,
    statusName,
    eventTimestamp,
    responseSummary: res.body ? { status: rawStatus, status_name: statusName, updated_at: eventTimestamp } : null,
  };
}
