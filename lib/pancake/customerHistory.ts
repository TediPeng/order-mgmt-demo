import type { PancakeAccount } from "@/lib/types";
import { pancakeFetch, resolvePath } from "./client";
import { CREATE_ORDER_PATH, mockMode } from "./config";
import { listStatusMap } from "./store";
import { mapStatus } from "./mapStatus";
import { normalizePhone } from "@/lib/utils";

/**
 * How a customer's parcels have ended, asked of Pancake rather than of us.
 *
 * ROMA only knows the orders it sent — 822 of them — while Pancake holds
 * everything that number has ever bought, including orders taken before this
 * app existed or entered somewhere else. For "has this person sent parcels
 * back", Pancake's copy is the one worth asking.
 *
 * `GET /shops/{id}/orders?search=…` is the same endpoint findRecentOrderForRetry
 * uses to recover a duplicate; `search` matches phone, name or note, so every
 * row is re-checked against the normalised number before it is counted. A name
 * that happens to contain the digits must not become somebody's return rate.
 *
 * Statuses are resolved through the editable pancake_status_map, not against
 * hard-coded 3 and 5. That table is the source of truth for what a Pancake code
 * means here, an Administrator can change it in Settings, and a counter that
 * disagreed with the mapping would report one thing while the order list showed
 * another.
 */
export interface PancakeCustomerHistory {
  delivered: number;
  returned: number;
  /** Rows the search returned for this number, whatever their status — context
   * for a rate built on very few. */
  totalOrders: number;
  /** Set when Pancake could not be asked. The caller shows nothing rather than
   * a zero: "no returns" and "we could not check" must never look alike. */
  error: string | null;
}

const EMPTY: PancakeCustomerHistory = { delivered: 0, returned: 0, totalOrders: 0, error: null };

/** How far back to look. Two years covers a repeat buyer's history without
 * asking Pancake to scan its whole archive for every popup. */
const WINDOW_DAYS = 730;
const PAGE_SIZE = 100;
/** A customer with more than this many orders is not going to change the
 * verdict, and paging further is time an agent spends waiting mid-call. */
const MAX_PAGES = 3;

export async function pancakeCustomerHistory(
  account: PancakeAccount,
  phone: string
): Promise<PancakeCustomerHistory> {
  const target = normalizePhone(phone || "");
  if (!target) return EMPTY;

  // Mock mode has no real order history to count, and inventing one would put
  // a fabricated return rate in front of an agent.
  if (mockMode() !== "off") return EMPTY;

  const to = Math.floor(Date.now() / 1000) + 60;
  const from = to - WINDOW_DAYS * 24 * 60 * 60;
  const statusMap = await listStatusMap();

  let delivered = 0;
  let returned = 0;
  let totalOrders = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const path =
      `${resolvePath(CREATE_ORDER_PATH, account)}?search=${encodeURIComponent(phone)}` +
      `&startDateTime=${from}&endDateTime=${to}&page_size=${PAGE_SIZE}&page_number=${page}`;

    const res = await pancakeFetch(account, path, { method: "GET" });
    if (!res.ok) {
      return { ...EMPTY, error: res.error || "Could not read this customer's history from Pancake POS." };
    }

    const body = (res.body || {}) as Record<string, unknown>;
    const rows = Array.isArray(body.data) ? (body.data as Record<string, unknown>[]) : [];
    if (rows.length === 0) break;

    for (const row of rows) {
      // The search is fuzzy; the count must not be.
      if (normalizePhone(String(row.bill_phone_number ?? "")) !== target) continue;
      totalOrders += 1;
      const internal = mapStatus(String(row.status ?? ""), statusMap);
      if (internal === "delivered") delivered += 1;
      else if (internal === "returned") returned += 1;
    }

    if (rows.length < PAGE_SIZE) break;
  }

  return { delivered, returned, totalOrders, error: null };
}
