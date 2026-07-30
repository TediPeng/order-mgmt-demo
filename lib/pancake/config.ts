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

/** Pancake-side status every order must land in on creation. Pancake's create
 * -order body takes an integer `status`, and 8 = "Packaging" (Đang đóng hàng)
 * per the spec's own enum — so it is set at creation, no follow-up call. The
 * response is checked against it and any discrepancy is surfaced. */
export const CREATE_STATUS_PACKAGING = 8;
export const CREATE_STATUS_PACKAGING_LABEL = "Packaging";

/**
 * Outbound field names for the create-order body (Section 1.3 mapping).
 *
 * `custom_id`, `bill_full_name`, `bill_phone_number`, `status` and the
 * `shipping_address` sub-fields are CONFIRMED against the official OpenAPI spec.
 * The four below are NOT yet confirmed and stay marked so a wrong guess is
 * obvious rather than silent — verify each against the official docs before
 * relying on it in production.
 */
export const OUTBOUND_FIELDS = {
  /** Agent Call Name → Order Source. TODO(pancake-docs): confirm the name; the
   * spec also exposes `order_sources` as an id reference. */
  order_source: "order_source_name",
  /** Agent Email → Customer Care Staff. TODO(pancake-docs): confirm; Pancake
   * refers to an assigned care staff, possibly by id (`assigning_care_id`). */
  customer_care_staff: "customer_care_email",
  /** Landmark → Shipping Notes. TODO(pancake-docs): confirm whether shipping
   * notes live on the order or inside shipping_address. */
  shipping_notes: "shipping_note",
  /** Internal Note. Deliberately sent EMPTY — see buildCreateOrderBody. */
  internal_note: "note",
} as const;

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
