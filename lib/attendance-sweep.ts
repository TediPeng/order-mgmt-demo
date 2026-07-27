import type { DbShape } from "./types";
import { uuid, nowIso } from "./db";
import { logActivity } from "./activity";
import { notify, agentEventRecipients } from "./notifications";
import { todayInTz } from "./utils";
import { isFullAccess } from "./permissions";

function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
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
