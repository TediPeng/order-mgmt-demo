import type { Order, PancakeAccount } from "@/lib/types";
import { pancakeFetch, resolvePath } from "./client";
import { CREATE_ORDER_PATH, mockMode } from "./config";
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

  const from = unix(since);
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
