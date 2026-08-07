"use server";

import { redirect } from "next/navigation";
import { writeDb, uuid, nowIso, queueDelete } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { notify } from "@/lib/notifications";
import { requireUser, requirePermission } from "./guards";
import { isFullAccess } from "@/lib/permissions";
import { eachDateInclusive, computeSuspensionEndDate } from "@/lib/schedule-access";
import { todayInTz } from "@/lib/utils";
import type { Schedule, Suspension } from "@/lib/types";

const VALID_DURATIONS = new Set([3, 7, 15]);

export async function issueSuspensionAction(formData: FormData) {
  const { user, db } = await requireUser();
  requirePermission(user, "disciplinary", "manage", db, "/schedule/suspensions");

  const employeeId = String(formData.get("employee_id") || "");
  const startDate = String(formData.get("start_date") || "");
  const durationDays = Number(formData.get("duration_days"));
  const reason = String(formData.get("reason") || "").trim();
  const remarks = String(formData.get("remarks") || "").trim();

  const employee = db.profiles.find((p) => p.id === employeeId);
  if (!employee) redirect(`/schedule/suspensions?error=${encodeURIComponent("Select a valid employee.")}`);
  if (!startDate) redirect(`/schedule/suspensions?error=${encodeURIComponent("Start date is required.")}`);
  if (!VALID_DURATIONS.has(durationDays)) {
    redirect(`/schedule/suspensions?error=${encodeURIComponent("Duration must be 3, 7, or 15 days.")}`);
  }
  if (!reason) redirect(`/schedule/suspensions?error=${encodeURIComponent("Reason for suspension is required.")}`);

  const endDate = computeSuspensionEndDate(startDate, durationDays);
  const now = nowIso();

  const suspension: Suspension = {
    id: uuid(),
    employee_id: employeeId,
    start_date: startDate,
    duration_days: durationDays as 3 | 7 | 15,
    end_date: endDate,
    reason,
    issued_by: user.id,
    date_issued: todayInTz(),
    remarks: remarks || null,
    status: "active",
    lifted_reason: null,
    lifted_by: null,
    lifted_at: null,
    created_at: now,
  };
  db.suspensions.push(suspension);

  const info = await getRequestInfo();
  const replaced: Schedule[] = [];

  for (const date of eachDateInclusive(startDate, endDate)) {
    const existingIdx = db.schedules.findIndex((s) => s.agent_id === employeeId && s.schedule_date === date);
    if (existingIdx !== -1) {
      replaced.push({ ...db.schedules[existingIdx] });
      queueDelete(db, "schedules", db.schedules[existingIdx].id);
      db.schedules.splice(existingIdx, 1);
    }
    db.schedules.push({
      id: uuid(),
      agent_id: employeeId,
      schedule_date: date,
      duty_start: null,
      duty_end: null,
      is_rest_day: false,
      status: "suspension",
      remarks: reason,
      suspension_id: suspension.id,
      recurrence_group: null,
      created_by: user.id,
      updated_by: null,
      created_at: now,
      updated_at: null,
    });

    // Attendance for suspension days is auto-marked (Section 0.2); leaves any
    // already-recorded time-in/out alone, only setting the status flag.
    const existingAttendance = db.attendance.find((a) => a.user_id === employeeId && a.work_date === date);
    if (existingAttendance) {
      existingAttendance.status = "suspended";
      existingAttendance.updated_by = user.id;
      existingAttendance.updated_at = now;
    } else {
      db.attendance.push({
        id: uuid(),
        user_id: employeeId,
        work_date: date,
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
        status: "suspended",
        remarks: `Suspended: ${reason}`,
        attachment_path: null,
        created_by: user.id,
        updated_by: null,
        updated_at: now,
      });
    }
  }

  logActivity(
    db,
    user.id,
    "SUSPENSION_ISSUED",
    "suspension",
    suspension.id,
    { employee_id: employeeId, start_date: startDate, end_date: endDate, duration_days: durationDays },
    { module: "disciplinary", updated_value: suspension, ...info }
  );
  for (const r of replaced) {
    logActivity(db, user.id, "SCHEDULE_REPLACED_BY_SUSPENSION", "schedule", r.id, { agent_id: employeeId, schedule_date: r.schedule_date }, {
      module: "schedules",
      previous_value: r,
      ...info,
    });
  }

  notify(
    db,
    [employeeId],
    "suspension_issued",
    "Suspension Issued",
    `You have been suspended from ${startDate} to ${endDate}. Reason: ${reason}`,
    "/schedule/suspensions"
  );
  if (replaced.length > 0) {
    const managementIds = db.profiles.filter((p) => isFullAccess(p.role) && p.is_active && p.id !== user.id).map((p) => p.id);
    notify(
      db,
      managementIds,
      "schedule_replaced",
      "Schedules Replaced by Suspension",
      `${replaced.length} existing schedule(s) were replaced by the suspension for ${employee!.full_name}.`,
      "/schedule/suspensions"
    );
  }

  await writeDb(db);
  redirect(`/schedule/suspensions?issued=1${replaced.length > 0 ? `&replaced=${replaced.length}` : ""}`);
}

export async function liftSuspensionAction(formData: FormData) {
  const { user, db } = await requireUser();
  requirePermission(user, "disciplinary", "manage", db, "/schedule/suspensions");

  const id = String(formData.get("id") || "");
  const liftedReason = String(formData.get("lifted_reason") || "").trim();
  const suspension = db.suspensions.find((s) => s.id === id);
  if (!suspension) redirect("/schedule/suspensions");
  if (suspension!.status === "lifted") {
    redirect(`/schedule/suspensions?error=${encodeURIComponent("This suspension has already been lifted.")}`);
  }
  if (!liftedReason) {
    redirect(`/schedule/suspensions?error=${encodeURIComponent("A reason is required to lift a suspension.")}`);
  }

  const before = { ...suspension! };
  const today = todayInTz();
  suspension!.status = "lifted";
  suspension!.lifted_reason = liftedReason;
  suspension!.lifted_by = user.id;
  suspension!.lifted_at = nowIso();

  // Section 6.9: "removes remaining future suspension days, restores nothing
  // retroactively" -- past suspension days stay as historical fact.
  const droppedSchedules = db.schedules.filter((s) => s.suspension_id === id && s.schedule_date >= today);
  const droppedAttendance = db.attendance.filter(
    (a) => a.user_id === suspension!.employee_id && a.status === "suspended" && a.work_date >= today && a.work_date <= suspension!.end_date
  );
  for (const s of droppedSchedules) queueDelete(db, "schedules", s.id);
  for (const a of droppedAttendance) queueDelete(db, "attendance", a.id);

  db.schedules = db.schedules.filter((s) => !(s.suspension_id === id && s.schedule_date >= today));
  db.attendance = db.attendance.filter(
    (a) => !(a.user_id === suspension!.employee_id && a.status === "suspended" && a.work_date >= today && a.work_date <= suspension!.end_date)
  );

  const info = await getRequestInfo();
  logActivity(db, user.id, "SUSPENSION_LIFTED", "suspension", id, { reason: liftedReason }, {
    module: "disciplinary",
    previous_value: before,
    updated_value: suspension,
    ...info,
  });
  notify(
    db,
    [suspension!.employee_id],
    "suspension_lifted",
    "Suspension Lifted",
    `Your suspension has been lifted. Reason: ${liftedReason}`,
    "/schedule/suspensions"
  );

  await writeDb(db);
  redirect("/schedule/suspensions?lifted=1");
}
