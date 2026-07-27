"use server";

import path from "path";
import { redirect } from "next/navigation";
import { writeDb, uuid, nowIso } from "@/lib/db";
import { uploadFile } from "@/lib/storage";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { requireUser, requirePermission } from "./guards";
import { attendanceManageSchema } from "@/lib/validation";
import { computeMinutesBetween, computeMinutesLate, computeOvertimeHours } from "@/lib/attendance-logic";
import { isFullAccess } from "@/lib/permissions";
import type { Attendance, AttendanceStatus } from "@/lib/types";

const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED_EXT = [".pdf", ".jpg", ".jpeg", ".png"];

function scopedEmployeeIds(role: string, userId: string, allProfiles: { id: string; team_lead_id: string | null }[]): string[] | null {
  if (isFullAccess(role)) return null; // no restriction
  return allProfiles.filter((p) => p.team_lead_id === userId || p.id === userId).map((p) => p.id);
}

export async function createOrUpdateAttendanceAction(formData: FormData) {
  const { user, db } = await requireUser();
  requirePermission(user, "attendance", formData.get("id") ? "edit" : "create", db, "/attendance/manage");

  const parsed = attendanceManageSchema.safeParse({
    id: formData.get("id"),
    user_id: formData.get("user_id"),
    work_date: formData.get("work_date"),
    scheduled_time_in: formData.get("scheduled_time_in"),
    scheduled_time_out: formData.get("scheduled_time_out"),
    time_in: formData.get("time_in"),
    time_out: formData.get("time_out"),
    break_start: formData.get("break_start"),
    break_end: formData.get("break_end"),
    status: formData.get("status"),
    remarks: formData.get("remarks"),
  });

  if (!parsed.success) {
    redirect(`/attendance/manage?error=${encodeURIComponent(parsed.error.issues[0]?.message || "Invalid input.")}`);
  }
  const data = parsed.data;

  // Scope: team leads may only manage their own team's employees.
  const allowedIds = scopedEmployeeIds(user.role, user.id, db.profiles);
  if (allowedIds && !allowedIds.includes(data.user_id)) {
    redirect(`/attendance/manage?error=${encodeURIComponent("You can only manage attendance for your own team.")}`);
  }

  const existingForDate = db.attendance.find((a) => a.user_id === data.user_id && a.work_date === data.work_date);
  if (!data.id && existingForDate) {
    redirect(
      `/attendance/manage?edit=${existingForDate.id}&error=${encodeURIComponent(
        "A record for this employee and date already exists — edit it instead."
      )}`
    );
  }
  if (data.id && existingForDate && existingForDate.id !== data.id) {
    redirect(
      `/attendance/manage?edit=${existingForDate.id}&error=${encodeURIComponent(
        "A different record for this employee and date already exists — edit that one instead."
      )}`
    );
  }

  const timeInIso = data.time_in ? new Date(`${data.work_date}T${data.time_in}`).toISOString() : null;
  const timeOutIso = data.time_out ? new Date(`${data.work_date}T${data.time_out}`).toISOString() : null;
  const breakStartIso = data.break_start ? new Date(`${data.work_date}T${data.break_start}`).toISOString() : null;
  const breakEndIso = data.break_end ? new Date(`${data.work_date}T${data.break_end}`).toISOString() : null;

  const totalHours =
    timeInIso && timeOutIso
      ? Math.round(((new Date(timeOutIso).getTime() - new Date(timeInIso).getTime()) / 3600000) * 100) / 100
      : null;
  const minutesLate = timeInIso
    ? computeMinutesLate(timeInIso, data.work_date, data.scheduled_time_in, db.work_schedule.timezone)
    : 0;
  const breakMinutes = breakStartIso && breakEndIso ? computeMinutesBetween(breakStartIso, breakEndIso) : null;
  const overBreakMinutes = breakMinutes !== null && breakMinutes > db.work_schedule.break_minutes ? breakMinutes - db.work_schedule.break_minutes : 0;
  const overtimeHours = timeOutIso
    ? computeOvertimeHours(timeOutIso, data.work_date, data.scheduled_time_out, db.work_schedule.timezone)
    : 0;

  // Optional supporting document
  let attachmentPath: string | null = existingForDate?.attachment_path ?? null;
  const file = formData.get("attachment") as File | null;
  if (file && file.size > 0) {
    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      redirect(`/attendance/manage?error=${encodeURIComponent("Attachment must be a PDF, JPG, or PNG file.")}`);
    }
    if (file.size > MAX_SIZE) {
      redirect(`/attendance/manage?error=${encodeURIComponent("Attachment must be 5 MB or smaller.")}`);
    }
    const storedName = `${uuid()}${ext}`;
    await uploadFile(`attendance/${storedName}`, Buffer.from(await file.arrayBuffer()));
    attachmentPath = storedName;
  }

  const info = await getRequestInfo();
  const record = db.attendance.find((a) => a.id === data.id);
  const before = record ? { ...record } : null;

  if (record) {
    record.time_in = timeInIso;
    record.time_out = timeOutIso;
    record.total_hours = totalHours;
    record.break_start = breakStartIso;
    record.break_end = breakEndIso;
    record.break_minutes = breakMinutes;
    record.scheduled_time_in = data.scheduled_time_in;
    record.scheduled_time_out = data.scheduled_time_out;
    record.minutes_late = minutesLate;
    record.over_break_minutes = overBreakMinutes;
    record.overtime_hours = overtimeHours;
    record.status = data.status as AttendanceStatus;
    record.remarks = data.remarks || null;
    record.attachment_path = attachmentPath;
    record.updated_by = user.id;
    record.updated_at = nowIso();

    logActivity(
      db,
      user.id,
      "ATTENDANCE_UPDATED",
      "attendance",
      record.id,
      { target_user_id: data.user_id, work_date: data.work_date },
      { module: "attendance", previous_value: before, updated_value: record, ...info }
    );
  } else {
    const newRecord: Attendance = {
      id: uuid(),
      user_id: data.user_id,
      work_date: data.work_date,
      time_in: timeInIso,
      time_out: timeOutIso,
      total_hours: totalHours,
      overridden: false,
      override_reason: null,
      overridden_by: null,
      break_start: breakStartIso,
      break_end: breakEndIso,
      break_minutes: breakMinutes,
      scheduled_time_in: data.scheduled_time_in,
      scheduled_time_out: data.scheduled_time_out,
      minutes_late: minutesLate,
      over_break_minutes: overBreakMinutes,
      overtime_hours: overtimeHours,
      status: data.status as AttendanceStatus,
      remarks: data.remarks || null,
      attachment_path: attachmentPath,
      created_by: user.id,
      updated_by: user.id,
      updated_at: nowIso(),
    };
    db.attendance.push(newRecord);

    logActivity(
      db,
      user.id,
      "ATTENDANCE_CREATED",
      "attendance",
      newRecord.id,
      { target_user_id: data.user_id, work_date: data.work_date },
      { module: "attendance", updated_value: newRecord, ...info }
    );
  }

  await writeDb(db);
  redirect("/attendance/manage?saved=1");
}
