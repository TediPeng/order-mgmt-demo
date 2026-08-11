// ============================================================================
// PANCAKE POS ADAPTER CONFIG — THE ONLY FILE THAT SHOULD NEED EDITING WHEN
// THE PANCAKE API CHANGES.
//
// Values below were verified against the OFFICIAL Pancake POS OpenAPI spec
// (https://docs.pancake.biz/pos/api/en/ -> openapi.json, fetched 2026-07-27):
//   - base URL https://pos.pages.fm/api/v1
//   - auth = `api_key` QUERY PARAMETER (created in Pancake at
//     Setting -> Advance -> Third-party connection -> Webhook/API)
//   - POST /shops/{SHOP_ID}/orders, GET /shops/{SHOP_ID}/orders/{ORDER_ID}
//   - order statuses are INTEGER codes (see PANCAKE_STATUS_HINTS)
// Remaining unverified area: webhook push format — Pancake's public docs
// document no HMAC signing, so the webhook route also accepts a shared-token
// query parameter (?token=...) as verification; the payload parser reads the
// documented Order schema field names.
// ============================================================================

/**
 * MOCK_MODE: simulate the Pancake API locally without real credentials.
 *   PANCAKE_MOCK_MODE=success  -> every call succeeds (mock order ids, mock statuses)
 *   PANCAKE_MOCK_MODE=fail     -> every outbound call fails (tests the retry/needs-review flow)
 *   unset / anything else      -> real HTTP calls using the per-account endpoint + key
 */
export type MockMode = "success" | "fail" | "off";
export function mockMode(): MockMode {
  const v = (process.env.PANCAKE_MOCK_MODE || "").toLowerCase();
  if (v === "success") return "success";
  if (v === "fail") return "fail";
  return "off";
}

/** Official production API base (per-account api_endpoint overrides this). */
export const DEFAULT_API_BASE_URL = "https://pos.pages.fm/api/v1";

/** Pancake authenticates with an `api_key` QUERY PARAMETER — not a header. */
export const AUTH_QUERY_PARAM = "api_key";

/** `{shopId}` / `{orderId}` are substituted by the adapter. */
export const CREATE_ORDER_PATH = "/shops/{shopId}/orders";
export const GET_ORDER_PATH = "/shops/{shopId}/orders/{orderId}";

/** Lookup endpoints, all VERIFIED against the official OpenAPI spec — see
 * API_REFERENCE.md for the response shapes each one returns. */
export const ORDER_SOURCES_PATH = "/shops/{shopId}/order_source";
export const STAFF_PATH = "/shops/{shopId}/users";
export const PARTNERS_PATH = "/shops/{shopId}/partners";
/** Geo lists are shop-independent; they take a country_code query parameter. */
export const GEO_PROVINCES_PATH = "/geo/provinces";
export const GEO_DISTRICTS_PATH = "/geo/districts";
export const GEO_COMMUNES_PATH = "/geo/communes";

/** Philippines. Pancake's own example in the docs is Vietnam = 84. */
export const PH_COUNTRY_CODE = "63";

/** How long a fetched lookup list stays usable before it is re-fetched. Order
 * sources and staff change rarely, and the Settings page has a Refresh button
 * for when they do, so a daily TTL keeps the sync path from paying for a list
 * request on every order. */
export const LOOKUP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** How old a cached lookup list must be before a failed match is allowed to
 * re-read it from Pancake.
 *
 * A miss is the one moment the cache is worth doubting: the whole reason an
 * agent is missing from the Staff list is usually that they were added to
 * Pancake after we last read it, and a day-long TTL meant the order kept
 * failing until an Administrator thought to press Refresh on the mappings page.
 *
 * The threshold is what stops a sweep of unmatched orders from re-reading the
 * list once per order: the first miss refreshes it, and every miss for the next
 * minute is looking at a list that was just read, so there is nothing to gain
 * by reading it again. */
export const LOOKUP_REFRESH_ON_MISS_AFTER_MS = 60 * 1000;

/** Orders re-sent by one press of Retry All in the Sync Failed queue.
 *
 * Twenty was measured wrong on 2026-08-11: six orders took forty-four seconds,
 * about seven seconds each, and the request was killed before it could answer —
 * every order had actually synced, but the screen said only "Application error".
 * Each forward is several calls to Pancake, one of which can sit for fifteen
 * seconds before it times out, so the honest ceiling is a handful.
 *
 * Lives here rather than beside the action because the button has to say the
 * same number it will actually do, and a "use server" module can export nothing
 * but functions. */
export const RETRY_BATCH = 5;

/** Pancake-side status every order must land in on creation. Pancake's create
 * -order body takes an integer `status`, and 8 = "Packaging" (Đang đóng hàng)
 * per the spec's own enum — so it is set at creation, no follow-up call. The
 * response is checked against it and any discrepancy is surfaced. */
export const CREATE_STATUS_PACKAGING = 8;
export const CREATE_STATUS_PACKAGING_LABEL = "Packaging";

/**
 * Outbound field names for the create-order body.
 *
 * ALL VERIFIED against the official OpenAPI spec (see API_REFERENCE.md) — the
 * earlier guesses (`order_source_name`, `customer_care_email`, `shipping_note`)
 * did not exist in the schema at all, which is why those fields arrived empty
 * in Pancake.
 */
export const OUTBOUND_FIELDS = {
  /** Agent Call Name → Order Source. Spec: "Order sources ID" — an ID from
   * GET /shops/{id}/order_source, never a raw name. */
  order_source_id: "order_sources",
  /** Agent Email → Customer Care Staff. Spec: "Assigning care ID" — a user id
   * from GET /shops/{id}/users, never an email. */
  customer_care_staff_id: "assigning_care_id",
  /** Landmark → Extra Note → Printing. Spec: "Note for printing".
   * There is no `extra_note` object and no `shipping_note` field in the schema;
   * this is the only printing-note target Pancake exposes. */
  note_print: "note_print",
  /** Spec describes this verbatim as "Internal note" — deliberately sent EMPTY. */
  internal_note: "note",
} as const;

/** Shipment fields on the order's `partner` object (inbound). `tracking_link` is
 * NOT a courier tracking number — the spec calls it "Link confirm order" — so
 * the real tracking value is the partner's own shipping-order code. */
export const PARTNER_FIELDS = {
  courier_name: "partner_name",
  /** "Shipping order ID on partner system" — the courier tracking number. */
  tracking_code: "extend_code",
  shipper_name: "delivery_name",
  partner_status: "partner_status",
} as const;

/** Pancake status code for Shipped — the point at which `partner` carries a
 * courier and tracking code. */
export const STATUS_SHIPPED = 2;

/** Response/webhook field names, from the official Order schema. */
export const RESPONSE_FIELDS = {
  order_id: "id", // integer Pancake order id
  external_reference: "custom_id", // we store our internal order id here
  status: "status", // INTEGER status code
  status_name: "status_name", // Pancake's own label for that code
  updated_at: "updated_at", // ISO timestamp, used for out-of-order protection
  phone: "bill_phone_number",
  shop_id: "shop_id",
  display_id: "display_id",
  tracking: "tracking_link", // courier tracking URL, surfaced as Tracking Number
  partner: "partner", // carries partner_id / tracking id for some couriers
  // TODO(pancake-docs): confirm the exact tags field name/shape against the
  // official Order schema. Pancake's own UI calls these "tags"; readTags() below
  // accepts strings, {name}, and {tag_name} entries so any of those work.
  tags: "tags",
} as const;

/** The Pancake tag that flips a lead to the ODZ (out of delivery zone) status.
 * Compared case-insensitively after trimming, against every tag on the order. */
export const ODZ_TAG = "ODZ";

/** Normalizes Pancake's tag collection to plain strings. The field may arrive as
 * a list of strings, a list of objects, or a comma-separated string. */
export function readTags(raw: unknown): string[] {
  if (raw == null) return [];
  if (typeof raw === "string") return raw.split(",").map((t) => t.trim()).filter(Boolean);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        const o = entry as Record<string, unknown>;
        return String(o.name ?? o.tag_name ?? o.title ?? o.label ?? "");
      }
      return "";
    })
    .map((t) => t.trim())
    .filter(Boolean);
}

/** True when any tag on the order is the ODZ tag. Trimmed and case-insensitive,
 * so `odz`, `ODZ` and ` Odz ` all match, alongside any number of other tags. */
export function hasOdzTag(tags: string[] | null | undefined): boolean {
  return (tags || []).some((t) => t.trim().toLowerCase() === ODZ_TAG.toLowerCase());
}

/** Human-readable meaning of Pancake's integer status codes (from the
 * official spec's x-enum-descriptions) — shown as hints in the Status Map UI.
 * The editable pancake_status_map table remains the source of truth for how
 * each code maps to an internal lead status. */
export const PANCAKE_STATUS_HINTS: Record<string, string> = {
  "0": "New",
  "17": "Waiting for confirmation",
  "11": "Restocking",
  "12": "Wait for printing",
  "13": "Printed",
  "20": "Purchased",
  "1": "Confirmed",
  "8": "Packaging",
  "9": "Waiting for pick up",
  "2": "Shipped",
  "3": "Received",
  "16": "Collected money",
  "4": "Returning",
  "15": "Partial return",
  "5": "Returned",
  "6": "Canceled",
  "7": "Deleted recently",
};

/** Webhook contract. Pancake does not sign webhook payloads, but its webhook
 * settings DO let you attach custom Request Headers (their own docs example
 * uses `X-API-KEY`), so the preferred proof is a secret header. Three forms are
 * accepted, any one of which authenticates the request:
 *   1. `X-API-KEY: <webhook secret>` request header  (recommended — configure
 *      under Request Headers in Pancake's Webhook/API settings)
 *   2. HMAC-SHA256 hex of the raw body in `x-pancake-signature` (future-proof)
 *   3. `?token=<webhook secret>` on the registered URL (fallback when headers
 *      are inconvenient)
 * Pancake's `orders` webhook posts the bare Order object (id, status,
 * custom_id, updated_at, ...), which is what parseWebhookPayload reads.
 */
export const WEBHOOK = {
  secret_header: "x-api-key", // Pancake "Request Headers" — the recommended mechanism
  signature_header: "x-pancake-signature", // accepted if present (HMAC-SHA256 hex of raw body)
  token_query_param: "token",
  algorithm: "sha256" as const,
  /** Webhook type to enable in Pancake so order status changes are delivered. */
  order_webhook_type: "orders",
  // Payload field names follow the documented Order schema (RESPONSE_FIELDS).
  fields: {
    order_id: RESPONSE_FIELDS.order_id,
    external_reference: RESPONSE_FIELDS.external_reference,
    display_id: RESPONSE_FIELDS.display_id,
    phone: RESPONSE_FIELDS.phone,
    status: RESPONSE_FIELDS.status,
    event_timestamp: RESPONSE_FIELDS.updated_at,
    shop_id: RESPONSE_FIELDS.shop_id,
    tags: RESPONSE_FIELDS.tags,
  },
} as const;

/** Timeout for outbound Pancake calls (ms). */
export const REQUEST_TIMEOUT_MS = 15_000;
