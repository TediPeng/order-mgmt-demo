import type { DbShape } from "./types";
import { uuid, nowIso } from "./db";
import { logActivity } from "./activity";
import { notify, agentEventRecipients } from "./notifications";
import { todayInTz } from "./utils";
import { isFullAccess } from "./permissions";
import { scheduledInstant, computeOvertimeHours } from "./attendance-logic";

/** The moment a forgotten shift is closed at: the last minute of its own day. */
const AUTO_TIME_OUT_AT = "23:59";

function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Closes any shift left open once its day is over, at 23:59 of that day.
 *
 * An agent who never pressed Time Out used to stay on the clock indefinitely,
 * and the app's answer was a dialog nagging them after their scheduled end.
 * That only worked if somebody was looking, so a shift forgotten on a Friday
 * evening stayed open all weekend. This closes it instead of asking.
 *
 * 23:59 of the shift's OWN day, never the moment the sweep happens to notice.
 * That keeps the record on the work date it belongs to, makes it identical
 * whether the sweep runs at one past midnight or on Monday morning, and marks
 * the hours as what they are: a shift of unknown end, closed at the last
 * minute it could have run to.
 *
 * Only days already past. Today's open shift belongs to whoever is still
 * working it.
 *
 * And only days this sweep has been alive for. auto_time_out_cursor starts
 * null, and the first run claims yesterday without closing anything: switching
 * this on must not reach back through months of history, rewrite hours nobody
 * measured, and tell everyone about it at once. Shifts left open before that
 * stay open, for Management to override with a time they actually know. Same
 * reasoning, and the same cursor, as the auto-absent sweep above.
 *
 * Returns true if `db` was mutated (caller should writeDb).
 */
export function sweepAutoTimeOuts(db: DbShape): boolean {
  const today = todayInTz();
  const yesterday = addDaysToYmd(today, -1);

  if (db.auto_time_out_cursor === null) {
    db.auto_time_out_cursor = yesterday;
    return true;
  }
  if (db.auto_time_out_cursor >= yesterday) return false;

  const from = addDaysToYmd(db.auto_time_out_cursor, 1);

  for (const record of db.attendance) {
    if (record.work_date < from || record.work_date >= today) continue;
    if (!record.time_in || record.time_out) continue;

    const closeAt = scheduledInstant(record.work_date, AUTO_TIME_OUT_AT, db.work_schedule.timezone);
    const timeIn = new Date(record.time_in);
    // A time-in later than its own 23:59 should not exist, but a bad override
    // could make one, and a negative shift length is worse than an open one.
    if (closeAt.getTime() < timeIn.getTime()) continue;

    const scheduledOut = (record.scheduled_time_out || db.work_schedule.work_end).slice(0, 5);
    record.time_out = closeAt.toISOString();
    record.total_hours = Math.round(((closeAt.getTime() - timeIn.getTime()) / 3600000) * 100) / 100;
    record.overtime_hours = computeOvertimeHours(
      record.time_out,
      record.work_date,
      scheduledOut,
      db.work_schedule.timezone
    );
    record.status = "timed_out";
    // Said in the record itself, because these hours are not evidence of work
    // done until 23:59 and payroll must not read them as though they were.
    const note = `Automatically timed out at ${AUTO_TIME_OUT_AT} — no time-out recorded.`;
    record.remarks = record.remarks ? `${record.remarks} · ${note}` : note;
    record.updated_at = nowIso();


    logActivity(db, null, "ATTENDANCE_AUTO_TIME_OUT", "attendance", record.id, {
      user_id: record.user_id,
      work_date: record.work_date,
      total_hours: record.total_hours,
    }, { module: "attendance" });

    const profile = db.profiles.find((p) => p.id === record.user_id);
    notify(
      db,
      agentEventRecipients(db, record.user_id),
      "auto_time_out",
      "Automatically Timed Out",
      `${profile?.full_name || "An agent"} did not time out on ${record.work_date} and was automatically timed out at ${AUTO_TIME_OUT_AT}. The hours recorded run to that time — ask Management for an override if the real time out was different.`,
      "/attendance"
    );
  }

  db.auto_time_out_cursor = yesterday;
  return true;
}

/**
 * When Settings > "Auto-mark absent" is on, marks active agents Absent for
 * any past work day (before today) they never timed in for and have no
 * attendance record covering (e.g. an approved-leave row already created by
 * reviewLeaveAction). There's no cron in this app, so this runs lazily from
 * the authenticated layout on each request; attendance_sweep_cursor tracks
 * the last date fully processed so each day is only swept once and a
 * newly-enabled sweep doesn't retroactively backfill history it never saw.
 * Returns true if `db` was mutated (caller should writeDb).
 */
export function sweepAutoAbsences(db: DbShape): boolean {
  if (!db.work_schedule.auto_mark_absent) return false;

  const today = todayInTz();
  const cursor = db.attendance_sweep_cursor;
  const start = cursor ? addDaysToYmd(cursor, 1) : today;

  if (start >= today) {
    if (cursor !== addDaysToYmd(today, -1)) {
      db.attendance_sweep_cursor = addDaysToYmd(today, -1);
      return true;
    }
    return false;
  }

  const scheduledAgents = db.profiles.filter((p) => p.is_active && !isFullAccess(p.role));

  for (let d = start; d < today; d = addDaysToYmd(d, 1)) {
    for (const profile of scheduledAgents) {
      if (db.attendance.some((a) => a.user_id === profile.id && a.work_date === d)) continue;

      const record = {
        id: uuid(),
        user_id: profile.id,
        work_date: d,
        time_in: null,
        time_out: null,
        total_hours: null,
        overridden: false,
        override_reason: null,
        overridden_by: null,
        break_start: null,
        break_end: null,
        break_minutes: null,
        scheduled_time_in: db.work_schedule.work_start,
        scheduled_time_out: db.work_schedule.work_end,
        minutes_late: 0,
        over_break_minutes: 0,
        overtime_hours: 0,
        status: "absent" as const,
        remarks: "Automatically marked absent — no time-in recorded.",
        attachment_path: null,
        created_by: null,
        updated_by: null,
        updated_at: nowIso(),
      };
      db.attendance.push(record);
      logActivity(db, null, "ATTENDANCE_AUTO_ABSENT", "attendance", record.id, { user_id: profile.id, work_date: d }, {
        module: "attendance",
      });
      notify(
        db,
        agentEventRecipients(db, profile.id),
        "auto_absent",
        "Marked Absent",
        `${profile.full_name} was automatically marked absent for ${d} (no time-in recorded).`,
        "/attendance"
      );
    }
  }

  db.attendance_sweep_cursor = addDaysToYmd(today, -1);
  return true;
}
