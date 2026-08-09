import type { DbShape, Profile } from "./types";
import { isFullAccess } from "./permissions";
import { todayInTz } from "./utils";

/** The exact wording shown wherever the time-in gate blocks an action. */
export const TIME_IN_REQUIRED_MESSAGE =
  "Please log in or time in first before starting a call or processing an order.";

/** Where the message's action button sends them. */
export const TIME_IN_HREF = "/attendance/clock";

/**
 * Agents must be timed in for the current workday before they can start a call,
 * process an order, change a status, or create a lead.
 *
 * Adding a Regular Customer is deliberately NOT gated: that records who a
 * repeat buyer is, which is not call-floor work being credited to a shift.
 *
 * "Timed in" means an attendance row exists for today carrying a `time_in`. A
 * later time-out does NOT revoke it: an agent who clocks out and still has
 * end-of-shift paperwork should be able to finish it, and the attendance record
 * already shows when they left. (Blocking post-time-out work is a one-line
 * change here if that turns out to be the wanted behaviour.)
 *
 * Administrators are exempt — they correct records rather than take calls, and
 * gating record-correction on a shift would lock them out of their own job.
 */
export function isTimedInToday(db: DbShape, userId: string): boolean {
  const today = todayInTz();
  return db.attendance.some((a) => a.user_id === userId && a.work_date === today && Boolean(a.time_in));
}

/** Non-null reason when the action must be refused. Callers turn this into a
 * 403 / inline error as well as disabling the control. */
export function timeInBlockReason(db: DbShape, user: Profile): string | null {
  if (isFullAccess(user.role)) return null;
  return isTimedInToday(db, user.id) ? null : TIME_IN_REQUIRED_MESSAGE;
}
