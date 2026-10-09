import type { Order, PancakeAccount } from "@/lib/types";
import { pancakeFetch, resolvePath } from "./client";
import { CREATE_ORDER_PATH, REQUEST_TIMEOUT_MS, mockMode } from "./config";
import { normalizePhone } from "@/lib/utils";

/**
 * Recovers an order Pancake may already hold, before a retry creates a second one.
 *
 * Without `custom_id` we have no external reference to ask Pancake about, so a
 * create that times out AFTER Pancake committed would otherwise be invisible to
 * us and the retry would duplicate a real order — meaning a duplicate shipment.
 *
 * `GET /shops/{id}/orders` takes a `search` string (phone / customer name /
 * note) and a date window, so a retry can look for the order it might already
 * have made and adopt it instead of creating another.
 *
 * Matching is deliberately strict — phone AND total AND inside the window —
 * because a false positive would silently attach us to somebody else's order.
 * A genuine repeat order from the same customer for the same amount inside the
 * window is the one ambiguous case; it is reported as `ambiguous` so a human
 * decides rather than the code guessing.
 */

export interface ExistingOrderMatch {
  found: boolean;
  ambiguous: boolean;
  pancakeOrderId: string | null;
  pancakeStatus: string | null;
  eventTimestamp: string | null;
  error: string | null;
}

const NONE: ExistingOrderMatch = {
  found: false,
  ambiguous: false,
  pancakeOrderId: null,
  pancakeStatus: null,
  eventTimestamp: null,
  error: null,
};

/** Pancake's date filters are unix seconds. */
function unix(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function money(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function findRecentOrderForRetry(
  account: PancakeAccount,
  order: Pick<Order, "customer_phone" | "total_amount">,
  since: string
): Promise<ExistingOrderMatch> {
  // The mock API never really created anything, so there is nothing to adopt.
  if (mockMode() !== "off") return NONE;

  const phone = (order.customer_phone || "").trim();
  if (!phone) {
    return { ...NONE, error: "Order has no phone number, so a prior Pancake order cannot be looked up." };
  }

  // The window has to open BEFORE the attempt it is asking about, not at it.
  //
  // `since` is pancake_last_sync_attempt_at, which forward.ts writes when an
  // attempt is recorded as FAILED -- after the request timed out. Pancake
  // created the order at the start of that request, so its inserted_at is up to
  // a whole timeout earlier, and a window opening at `since` begins just after
  // the only row it was looking for.
  //
  // That is how three customers were sent two parcels each on 7 and 8 Oct: 28525
  // was created at 08:08:57, the timeout was recorded at 08:09:12, and the retry
  // searched from 08:09:12. Fifteen seconds too late, every time.
  //
  // Reaching back by the timeout plus two minutes of slack covers the gap where
  // a committed-but-unacknowledged order can hide. Wider would be worse, not
  // safer: it would start catching the customer's genuine repeat orders, and
  // those come back as `ambiguous` and hold the order for a human.
  const LOOKBACK_SECONDS = Math.ceil(REQUEST_TIMEOUT_MS / 1000) + 120;
  const from = unix(since) - LOOKBACK_SECONDS;
  const to = Math.floor(Date.now() / 1000) + 60; // small skew allowance
  const path =
    `${resolvePath(CREATE_ORDER_PATH, account)}?search=${encodeURIComponent(phone)}` +
    `&startDateTime=${from}&endDateTime=${to}&page_size=50&page_number=1`;

  const res = await pancakeFetch(account, path, { method: "GET" });
  if (!res.ok) {
    // Inconclusive: we could not ask. The caller must NOT treat this as "no
    // duplicate exists" — it holds the order for review instead.
    return { ...NONE, error: res.error || "Could not query Pancake for an existing order." };
  }

  const body = (res.body || {}) as Record<string, unknown>;
  const rows = Array.isArray(body.data) ? (body.data as Record<string, unknown>[]) : [];
  const targetPhone = normalizePhone(phone);
  const targetTotal = money(order.total_amount);

  const candidates = rows.filter((r) => {
    const rowPhone = normalizePhone(String(r.bill_phone_number ?? ""));
    if (!rowPhone || rowPhone !== targetPhone) return false;
    if (targetTotal === null) return true;
    const rowTotal = money(r.total_price);
    // Compared in centavos to sidestep float noise.
    return rowTotal !== null && Math.round(rowTotal * 100) === Math.round(targetTotal * 100);
  });

  if (candidates.length === 0) return NONE;
  if (candidates.length > 1) {
    return {
      ...NONE,
      ambiguous: true,
      error: `Pancake already has ${candidates.length} orders matching this phone and total in the retry window — refusing to guess which one is this order.`,
    };
  }

  const match = candidates[0];
  const id = match.id;
  return {
    found: true,
    ambiguous: false,
    pancakeOrderId: id === null || id === undefined || id === "" ? null : String(id),
    pancakeStatus: match.status_name != null ? String(match.status_name) : null,
    eventTimestamp: match.updated_at != null ? String(match.updated_at) : null,
    error: null,
  };
}
