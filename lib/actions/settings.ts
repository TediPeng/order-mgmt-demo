"use server";

import { redirect } from "next/navigation";
import { writeDb } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { requireUser, requirePermission } from "./guards";

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export async function updateWorkScheduleAction(formData: FormData) {
  const { user, db } = await requireUser();
  requirePermission(user, "settings", "manage", db, "/settings/system");

  const workStart = String(formData.get("work_start") || "");
  const workEnd = String(formData.get("work_end") || "");
  const breakMinutes = Number(formData.get("break_minutes"));
  const autoMarkAbsent = formData.get("auto_mark_absent") === "on";
  const requireAttachmentForSick = formData.get("require_attachment_for_sick_leave") === "on";

  if (!HHMM_RE.test(workStart) || !HHMM_RE.test(workEnd)) {
    redirect(`/settings/system?error=${encodeURIComponent("Scheduled time in/out must be a valid time (HH:mm).")}`);
  }
  if (!Number.isFinite(breakMinutes) || breakMinutes <= 0 || breakMinutes > 240) {
    redirect(`/settings/system?error=${encodeURIComponent("Break allowance must be between 1 and 240 minutes.")}`);
  }

  const before = { ...db.work_schedule };
  db.work_schedule = {
    ...db.work_schedule,
    work_start: workStart,
    work_end: workEnd,
    break_minutes: breakMinutes,
    auto_mark_absent: autoMarkAbsent,
    require_attachment_for_sick_leave: requireAttachmentForSick,
  };

  const info = await getRequestInfo();
  logActivity(db, user.id, "SETTINGS_UPDATED", "settings", "work_schedule", { before, after: db.work_schedule }, {
    module: "settings",
    previous_value: before,
    updated_value: db.work_schedule,
    ...info,
  });
  await writeDb(db);
  redirect("/settings/system?saved=1");
}

export async function updateThresholdsAction(formData: FormData) {
  const { user, db } = await requireUser();
  requirePermission(user, "settings", "manage", db, "/settings/system");

  const topRatio = Number(formData.get("top_performer_min_ratio"));
  const lowRatio = Number(formData.get("needs_improvement_max_ratio"));
  const rtsThreshold = Number(formData.get("rts_warning_threshold_pct"));

  if (!Number.isFinite(topRatio) || topRatio <= 1) {
    redirect(`/settings/system?error=${encodeURIComponent("Top performer ratio must be a number greater than 1.")}`);
  }
  if (!Number.isFinite(lowRatio) || lowRatio <= 0 || lowRatio >= 1) {
    redirect(`/settings/system?error=${encodeURIComponent("Needs-improvement ratio must be between 0 and 1.")}`);
  }
  if (!Number.isFinite(rtsThreshold) || rtsThreshold <= 0 || rtsThreshold > 100) {
    redirect(`/settings/system?error=${encodeURIComponent("RTS % warning threshold must be between 0 and 100.")}`);
  }

  const before = { ...db.performance_thresholds };
  db.performance_thresholds = {
    top_performer_min_ratio: topRatio,
    needs_improvement_max_ratio: lowRatio,
    rts_warning_threshold_pct: rtsThreshold,
  };

  const info = await getRequestInfo();
  logActivity(db, user.id, "SETTINGS_UPDATED", "settings", "performance_thresholds", { before, after: db.performance_thresholds }, {
    module: "settings",
    previous_value: before,
    updated_value: db.performance_thresholds,
    ...info,
  });
  await writeDb(db);
  redirect("/settings/system?saved=1");
}
