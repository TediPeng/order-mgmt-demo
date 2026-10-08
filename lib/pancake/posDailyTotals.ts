import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { PancakeAccount } from "@/lib/types";
import { pancakeFetch } from "./client";
import { normalizePhone } from "@/lib/utils";

/**
 * Mirrors a day of Pancake totals into pos_daily_totals.
 *
 * The dashboard is to read the POS figure rather than ROMA's own, which is his
 * decision; this is what keeps that from meaning a live API call on every page
 * load. Pancake answers a listing in seconds and timed out 443 times in the week
 * to 8 Oct, so a dashboard wired straight to it would be exactly as reliable as
 * the POS is at that moment.
 *
 * A day is the unit because a day is the smallest range any tile asks for, and
 * summing days is how This Week and This Month are answered.
 *
 * It also counts duplicates, which the POS does not offer and which is the whole
 * reason the two systems disagree: on 8 Oct the POS totalled P115,139 against
 * ROMA's P111,839, and every peso of it was two cancellations and two orders
 * that had been created twice.
 */

/** Pancake order status 6. The only code this module needs to name: the rest are
 *  carried through as-is in by_status. */
const CANCELLED = 6;

const PAGE_SIZE = 100;
const MAX_PAGES = 60;
const MANILA_OFFSET_HOURS = 8;

export interface PosDayTotals {
  day: string;
  orders: number;
  quantity: number;
  amount: number;
  cancelledOrders: number;
  cancelledAmount: number;
  byStatus: Record<string, { orders: number; amount: number }>;
  duplicateOrders: number;
  duplicateAmount: number;
}

/** Unix seconds bounding a Manila day. The API takes seconds -- not ISO, not
 *  milliseconds -- and Manila has no daylight saving to complicate the offset. */
function manilaDayWindow(day: string): { start: number; end: number } {
  const startMs = Date.parse(`${day}T00:00:00.000Z`) - MANILA_OFFSET_HOURS * 3_600_000;
  const start = Math.floor(startMs / 1000);
  return { start, end: start + 86_400 };
}

function money(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

type PancakeRow = Record<string, unknown>;

function rowPhone(o: PancakeRow): string {
  const direct = o.bill_phone_number;
  if (typeof direct === "string" && direct.trim()) return normalizePhone(direct);
  const ship = (o.shipping_address as Record<string, unknown> | undefined)?.phone_number;
  return typeof ship === "string" ? normalizePhone(ship) : "";
}

/** Every order Pancake inserted on this Manila day, paged to the end.
 *
 *  Ascending, because a descending sort over a window still being written to
 *  lets an order updated mid-paging jump to page 1 and push an unread row off
 *  the back -- the listing is by inserted_at, but the ordering guarantee is the
 *  same trap either way. */
async function fetchDay(account: PancakeAccount, day: string): Promise<PancakeRow[]> {
  const { start, end } = manilaDayWindow(day);
  const rows: PancakeRow[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const qs = new URLSearchParams({
      page_size: String(PAGE_SIZE),
      page_number: String(page),
      updateStatus: "inserted_at",
      startDateTime: String(start),
      endDateTime: String(end),
      option_sort: "inserted_at_asc",
    });
    const res = await pancakeFetch(account, `/shops/${encodeURIComponent(account.shop_or_page_id)}/orders?${qs}`, {
      method: "GET",
    });
    // A partial day is worse than no day: it would be stored as the truth and
    // read as a drop in sales. Fail the whole day instead.
    if (!res.ok) throw new Error(`Pancake listing failed on page ${page}: ${res.error}`);

    const body = (res.body || {}) as Record<string, unknown>;
    const data = Array.isArray(body.data) ? (body.data as PancakeRow[]) : [];
    rows.push(...data);
    const totalPages = Number(body.total_pages ?? 1);
    if (data.length === 0 || page >= totalPages) break;
  }
  return rows;
}

export function summarise(day: string, rows: PancakeRow[]): PosDayTotals {
  const byStatus: Record<string, { orders: number; amount: number }> = {};
  let orders = 0;
  let quantity = 0;
  let amount = 0;
  let cancelledOrders = 0;
  let cancelledAmount = 0;

  for (const o of rows) {
    const value = money(o.total_price);
    orders += 1;
    quantity += money(o.total_quantity);
    amount += value;

    const code = String(o.status ?? "unknown");
    const bucket = (byStatus[code] ||= { orders: 0, amount: 0 });
    bucket.orders += 1;
    bucket.amount += value;

    if (Number(o.status) === CANCELLED) {
      cancelledOrders += 1;
      cancelledAmount += value;
    }
  }

  // Same phone and same total on the same day. Strict on purpose: a customer who
  // genuinely orders twice for different amounts is not a duplicate, and calling
  // one would hide a real sale.
  const seen = new Map<string, number>();
  let duplicateOrders = 0;
  let duplicateAmount = 0;
  for (const o of rows) {
    const phone = rowPhone(o);
    if (!phone) continue;
    const key = `${phone}|${Math.round(money(o.total_price) * 100)}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    // The first of a group is the order; everything after it is the extra.
    if (n > 1) {
      duplicateOrders += 1;
      duplicateAmount += money(o.total_price);
    }
  }

  return {
    day,
    orders,
    quantity,
    amount,
    cancelledOrders,
    cancelledAmount,
    byStatus,
    duplicateOrders,
    duplicateAmount,
  };
}

/** Fetches one day and writes it. Returns what was stored. */
export async function syncPosDay(account: PancakeAccount, day: string): Promise<PosDayTotals> {
  const totals = summarise(day, await fetchDay(account, day));

  const { error } = await supabaseAdmin.from("pos_daily_totals").upsert(
    {
      pancake_account_id: account.id,
      day,
      orders: totals.orders,
      quantity: totals.quantity,
      amount: totals.amount,
      cancelled_orders: totals.cancelledOrders,
      cancelled_amount: totals.cancelledAmount,
      by_status: totals.byStatus,
      duplicate_orders: totals.duplicateOrders,
      duplicate_amount: totals.duplicateAmount,
      synced_at: new Date().toISOString(),
    },
    { onConflict: "pancake_account_id,day" }
  );
  if (error) throw new Error(`Could not store POS totals for ${day}: ${error.message}`);

  return totals;
}

/** Today in Manila, as YYYY-MM-DD. */
export function todayManila(): string {
  return new Date(Date.now() + MANILA_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10);
}

/** Today and the days behind it.
 *
 *  Yesterday is refreshed too, and the days before it, because an order's status
 *  and its amount both keep moving after the day it was placed -- a cancellation
 *  on Thursday changes Tuesday's total. Older days settle, which is why this
 *  reaches back a few days rather than a month. */
export async function syncRecentDays(account: PancakeAccount, days = 3): Promise<PosDayTotals[]> {
  const out: PosDayTotals[] = [];
  const base = Date.now() + MANILA_OFFSET_HOURS * 3_600_000;
  for (let i = 0; i < days; i++) {
    const day = new Date(base - i * 86_400_000).toISOString().slice(0, 10);
    out.push(await syncPosDay(account, day));
  }
  return out;
}
