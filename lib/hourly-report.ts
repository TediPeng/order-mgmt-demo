import { agentHourlyCallStats, agentDaySalesWithCalls } from "@/lib/performance-query";
import { displayUserName } from "@/lib/types";
import type { Profile } from "@/lib/types";

/**
 * The hourly report, shared by the page and the CSV export.
 *
 * The hour comes from when the number was dialled -- pbx_calls.started_at --
 * because that is the only timestamp in the system that records the moment work
 * actually happened. The order row cannot supply it: order_date is a date the
 * agent types and can backdate, and created_at is when the form was saved.
 *
 * Sales sit beside the hours rather than inside them. Tying a sale to an hour
 * would mean matching it to a call by phone number, and only about a third to a
 * half of sales match one -- so `ordersWithCall` is reported as its own figure
 * instead of quietly moving sales into hours they may not belong to, or dropping
 * the ones that match nothing.
 *
 * Both surfaces build rows here so a change to the window or to what a cell
 * counts cannot land in one and miss the other.
 */

/** 8am through the 11pm bucket, which runs to 11:59pm. */
export const FIRST_HOUR = 8;
export const LAST_HOUR = 23;
export const HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => FIRST_HOUR + i);

export function hourLabel(h: number): string {
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${h < 12 ? "am" : "pm"}`;
}

export interface HourlyRow {
  id: string;
  name: string;
  /** Dials per hour, aligned to HOURS. */
  cells: number[];
  /** Dials before FIRST_HOUR, so the row total reconciles. */
  early: number;
  calls: number;
  answered: number;
  orders: number;
  ordersWithCall: number;
  amount: number;
}

export interface HourlyReport {
  day: string;
  rows: HourlyRow[];
  colTotals: number[];
  earlyTotal: number;
  totalCalls: number;
  totalAnswered: number;
  totalOrders: number;
  totalAmount: number;
}

export async function buildHourlyReport(agents: Profile[], day: string): Promise<HourlyReport> {
  const ids = agents.map((a) => a.id);
  const [calls, sales] = await Promise.all([
    agentHourlyCallStats(ids, day),
    agentDaySalesWithCalls(ids, day),
  ]);

  const rows: HourlyRow[] = agents
    .map((a) => {
      const cells = HOURS.map((h) => calls.get(`${a.id}|${h}`)?.calls ?? 0);
      let early = 0;
      let total = 0;
      let answered = 0;
      for (let h = 0; h <= 23; h++) {
        const c = calls.get(`${a.id}|${h}`);
        if (!c) continue;
        total += c.calls;
        answered += c.answered;
        if (h < FIRST_HOUR) early += c.calls;
      }
      const s = sales.get(a.id);
      return {
        id: a.id,
        name: displayUserName(a),
        cells,
        early,
        calls: total,
        answered,
        orders: s?.orders ?? 0,
        ordersWithCall: s?.ordersWithCall ?? 0,
        amount: s?.amount ?? 0,
      };
    })
    // Most dials first. This report is read to see who is working the phone,
    // and the sales columns sit right beside it to say what came of it.
    .sort((x, y) => y.calls - x.calls || y.amount - x.amount || x.name.localeCompare(y.name));

  return {
    day,
    rows,
    colTotals: HOURS.map((_, i) => rows.reduce((n, r) => n + r.cells[i], 0)),
    earlyTotal: rows.reduce((n, r) => n + r.early, 0),
    totalCalls: rows.reduce((n, r) => n + r.calls, 0),
    totalAnswered: rows.reduce((n, r) => n + r.answered, 0),
    totalOrders: rows.reduce((n, r) => n + r.orders, 0),
    totalAmount: rows.reduce((n, r) => n + r.amount, 0),
  };
}

/** Accepts only YYYY-MM-DD; anything else would reach Postgres and come back a 500. */
export function safeDay(input: string | undefined, fallback: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(input || "") ? input! : fallback;
}
