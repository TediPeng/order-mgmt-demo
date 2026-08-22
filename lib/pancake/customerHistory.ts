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
/** One parcel, as the history panel lists it. */
export interface PancakeOrderRow {
  /** Pancake's own display id, so it can be found in Pancake. */
  id: string;
  /** ISO, or null when Pancake sent no date on the row. */
  date: string | null;
  /** The mapped internal status — what the badge colours off. */
  status: string;
  /** Pancake's own label for the code, shown when it has one. */
  statusName: string | null;
  total: number | null;
}

/**
 * The four statuses the list shows.
 *
 * Narrower than everything Pancake returns, and deliberately: a customer's
 * carts, confirmations and cancellations are noise against the question being
 * asked, which is what happened to the parcels that were actually sent. Shipped
 * and returning are in flight — they say something is on its way back or out,
 * which is worth seeing beside a rate they do not yet count toward.
 */
const LISTED_STATUSES = ["delivered", "returned", "shipped", "returning"];

export interface PancakeCustomerHistory {
  delivered: number;
  returned: number;
  /** Rows the search returned for this number, whatever their status — context
   * for a rate built on very few. */
  totalOrders: number;
  /** The parcels worth listing, newest first. */
  orders: PancakeOrderRow[];
  /** Set when Pancake could not be asked. The caller shows nothing rather than
   * a zero: "no returns" and "we could not check" must never look alike. */
  error: string | null;
}

const EMPTY: PancakeCustomerHistory = { delivered: 0, returned: 0, totalOrders: 0, orders: [], error: null };

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

  // Mock mode answers like the rest of the adapter does — getOrder pretends
  // Pancake confirmed an order, and this pretends it holds a history. Without
  // it the panel cannot be opened at all outside production, which is where it
  // most needs looking at. The shape is deterministic so a screenshot taken
  // locally means something.
  const mode = mockMode();
  if (mode === "fail") return { ...EMPTY, error: "MOCK_MODE=fail: simulated Pancake API failure" };
  if (mode === "success") {
    const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
    return {
      delivered: 7,
      returned: 5,
      totalOrders: 13,
      orders: [
        { id: "23486", date: day(2), status: "returned", statusName: "returned", total: 1200 },
        { id: "23289", date: day(6), status: "delivered", statusName: "received", total: 850 },
        { id: "23186", date: day(11), status: "returned", statusName: "returned", total: 1500 },
        { id: "23126", date: day(18), status: "delivered", statusName: "received", total: 950 },
        { id: "22984", date: day(23), status: "shipped", statusName: "shipped", total: 700 },
        { id: "22871", date: day(30), status: "returning", statusName: "returning", total: 1100 },
      ],
      error: null,
    };
  }

  const to = Math.floor(Date.now() / 1000) + 60;
  const from = to - WINDOW_DAYS * 24 * 60 * 60;
  const statusMap = await listStatusMap();

  let delivered = 0;
  let returned = 0;
  let totalOrders = 0;
  const orders: PancakeOrderRow[] = [];

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
      // The rate counts only what finished. Shipped and returning are still
      // moving and would make a rate that changes without anything happening.
      if (internal === "delivered") delivered += 1;
      else if (internal === "returned") returned += 1;

      if (internal && LISTED_STATUSES.includes(internal)) {
        const date = row.inserted_at ?? row.updated_at ?? null;
        const total = Number(row.total_price);
        orders.push({
          id: String(row.display_id ?? row.id ?? ""),
          date: date ? String(date) : null,
          status: internal,
          statusName: row.status_name != null ? String(row.status_name) : null,
          total: Number.isFinite(total) ? total : null,
        });
      }
    }

    if (rows.length < PAGE_SIZE) break;
  }

  // Newest first: the question is usually "what happened lately", and a
  // customer whose returns are all a year old is a different conversation.
  orders.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  return { delivered, returned, totalOrders, orders, error: null };
}

/**
 * What happened to this number's most recent Pancake order, whatever it was.
 *
 * Deliberately not `pancakeCustomerHistory().orders[0]`. That list is filtered
 * to the four statuses worth showing a supervisor, so a customer whose newest
 * order is sitting unconfirmed does not appear in it at all — and the newest
 * row that DOES appear could be a delivery from months ago. A gate that reads
 * "the latest order was delivered" off that list would wave through exactly the
 * customer it exists to stop.
 *
 * `found: false` means Pancake holds no order for this number. That is a new
 * customer, not a bad one.
 */
export interface LatestPancakeOrder {
  found: boolean;
  /** The mapped internal status, or null when the code is unknown to us. */
  status: string | null;
  /** Pancake's own wording, which is what the agent will see in Pancake. */
  statusName: string | null;
  id: string;
  date: string | null;
  /** Set when Pancake could not be asked. Never conflated with "no orders". */
  error: string | null;
}

const NO_LATEST: LatestPancakeOrder = { found: false, status: null, statusName: null, id: "", date: null, error: null };

export async function latestPancakeOrder(account: PancakeAccount, phone: string): Promise<LatestPancakeOrder> {
  const target = normalizePhone(phone || "");
  if (!target) return NO_LATEST;

  const mode = mockMode();
  if (mode === "fail") return { ...NO_LATEST, error: "MOCK_MODE=fail: simulated Pancake API failure" };
  if (mode === "success") {
    return {
      found: true,
      status: "delivered",
      statusName: "received",
      id: "23486",
      date: new Date(Date.now() - 2 * 86400000).toISOString(),
      error: null,
    };
  }

  const to = Math.floor(Date.now() / 1000) + 60;
  const from = to - WINDOW_DAYS * 24 * 60 * 60;
  const statusMap = await listStatusMap();

  let best: { date: string; row: Record<string, unknown> } | null = null;
  let sawAny = false;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const path =
      `${resolvePath(CREATE_ORDER_PATH, account)}?search=${encodeURIComponent(phone)}` +
      `&startDateTime=${from}&endDateTime=${to}&page_size=${PAGE_SIZE}&page_number=${page}`;

    const res = await pancakeFetch(account, path, { method: "GET" });
    if (!res.ok) {
      return { ...NO_LATEST, error: res.error || "Could not read this customer's history from Pancake POS." };
    }

    const body = (res.body || {}) as Record<string, unknown>;
    const rows = Array.isArray(body.data) ? (body.data as Record<string, unknown>[]) : [];
    if (rows.length === 0) break;

    for (const row of rows) {
      // The search is fuzzy — a name containing the digits must not decide
      // whether somebody's order is allowed to leave.
      if (normalizePhone(String(row.bill_phone_number ?? "")) !== target) continue;
      sawAny = true;
      const date = String(row.inserted_at ?? row.updated_at ?? "");
      if (!best || date > best.date) best = { date, row };
    }

    if (rows.length < PAGE_SIZE) break;
  }

  if (!sawAny || !best) return NO_LATEST;

  const internal = mapStatus(String(best.row.status ?? ""), statusMap);
  return {
    found: true,
    status: internal || null,
    statusName: best.row.status_name != null ? String(best.row.status_name) : null,
    id: String(best.row.display_id ?? best.row.id ?? ""),
    date: best.date || null,
    error: null,
  };
}
