import type { Order, PancakeAccount } from "@/lib/types";
import type { GetOrderResult } from "./types";
import { GET_ORDER_PATH, PARTNER_FIELDS, RESPONSE_FIELDS, mockMode, readTags } from "./config";
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
      trackingNumber: null,
      courier: null,
      confirmLink: null,
      eventTimestamp: null,
      tags: [],
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
      trackingNumber: "MOCK-TRACK-1",
      courier: "Mock Courier",
      confirmLink: null,
      eventTimestamp: new Date().toISOString(),
      tags: [],
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
      trackingNumber: null,
      courier: null,
      confirmLink: null,
      eventTimestamp: null,
      tags: [],
      responseSummary: { mock: true },
    };
  }

  const res = await pancakeFetch(account, resolvePath(GET_ORDER_PATH, account, order.pancake_order_id), { method: "GET" });
  const data = unwrapData(res.body);
  const rawStatus = data[RESPONSE_FIELDS.status] != null ? String(data[RESPONSE_FIELDS.status]) : null;
  // Pancake's own label ("packing", "shipped", …) so the UI shows words rather
  // than a bare status code. The raw code stays the value the map keys on.
  const statusName = data[RESPONSE_FIELDS.status_name] != null ? String(data[RESPONSE_FIELDS.status_name]) : null;
  // The courier tracking number lives on the shipment partner as `extend_code`
  // ("Shipping order ID on partner system"). `tracking_link` is NOT it — the
  // official spec describes that field as "Link confirm order", so storing it
  // as a tracking number put a customer-facing confirmation URL in the Tracking
  // Number column. The link is still captured separately for reference.
  const partner = (data[RESPONSE_FIELDS.partner] || {}) as Record<string, unknown>;
  const tracking = partner[PARTNER_FIELDS.tracking_code] != null
    ? String(partner[PARTNER_FIELDS.tracking_code])
    : null;
  const courier =
    (partner[PARTNER_FIELDS.courier_name] != null ? String(partner[PARTNER_FIELDS.courier_name]) : null) ||
    (partner[PARTNER_FIELDS.shipper_name] != null ? String(partner[PARTNER_FIELDS.shipper_name]) : null);
  const confirmLink = data[RESPONSE_FIELDS.tracking] != null ? String(data[RESPONSE_FIELDS.tracking]) : null;
  const eventTimestamp = data[RESPONSE_FIELDS.updated_at] != null ? String(data[RESPONSE_FIELDS.updated_at]) : null;
  const tags = readTags(data[RESPONSE_FIELDS.tags]);
  return {
    ok: res.ok,
    httpStatus: res.httpStatus,
    error: res.error,
    rawStatus,
    statusName,
    trackingNumber: tracking,
    courier,
    confirmLink,
    eventTimestamp,
    tags,
    responseSummary: res.body
      ? { status: rawStatus, status_name: statusName, updated_at: eventTimestamp, tags, courier, tracking }
      : null,
  };
}
