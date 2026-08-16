import type { DbShape } from "@/lib/types";


/**
 * How many people may be off on one day, floor-wide.
 *
 * This is a real cap, not a guide: a Team Lead cannot approve past it, and the
 * second approval on a day closes that day for everybody else. It is floor-wide
 * because coverage is, which means one team's approval can close a date on
 * another team's agent.
 */
export const MAX_APPROVED_PER_DAY = 2;

export interface LeaveDayCount {
  /** YYYY-MM-DD */
  date: string;
  approved: number;
  /** Still awaiting a decision, and counted separately: they may yet be
   * approved ahead of the request being filed now. */
  pending: number;
}

/**
 * How many agents are already off on each day of a window.
 *
 * For the agent filing a request: the question they actually ask before picking
 * a date is whether anybody else is already off then, and until now the only way
 * to find out was to ask a Team Lead. Counts only — who is off is their
 * colleagues' business, and the number is what the decision needs.
 *
 * Floor-wide rather than per team, because MAX_APPROVED_PER_DAY is floor-wide.
 * The approved figure is the one measured against that cap; pending is shown
 * beside it because those requests may be approved before yours and take the
 * last place, but they hold nothing on their own.
 *
 * A request spanning several days counts on every day it covers, which is why
 * this expands the range rather than counting rows.
 */
export function leaveCountsByDate(db: DbShape, from: string, to: string): LeaveDayCount[] {
  const byDate = new Map<string, LeaveDayCount>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    byDate.set(d, { date: d, approved: 0, pending: 0 });
  }

  for (const request of db.leave_requests) {
    if (request.status !== "approved" && request.status !== "pending") continue;
    // Clamp to the window, so a month-long leave costs one day of iteration per
    // day actually being shown.
    let day = request.leave_start > from ? request.leave_start : from;
    const last = request.leave_end < to ? request.leave_end : to;
    for (; day <= last; day = addDays(day, 1)) {
      const row = byDate.get(day);
      if (!row) continue;
      if (request.status === "approved") row.approved += 1;
      else row.pending += 1;
    }
  }

  return Array.from(byDate.values());
}

/** Weeks the date picker draws, and therefore the window that needs counting.
 *
 * Whole weeks starting on the Sunday of this week: a calendar has to begin on a
 * Sunday or the columns stop meaning anything, and the few already-past days
 * that pulls in keep the grid aligned for the price of one row. Five weeks is
 * the trade -- well past the three days' notice and far enough to plan around,
 * while leaving the popup short enough that the Submit button stays in view.
 */
export function leavePickerWindow(today: string): { from: string; to: string } {
  const sunday = new Date(`${today}T00:00:00Z`);
  sunday.setUTCDate(sunday.getUTCDate() - sunday.getUTCDay());
  const from = sunday.toISOString().slice(0, 10);
  return { from, to: addDays(from, 34) };
}

/**
 * The dates already at the cap, counting approved leave only.
 *
 * Unwindowed: the cap has to be checked against whatever dates a request
 * actually covers, which is not the same span the picker happens to draw.
 * `ignoreRequestId` leaves one request out, so a request can be measured
 * against the day without counting itself.
 */
export function fullDates(db: DbShape, ignoreRequestId?: string): Set<string> {
  const approved = new Map<string, number>();
  for (const request of db.leave_requests) {
    if (request.status !== "approved") continue;
    if (ignoreRequestId && request.id === ignoreRequestId) continue;
    for (let day = request.leave_start; day <= request.leave_end; day = addDays(day, 1)) {
      approved.set(day, (approved.get(day) || 0) + 1);
    }
  }

  const full = new Set<string>();
  for (const [date, count] of approved) {
    if (count >= MAX_APPROVED_PER_DAY) full.add(date);
  }
  return full;
}

/** One day on, in UTC so the arithmetic never lands on a daylight-saving edge. */
function addDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
