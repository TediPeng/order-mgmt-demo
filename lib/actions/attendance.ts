"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { writeDb, uuid, nowIso } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { notify, agentEventRecipients } from "@/lib/notifications";
import { requireUserLite, requirePermission } from "./guards";
import { attendanceOverrideSchema } from "@/lib/validation";
import { computeMinutesBetween, computeMinutesLate, computeOvertimeHours, scheduledInstant } from "@/lib/attendance-logic";
import { activeSuspensionOn } from "@/lib/schedule-access";
import { todayInTz } from "@/lib/utils";

function safeRedirectTarget(raw: FormDataEntryValue | null): string {
  const value = String(raw || "");
  return value.startsWith("/") ? value : "/attendance/clock";
}

export async function timeInAction(formData: FormData) {
  const { user, db } = await requireUserLite();
  const today = todayInTz();
  const target = safeRedirectTarget(formData.get("redirect_to"));

  // Section 0.2: checked first -- a suspension always pre-creates a
  // status='suspended' attendance row for the day (time_in still null), which
  // would otherwise trip the generic "already timed in" check below and show
  // the wrong message.
  if (activeSuspensionOn(db, user.id, today, today)) {
    redirect(
      `${target}?error=${encodeURIComponent("You are suspended on this date and cannot time in. Please contact Management.")}`
    );
  }

  const existing = db.attendance.find((a) => a.user_id === user.id && a.work_date === today);
  if (existing) {
    redirect(`${target}?error=${encodeURIComponent("You have already timed in today. Ask Management for an override if this is a mistake.")}`);
  }

  const now = nowIso();
  // Section 0.2: late detection uses the day's duty schedule when one exists,
  // falling back to the global setting for unscheduled days.
  const todaysSchedule = db.schedules.find((s) => s.agent_id === user.id && s.schedule_date === today);
  const scheduledIn = todaysSchedule?.duty_start || db.work_schedule.work_start;
  const minutesLate = computeMinutesLate(now, today, scheduledIn, db.work_schedule.timezone);
  const status = minutesLate > 0 ? "late" : "on_time";

  const record = {
    id: uuid(),
    user_id: user.id,
    work_date: today,
    time_in: now,
    time_out: null,
    total_hours: null,
    overridden: false,
    override_reason: null,
    overridden_by: null,
    break_start: null,
    break_end: null,
    break_minutes: null,
    scheduled_time_in: scheduledIn,
    scheduled_time_out: todaysSchedule?.duty_end || db.work_schedule.work_end,
    minutes_late: minutesLate,
    over_break_minutes: 0,
    overtime_hours: 0,
    status: status as "late" | "on_time",
    remarks: null,
    attachment_path: null,
    created_by: null,
    updated_by: null,
    updated_at: now,
  };
  db.attendance.push(record);
  const info = await getRequestInfo();
  logActivity(db, user.id, "TIME_IN", "attendance", record.id, { work_date: today, minutes_late: minutesLate }, { module: "attendance", ...info });

  if (minutesLate > 0) {
    logActivity(db, user.id, "LATE_FLAGGED", "attendance", record.id, { minutes_late: minutesLate }, { module: "attendance", ...info });
    notify(
      db,
      agentEventRecipients(db, user.id),
      "late_time_in",
      "Late Time-In",
      `${user.full_name} timed in ${minutesLate} minute(s) late.`,
      "/attendance/clock"
    );
  }

  await writeDb(db);
  redirect(`${target}?timedin=1`);
}

export async function timeOutAction(formData: FormData) {
  const { user, db } = await requireUserLite();
  const today = todayInTz();
  const target = safeRedirectTarget(formData.get("redirect_to"));

  const record = db.attendance.find((a) => a.user_id === user.id && a.work_date === today);
  if (!record) {
    redirect(`${target}?error=${encodeURIComponent("You have not timed in today.")}`);
  }
  if (record!.time_out) {
    redirect(`${target}?error=${encodeURIComponent("You have already timed out today. Ask Management for an override if this is a mistake.")}`);
  }
  if (record!.break_start && !record!.break_end) {
    redirect(`${target}?error=${encodeURIComponent("Please end your break before timing out.")}`);
  }

  const timeOut = new Date();
  const timeIn = new Date(record!.time_in!);
  if (timeOut.getTime() < timeIn.getTime()) {
    redirect(`${target}?error=${encodeURIComponent("Time out cannot be earlier than time in.")}`);
  }

  record!.time_out = timeOut.toISOString();
  record!.total_hours = Math.round(((timeOut.getTime() - timeIn.getTime()) / 3600000) * 100) / 100;
  record!.overtime_hours = computeOvertimeHours(
    record!.time_out,
    today,
    record!.scheduled_time_out,
    db.work_schedule.timezone
  );
  record!.status = "timed_out";
  record!.updated_at = nowIso();
  const info = await getRequestInfo();
  logActivity(
    db,
    user.id,
    "TIME_OUT",
    "attendance",
    record!.id,
    { work_date: today, total_hours: record!.total_hours },
    { module: "attendance", ...info }
  );
  await writeDb(db);
  redirect(`${target}?timedout=1`);
}

export async function startBreakAction(formData: FormData) {
  const { user, db } = await requireUserLite();
  const today = todayInTz();
  const target = safeRedirectTarget(formData.get("redirect_to"));

  const record = db.attendance.find((a) => a.user_id === user.id && a.work_date === today);
  if (!record || !record.time_in) {
    redirect(`${target}?error=${encodeURIComponent("You must time in before starting a break.")}`);
  }
  if (record!.time_out) {
    redirect(`${target}?error=${encodeURIComponent("You cannot start a break after timing out.")}`);
  }
  if (record!.break_start && !record!.break_end) {
    redirect(`${target}?error=${encodeURIComponent("A break is already in progress.")}`);
  }
  if (record!.break_start && record!.break_end) {
    redirect(`${target}?error=${encodeURIComponent("You have already used your break for today.")}`);
  }

  record!.break_start = nowIso();
  record!.break_end = null;
  const info = await getRequestInfo();
  logActivity(db, user.id, "BREAK_START", "attendance", record!.id, { work_date: today }, { module: "attendance", ...info });
  await writeDb(db);
  redirect(`${target}?breakstarted=1`);
}

export async function endBreakAction(formData: FormData) {
  const { user, db } = await requireUserLite();
  const today = todayInTz();
  const target = safeRedirectTarget(formData.get("redirect_to"));

  const record = db.attendance.find((a) => a.user_id === user.id && a.work_date === today);
  if (!record || !record.break_start) {
    redirect(`${target}?error=${encodeURIComponent("You have not started a break.")}`);
  }
  if (record!.break_end) {
    redirect(`${target}?error=${encodeURIComponent("Your break has already ended.")}`);
  }

  const breakEnd = nowIso();
  const breakMinutes = computeMinutesBetween(record!.break_start!, breakEnd);
  record!.break_end = breakEnd;
  record!.break_minutes = breakMinutes;

  const allowance = db.work_schedule.break_minutes;
  const info = await getRequestInfo();
  if (breakMinutes > allowance) {
    const over = breakMinutes - allowance;
    record!.over_break_minutes = over;
    record!.status = "over_break";
    logActivity(db, user.id, "OVER_BREAK_FLAGGED", "attendance", record!.id, { over_break_minutes: over, break_minutes: breakMinutes }, {
      module: "attendance",
      ...info,
    });
    notify(db, [user.id], "break_ended", "Break Ended", `Your ${allowance}-minute break has ended.`, "/attendance/clock");
    notify(
      db,
      agentEventRecipients(db, user.id),
      "over_break",
      "Over Break",
      `${user.full_name} exceeded break by ${over} minute(s).`,
      "/attendance/clock"
    );
  } else {
    record!.status = record!.minutes_late > 0 ? "late" : "on_time";
  }

  logActivity(db, user.id, "BREAK_END", "attendance", record!.id, { work_date: today, break_minutes: breakMinutes }, {
    module: "attendance",
    ...info,
  });
  await writeDb(db);
  redirect(`${target}?breakended=1`);
}

/** Re-checks a currently-open break against the allowance; called periodically
 * from the clock page while the agent is on break, since there's no push
 * infrastructure to flag the exact 60th minute in real time. */
export async function checkOverBreakAction() {
  const { user, db } = await requireUserLite();
  const today = todayInTz();
  const record = db.attendance.find((a) => a.user_id === user.id && a.work_date === today);

  if (record && record.break_start && !record.break_end && record.status !== "over_break") {
    const elapsed = computeMinutesBetween(record.break_start, nowIso());
    const allowance = db.work_schedule.break_minutes;
    if (elapsed > allowance) {
      const over = elapsed - allowance;
      record.over_break_minutes = over;
      record.status = "over_break";
      const info = await getRequestInfo();
      logActivity(db, user.id, "OVER_BREAK_FLAGGED", "attendance", record.id, { over_break_minutes: over }, {
        module: "attendance",
        ...info,
      });
      notify(db, [user.id], "break_ended", "Break Ended", `Your ${allowance}-minute break has ended.`, "/attendance/clock");
      notify(
        db,
        agentEventRecipients(db, user.id),
        "over_break",
        "Over Break",
        `${user.full_name} exceeded break by ${over} minute(s).`,
        "/attendance/clock"
      );
      await writeDb(db);
    }
  }
  revalidatePath("/attendance/clock");
}

export async function overrideAttendanceAction(formData: FormData) {
  const { user, db } = await requireUserLite();
  requirePermission(user, "attendance", "approve", db, "/attendance/clock");

  const parsed = attendanceOverrideSchema.safeParse({
    user_id: formData.get("user_id"),
    work_date: formData.get("work_date"),
    time_in: formData.get("time_in"),
    time_out: formData.get("time_out"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    redirect(`/attendance/clock?error=${encodeURIComponent(parsed.error.issues[0]?.message || "Invalid override input.")}`);
  }
  const data = parsed.data;

  // Read in the company's timezone, not the server's.
  //
  // This was `new Date("2026-08-15T07:34")`, which has no zone in it and so is
  // parsed as the server's local time. The server is UTC, so an Administrator
  // typing 07:34 — meaning 7:34 in the morning, which is what the card beside
  // the form displays — had 3:34 PM stored against the record. Eight hours out,
  // silently, on the one screen whose whole purpose is correcting attendance.
  //
  // scheduledInstant is the same helper time-in lateness and overtime already
  // use, so an overridden record is now measured the same way an ordinary one is.
  const timeInIso = scheduledInstant(data.work_date, data.time_in, db.work_schedule.timezone).toISOString();
  const timeOutIso = data.time_out
    ? scheduledInstant(data.work_date, data.time_out, db.work_schedule.timezone).toISOString()
    : null;
  const totalHours = timeOutIso
    ? Math.round(((new Date(timeOutIso).getTime() - new Date(timeInIso).getTime()) / 3600000) * 100) / 100
    : null;

  let record = db.attendance.find((a) => a.user_id === data.user_id && a.work_date === data.work_date);
  const before = record ? { ...record } : null;
  const minutesLate = computeMinutesLate(timeInIso, data.work_date, db.work_schedule.work_start, db.work_schedule.timezone);
  const scheduledTimeOut = record?.scheduled_time_out || db.work_schedule.work_end;
  const overtimeHours = timeOutIso ? computeOvertimeHours(timeOutIso, data.work_date, scheduledTimeOut, db.work_schedule.timezone) : 0;

  if (!record) {
    record = {
      id: uuid(),
      user_id: data.user_id,
      work_date: data.work_date,
      time_in: timeInIso,
      time_out: timeOutIso,
      total_hours: totalHours,
      overridden: true,
      override_reason: data.reason,
      overridden_by: user.id,
      break_start: null,
      break_end: null,
      break_minutes: null,
      scheduled_time_in: db.work_schedule.work_start,
      scheduled_time_out: db.work_schedule.work_end,
      minutes_late: minutesLate,
      over_break_minutes: 0,
      overtime_hours: overtimeHours,
      status: timeOutIso ? "timed_out" : minutesLate > 0 ? "late" : "on_time",
      remarks: data.reason,
      attachment_path: null,
      created_by: user.id,
      updated_by: user.id,
      updated_at: nowIso(),
    };
    db.attendance.push(record);
  } else {
    record.time_in = timeInIso;
    record.time_out = timeOutIso;
    record.total_hours = totalHours;
    record.overridden = true;
    record.override_reason = data.reason;
    record.overridden_by = user.id;
    record.minutes_late = minutesLate;
    record.overtime_hours = overtimeHours;
    record.status = timeOutIso ? "timed_out" : minutesLate > 0 ? "late" : "on_time";
    record.updated_by = user.id;
    record.updated_at = nowIso();
  }

  const info = await getRequestInfo();
  logActivity(
    db,
    user.id,
    "ATTENDANCE_OVERRIDDEN",
    "attendance",
    record.id,
    { target_user_id: data.user_id, work_date: data.work_date, reason: data.reason },
    { module: "attendance", previous_value: before, updated_value: record, ...info }
  );
  await writeDb(db);
  redirect(`/attendance/clock?overridden=1`);
}

