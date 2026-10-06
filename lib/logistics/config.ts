// ============================================================================
// LOGISTICS ADAPTER CONFIG — the only file that should need editing when the
// Pancake list-orders API changes.
//
// Every value here was read from the OFFICIAL Pancake POS OpenAPI 3.1 spec
// (https://docs.pancake.biz/pos/api/openapi.json?lang=en), re-fetched
// 2026-08-28: 1,258,375 bytes, 85 paths. Nothing below is inferred.
// See lib/pancake/API_REFERENCE.md for the shared facts (query-param auth,
// base URL, integer order statuses).
// ============================================================================

/** Verified: `GET /shops/{SHOP_ID}/orders`, "List of orders". */
export const LIST_ORDERS_PATH = "/shops/{shopId}/orders";

/** Verified: `GET /shops/{SHOP_ID}/partners`, the shop's shipping partners.
 * Used to normalize courier names instead of hardcoding them (SPEC §21). */
export const PARTNERS_PATH = "/shops/{shopId}/partners";

/**
 * Query parameters on the list endpoint, all verified against the spec.
 *
 * `updateStatus` does NOT filter by status — it selects WHICH timestamp the
 * date window applies to. Its enum includes `inserted_at`, `updated_at`,
 * `partner_inserted_at`, `picked_up_at`, `first_delivery_at` and the status
 * codes. We use `updated_at`, which is what makes incremental sync possible.
 */
export const LIST_PARAMS = {
  page_size: "page_size",
  page_number: "page_number",
  /** Which timestamp startDateTime/endDateTime apply to. */
  date_field: "updateStatus",
  /** UNIX SECONDS, not milliseconds and not ISO. */
  start: "startDateTime",
  end: "endDateTime",
  /** Repeatable: `filter_status[]=2&filter_status[]=9`. */
  status: "filter_status[]",
  sort: "option_sort",
} as const;

/** The value of `updateStatus` we page on. */
export const DATE_FIELD_UPDATED = "updated_at";

/**
 * Ascending by last update, matching the field the window filters on.
 *
 * A descending sort over a window that is still being written to shifts rows
 * between pages — an order updated mid-paging jumps to page 1 and pushes an
 * unread row off the end. Ascending only ever appends.
 */
export const SORT_UPDATED_ASC = "last_updated_order_asc";

/**
 * Statuses the first sync of a new connection asks for (SPEC §12): wait for
 * printing, printed, packaging, waiting for pick up, shipped, returning,
 * partial return. Delivered and cancelled history is deliberately excluded —
 * it would be tens of thousands of rows with no logistics meaning.
 */
export const INITIAL_SYNC_STATUSES = [12, 13, 8, 9, 2, 4, 15] as const;

/**
 * Orders per page.
 *
 * Pancake documents no maximum, so this starts conservative and is raised only
 * against a real shop with a real measurement behind it.
 */
export const PAGE_SIZE = 50;

/** Hard ceiling on pages in one run, so a mis-set cursor cannot walk a shop's
 * entire history in a single function invocation. A run that hits it ends as
 * `partial` with its cursor unmoved, and the next run continues. */
export const MAX_PAGES_PER_RUN = 40;

/**
 * Overlap subtracted from the cursor at the start of every window (SPEC §11).
 *
 * Covers clock skew between Pancake and us, and orders written while a page
 * was in flight. Re-reading them costs nothing: the upsert conflicts on
 * (connection_id, external_order_id) and history rows are de-duplicated.
 */
export const SYNC_OVERLAP_MINUTES = 5;

/** Retry ladder for a page that fails with 429 or 5xx. Jitter is added per
 * attempt. Three attempts, then the run ends — no unbounded loop (SPEC §34). */
export const PAGE_RETRY_DELAYS_MS = [1_000, 4_000, 12_000] as const;

/** Longer than the outbound adapter's 15s: a page of 50 orders with items and
 * status history is a much larger response than a single order. */
export const LIST_TIMEOUT_MS = 30_000;

/**
 * MOCK_MODE for local work without credentials, mirroring PANCAKE_MOCK_MODE.
 *   LOGISTICS_MOCK_MODE=success -> canned pages from fixtures
 *   LOGISTICS_MOCK_MODE=fail    -> every list call fails
 * Must stay unset on Vercel.
 */
export type LogisticsMockMode = "success" | "fail" | "off";
export function logisticsMockMode(): LogisticsMockMode {
  const v = (process.env.LOGISTICS_MOCK_MODE || "").toLowerCase();
  if (v === "success") return "success";
  if (v === "fail") return "fail";
  return "off";
}

/** Response field names on a listed order, from the official Order schema. */
export const ORDER_FIELDS = {
  id: "id",
  system_id: "system_id",
  custom_id: "custom_id",
  inserted_at: "inserted_at",
  updated_at: "updated_at",
  status: "status",
  status_name: "status_name",
  customer_name: "bill_full_name",
  customer_phone: "bill_phone_number",
  cod: "cod",
  order_sources: "order_sources",
  assigning_care: "assigning_care",
  creator: "creator",
  partner: "partner",
  status_history: "status_history",
  time_send_partner: "time_send_partner",
  last_update_status_at: "last_update_status_at",
} as const;

/** Shipment fields on the order's `partner` object.
 *
 * `extend_code` is the courier tracking number ("Shipping order ID on partner
 * system"). The order's own `tracking_link` is NOT one — the spec calls it
 * "Link confirm order". */
export const PARTNER_FIELDS = {
  courier_name: "partner_name",
  shipper_name: "delivery_name",
  tracking_code: "extend_code",
  partner_status: "partner_status",
  picked_up_at: "picked_up_at",
  first_delivery_at: "first_delivery_at",
  first_undeliverable_at: "first_undeliverable_at",
  extend_update: "extend_update",
} as const;

/** Pagination metadata on the list response. */
export const LIST_RESPONSE_FIELDS = {
  data: "data",
  page_number: "page_number",
  page_size: "page_size",
  total_entries: "total_entries",
  total_pages: "total_pages",
} as const;
