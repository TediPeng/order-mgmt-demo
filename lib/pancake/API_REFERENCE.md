# Pancake POS API — verified reference

Every value below was read from the **official OpenAPI 3.1 spec**, fetched
2026-07-31 from `https://docs.pancake.biz/pos/api/openapi.json?lang=en`
(1,162,130 bytes, 82 endpoints). Nothing here is inferred or guessed. Where a
claim comes from an observed live response rather than the spec, it says so.

Auth is an **`api_key` QUERY parameter** (`components.securitySchemes.ApiKeyAuth`,
`in: query`), applied globally — every endpoint below needs it, including `/geo/*`.

Base URL: `https://pos.pages.fm/api/v1`

---

## 1. Endpoints that resolve the spec's TODOs

| Need | Endpoint | Status |
|---|---|---|
| Create order | `POST /shops/{SHOP_ID}/orders` | ✅ exists |
| Read order | `GET /shops/{SHOP_ID}/orders/{ORDER_ID}` | ✅ exists |
| Order Sources list | `GET /shops/{SHOP_ID}/order_source` | ✅ exists |
| Staff list | `GET /shops/{SHOP_ID}/users` | ✅ exists |
| Province list | `GET /geo/provinces?country_code={cc}` | ✅ exists |
| City list | `GET /geo/districts?province_id={id}` | ✅ exists |
| Barangay list | `GET /geo/communes?province_id={pid}&district_id={did}` | ✅ exists |
| Courier/partner list | `GET /shops/{SHOP_ID}/partners` | ✅ exists |
| Arrange shipment | `POST /shops/{SHOP_ID}/orders/arrange_shipment` | ✅ exists |

**Every endpoint the fix spec asked for exists.** Strategy A (Section 0.2) is
therefore technically available — subject to the open question in §5 below.

### Address hierarchy naming

Pancake's model is Vietnamese-shaped: **province → district → commune**. The PH
equivalents map positionally:

| 4S ROMA | Pancake |
|---|---|
| Province | `province_id` / `province_name` |
| City / Municipality | `district_id` / `district_name` |
| Barangay | `commune_id` / `commnue_name` *(sic — misspelled in Pancake's own schema)* |

---

## 2. Field mappings (spec §2–§5)

### Order Source — §2
- List: `GET /shops/{SHOP_ID}/order_source` → `data[]: { id, name, parent_id, shop_id, link }`
- Create-order field: **`order_sources`** (string) — described as *"Order sources ID"*.
- So: match Agent `call_name` → `data[].name`, send `data[].id` as `order_sources`.

### Customer Care Staff — §3
- List: `GET /shops/{SHOP_ID}/users` → `data[]: { user_id, shop_id, department, user: { id, email, name, fb_id, ... } }`
- Create-order fields: **`assigning_care_id`** (string) and/or the
  **`assigning_care`** object (`{ id, fb_id, name, email, avatar_url, phone_number }`).
- So: match agent email → `data[].user.email`, send `data[].user.id` as `assigning_care_id`.

### Address — §4
Create-order `shipping_address` object accepts:
`address, full_address, full_name, phone_number, province_id, province_name,
district_id, district_name, commune_id, commnue_name, country_code, post_code,
new_province_id, new_full_address, render_type`.

Documented auto-parse behaviour (verbatim from the `address` field description):

> Street address. When creating an order via API, if `address` is provided but
> `province_id` is left empty, the system automatically parses this free-text
> address to fill in `province_id`, `district_id` and `commune_id`. Auto-fill is
> skipped when the parsed location is in Thailand (country code 66) or when no
> commune can be resolved from the text.

This is why our addresses come back empty: we send `province_name` etc. as text
and never send the `*_id` fields, so Pancake tries to parse and fails.

### Landmark → Extra Note → Printing — §5
- Create-order field: **`note_print`** (string) — described as *"Note for printing"*.
- **`note`** (string) is described as *"Internal note"* — confirms it must stay empty.
- There is **no** `extra_note` object and **no** `shipping_note` field in the schema.
  `note_print` is the correct and only target for Landmark.

### Courier & Tracking — §6
The `partner` object on an order carries shipment data:

| Need | Field | Description (verbatim) |
|---|---|---|
| Courier name | `partner.partner_name` | "Partner name" |
| Shipper name | `partner.delivery_name` | "Shipper name" |
| **Tracking number** | `partner.extend_code` | **"Shipping order ID on partner system"** |
| Courier status | `partner.partner_status` | "Partner shipping status" |
| Viettel Post only | `partner.order_number_vtp` | "Viettel Post tracking number" |

⚠️ **`tracking_link` is NOT a courier tracking number.** The spec describes it as
*"Link confirm order"*, and `POST /shops/{SHOP_ID}/orders/get_tracking_url`
returns `{ url }` described as *"Order confirm link"*. We are currently storing
this confirm-link in `orders.tracking_number` — that is a mis-mapping.

### Order status codes
`status` is an integer enum, confirmed complete:

| Code | Meaning | | Code | Meaning |
|---|---|---|---|---|
| 0 | New | | 2 | **Shipped** |
| 17 | Waiting for confirmation | | 3 | Received |
| 11 | Restocking | | 16 | Collected money |
| 12 | Wait for printing | | 4 | Returning |
| 13 | Printed | | 15 | Partial return |
| 20 | Purchased | | 5 | Returned |
| 1 | Confirmed | | 6 | Canceled |
| 8 | **Packaging** (we create here) | | 7 | Deleted recently |
| 9 | Waiting for pick up | | | |

Shipment-created event (§6) = transition into **status 2 (Shipped)**, at which
point `partner` should be populated.

---

## 3. Order identity — §1 (⚠️ read before implementing)

The spec's response schema declares `id` as **integer** "Order ID". **Live
responses disagree.** Observed on three real orders in this shop:

| Our order | Response `data.id` | `display_id` | `system_id` | Real id inside `order_link` |
|---|---|---|---|---|
| ORD-20260730-0003 | `"ORD-20260730-0003"` | `null` | `13` | `10889883949` |
| ORD-20260730-0001 | `"ORD-20260730-0001"` | `null` | `12` | `450373023761143` |
| ORD-20260728-0002 | `"ORD-20260728-0002"` | `null` | `11` | `360301005593774` |

`data.id` echoes back the `custom_id` **we** supplied, so `orders.pancake_order_id`
currently stores our own order number — not a Pancake-generated identifier.
`display_id` is null on every one.

Candidates for "the Pancake Order ID" (§1) are therefore:
- **`system_id`** — small sequential per-shop integer (11, 12, 13). Matches what
  `POST /orders/get_tracking_url` requires as input, so it is a real handle.
- the large id embedded in `order_link` (`?order_id=…`) — Pancake's internal id.

**This needs your decision plus one confirmation against the Pancake UI** — see
open questions.

---

## 4. Diagnostic evidence for the reported symptoms

Read from `orders.pancake_response_payload` on live synced orders:

| Symptom (your spec) | Evidence | Root cause |
|---|---|---|
| Order Source empty | `order_sources_name: ""` | we never send `order_sources` (the ID) |
| Care Staff empty | `assigning_care_id: null` | we never send `assigning_care_id` |
| Address wrong/empty | `province_id`, `province_name`, `district_name` all `null` | we send names only; Pancake wants `*_id`, and its text parser fails on PH addresses |
| Courier/Tracking missing | `partner: null` | no shipment arranged yet; and we read `tracking_link`, which is the confirm link, not the courier code |

Every one is confirmed, not assumed.

---

## 5. ⚠️ OPEN — blocks the Strategy A / B decision

`GET /geo/provinces` requires `country_code` ("for example, Vietnam country code
is 84"). **Whether Pancake holds Philippine (country_code 63) geo data is
unknown and cannot be determined from the spec** — the spec documents the
endpoint's shape, not its contents.

This decides Section 0.2 outright:
- **PH data present** → Strategy A: source our dropdowns from Pancake, exact IDs, no mismatches possible.
- **PH data absent/empty** → Strategy A is impossible; fall back to Strategy B (PSGC + alias mapping), and accept that Pancake will hold PH addresses as free text.

Answering it needs one authenticated call, which requires the shop's API key.
