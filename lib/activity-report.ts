import type { DbShape } from "./types";
import type { CallDayTotals } from "./call-sessions";
import type { BioBreakDayTotals } from "./bio-breaks";

/** The Agent Monitor's figures, over a date range instead of right now.
 *
 * The monitor answers "what is happening"; this answers "what happened". They
 * share one definition of a shift deliberately: `attendance.total_hours` is
 * gross elapsed time (time_out minus time_in, see lib/actions/attendance.ts),
 * which is exactly what the monitor measures its own live shift against. If
 * the two used different bases, standby would disagree between two screens
 * showing the same day and neither figure would be trusted again.
 *
 * Only closed shifts count. A shift still running has no total_hours yet, and
 * counting elapsed-so-far would make the report change every time it was
 * refreshed -- a report should give the same answer twice. Those shifts are
 * counted separately so a light-looking Today explains itself rather than
 * looking like missing data.
 */

export interface ActivityRow {
  agent_id: string;
  name: string;
  /** Days with a closed shift in range. */
  days: number;
  /** Shifts started but not yet ended — excluded from every total below. */
  openShifts: number;
  shiftSeconds: number;
  talkSeconds: number;
  calls: number;
  bioSeconds: number;
  bioCount: number;
  breakSeconds: number;
  /** Shift time that was not a call and not a break. Never negative: the
   * parts are recorded independently, and a manual attendance override can
   * leave them summing past the shift. */
  standbySeconds: number;
  /** Talk time as a share of shift time. Null when nothing was worked, rather
   * than 0% — no shift is not the same as an idle one. */
  utilisation: number | null;
  lateMinutes: number;
  /** Minutes taken beyond the allowed break, already computed per day by the
   * attendance rules — summed here rather than re-derived, so the report and
   * the attendance record can never disagree about it. */
  overBreakMinutes: number;
  overtimeHours: number;
}

export function computeActivityReport(
  db: DbShape,
  agents: { id: string; name: string }[],
  from: string,
  to: string,
  callTotals: Map<string, CallDayTotals>,
  bioTotals: Map<string, BioBreakDayTotals>
): ActivityRow[] {
  const agentIds = new Set(agents.map((a) => a.id));

  const shift = new Map<
    string,
    { days: number; open: number; seconds: number; late: number; overBreak: number; ot: number; breakSec: number }
  >();
  for (const a of db.attendance) {
    if (!agentIds.has(a.user_id)) continue;
    if (a.work_date < from || a.work_date > to) continue;

    const acc = shift.get(a.user_id) || { days: 0, open: 0, seconds: 0, late: 0, overBreak: 0, ot: 0, breakSec: 0 };
    if (a.time_in && !a.time_out) {
      acc.open += 1;
    } else if (a.total_hours !== null) {
      acc.days += 1;
      acc.seconds += a.total_hours * 3600;
      acc.breakSec += (a.break_minutes ?? 0) * 60;
    }
    // Late, over-break and overtime are recorded per row regardless of whether
    // the shift has closed, so they are not gated on total_hours.
    acc.late += a.minutes_late || 0;
    acc.overBreak += a.over_break_minutes || 0;
    acc.ot += a.overtime_hours || 0;
    shift.set(a.user_id, acc);
  }

  return agents.map((agent) => {
    const s = shift.get(agent.id) || { days: 0, open: 0, seconds: 0, late: 0, overBreak: 0, ot: 0, breakSec: 0 };
    const call = callTotals.get(agent.id) || { count: 0, seconds: 0 };
    const bio = bioTotals.get(agent.id) || { count: 0, seconds: 0 };

    const standby = Math.max(0, s.seconds - call.seconds - bio.seconds - s.breakSec);

    return {
      agent_id: agent.id,
      name: agent.name,
      days: s.days,
      openShifts: s.open,
      shiftSeconds: Math.round(s.seconds),
      talkSeconds: Math.round(call.seconds),
      calls: call.count,
      bioSeconds: Math.round(bio.seconds),
      bioCount: bio.count,
      breakSeconds: Math.round(s.breakSec),
      standbySeconds: Math.round(standby),
      utilisation: s.seconds > 0 ? Math.round((call.seconds / s.seconds) * 10000) / 100 : null,
      lateMinutes: s.late,
      overBreakMinutes: s.overBreak,
      overtimeHours: Math.round(s.ot * 100) / 100,
    };
  });
}

export interface ActivityTotals {
  days: number;
  openShifts: number;
  shiftSeconds: number;
  talkSeconds: number;
  calls: number;
  bioSeconds: number;
  breakSeconds: number;
  standbySeconds: number;
  utilisation: number | null;
}

/** Totals for the widget row. Utilisation is recomputed from the summed
 * seconds rather than averaged across agents — the mean of per-agent
 * utilisations is not the team's utilisation. */
export function totalActivity(rows: ActivityRow[]): ActivityTotals {
  const sum = (pick: (r: ActivityRow) => number) => rows.reduce((acc, r) => acc + pick(r), 0);
  const shiftSeconds = sum((r) => r.shiftSeconds);
  const talkSeconds = sum((r) => r.talkSeconds);

  return {
    days: sum((r) => r.days),
    openShifts: sum((r) => r.openShifts),
    shiftSeconds,
    talkSeconds,
    calls: sum((r) => r.calls),
    bioSeconds: sum((r) => r.bioSeconds),
    breakSeconds: sum((r) => r.breakSeconds),
    standbySeconds: sum((r) => r.standbySeconds),
    utilisation: shiftSeconds > 0 ? Math.round((talkSeconds / shiftSeconds) * 10000) / 100 : null,
  };
}

/** `7h 32m`, or `18m` under the hour. Hours-and-minutes rather than the
 * monitor's HH:MM:SS — seconds are meaningful watching a live call and noise
 * across a fortnight. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/**
 * One call's length, to the second.
 *
 * formatDuration rounds to the minute, which is right for a shift or a day's
 * talk time and wrong for a single call. The median call is 70 seconds and the
 * shortest on record is 2, so rounding turned 18% of a day's calls into "0m"
 * and another 47% into "1m" — two thirds of the column saying nothing. A
 * supervisor reading it cannot tell a number that rang out from a conversation,
 * which is most of what the column is for.
 */
export function formatCallLength(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(rem).padStart(2, "0")}s`;
  return `${m}m ${String(rem).padStart(2, "0")}s`;
}
