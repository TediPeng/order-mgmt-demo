"use server";

import path from "path";
import { redirect } from "next/navigation";
import { writeDb, uuid, nowIso } from "@/lib/db";
import { uploadFile } from "@/lib/storage";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { notify, supervisorRecipients } from "@/lib/notifications";
import { requireUser, requirePermission } from "./guards";
import { leaveRequestSchema, leaveReviewSchema } from "@/lib/validation";
import { todayInTz } from "@/lib/utils";
import type { LeaveRequest, LeaveStatus } from "@/lib/types";

const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED_EXT = [".pdf", ".jpg", ".jpeg", ".png"];

function dateOnlyUTC(d: string): number {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day); // Date.UTC takes a zero-based month index
}

function daysInclusive(start: string, end: string): number {
  return Math.round((dateOnlyUTC(end) - dateOnlyUTC(start)) / 86400000) + 1;
}

function eachDate(start: string, end: string): string[] {
  const dates: string[] = [];
  const startMs = dateOnlyUTC(start);
  const endMs = dateOnlyUTC(end);
  for (let t = startMs; t <= endMs; t += 86400000) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

export async function fileLeaveAction(formData: FormData) {
  const { user, db } = await requireUser();
  requirePermission(user, "leave", "create", db, "/leave");

  const parsed = leaveRequestSchema.safeParse({
    leave_start: formData.get("leave_start"),
    leave_end: formData.get("leave_end"),
    leave_type: formData.get("leave_type"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    redirect(`/leave?error=${encodeURIComponent(parsed.error.issues[0]?.message || "Invalid input.")}`);
  }
  const data = parsed.data;

  if (data.leave_end < data.leave_start) {
    redirect(`/leave?error=${encodeURIComponent("Leave end date cannot be before the start date.")}`);
  }

  const filingDate = todayInTz();
  const daysInAdvance = Math.round((dateOnlyUTC(data.leave_start) - dateOnlyUTC(filingDate)) / 86400000);

  // Section 0.4: only Emergency Leave (with a reason -- already required by
  // leaveRequestSchema) may bypass the 3-day rule. Sick now follows it like Unpaid.
  if (data.leave_type !== "emergency" && daysInAdvance < 3) {
    redirect(
      `/leave?error=${encodeURIComponent("Leave requests must be submitted at least three days before the requested leave date.")}`
    );
  }

  const urgentReview = data.leave_type === "emergency" && daysInAdvance < 3;

  let attachmentPath: string | null = null;
  const file = formData.get("attachment") as File | null;
  if (file && file.size > 0) {
    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      redirect(`/leave?error=${encodeURIComponent("Attachment must be a PDF, JPG, or PNG file.")}`);
    }
    if (file.size > MAX_SIZE) {
      redirect(`/leave?error=${encodeURIComponent("Attachment must be 5 MB or smaller.")}`);
    }
    const storedName = `${uuid()}${ext}`;
    await uploadFile(`leave/${storedName}`, Buffer.from(await file.arrayBuffer()));
    attachmentPath = storedName;
  } else if (data.leave_type === "sick" && db.work_schedule.require_attachment_for_sick_leave) {
    redirect(`/leave?error=${encodeURIComponent("A supporting document is required for Sick leave.")}`);
  }

  const supervisor = user.team_lead_id ? db.profiles.find((p) => p.id === user.team_lead_id) : null;

  const request: LeaveRequest = {
    id: uuid(),
    agent_id: user.id,
    agent_email: user.email,
    department_team: supervisor?.full_name || null,
    filing_date: filingDate,
    leave_start: data.leave_start,
    leave_end: data.leave_end,
    leave_days: daysInclusive(data.leave_start, data.leave_end),
    leave_type: data.leave_type,
    reason: data.reason,
    attachment_path: attachmentPath,
    supervisor_id: user.team_lead_id,
    status: "pending",
    urgent_review: urgentReview,
    management_remarks: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  db.leave_requests.push(request);

  const info = await getRequestInfo();
  logActivity(db, user.id, "LEAVE_FILED", "leave_request", request.id, { leave_type: request.leave_type, days: request.leave_days }, {
    module: "leave",
    updated_value: request,
    ...info,
  });

  notify(
    db,
    supervisorRecipients(db, user.team_lead_id),
    "leave_status",
    "New Leave Request",
    `${user.full_name} filed a ${request.leave_type} leave request for ${request.leave_start} to ${request.leave_end}${urgentReview ? " (urgent review)" : ""}.`,
    "/leave"
  );

  await writeDb(db);
  redirect("/leave?filed=1");
}

export async function cancelLeaveAction(requestId: string) {
  "use server";
  const { user, db } = await requireUser();
  const request = db.leave_requests.find((r) => r.id === requestId);
  if (!request) redirect("/leave");
  if (request!.agent_id !== user.id) redirect("/leave?error=" + encodeURIComponent("You can only cancel your own requests."));
  if (request!.status !== "pending") redirect("/leave?error=" + encodeURIComponent("Only pending requests can be cancelled."));

  const before = { ...request! };
  request!.status = "cancelled";
  request!.updated_at = nowIso();

  const info = await getRequestInfo();
  logActivity(db, user.id, "LEAVE_CANCELLED", "leave_request", request!.id, {}, {
    module: "leave",
    previous_value: before,
    updated_value: request,
    ...info,
  });
  await writeDb(db);
  redirect("/leave?cancelled=1");
}

export async function resubmitLeaveAction(formData: FormData) {
  const { user, db } = await requireUser();
  const requestId = String(formData.get("id") || "");
  const request = db.leave_requests.find((r) => r.id === requestId);
  if (!request) redirect("/leave");
  if (request!.agent_id !== user.id) redirect("/leave");
  if (request!.status !== "returned_for_revision") redirect("/leave");

  const parsed = leaveRequestSchema.safeParse({
    leave_start: formData.get("leave_start"),
    leave_end: formData.get("leave_end"),
    leave_type: formData.get("leave_type"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    redirect(`/leave?error=${encodeURIComponent(parsed.error.issues[0]?.message || "Invalid input.")}`);
  }
  const data = parsed.data;
  const before = { ...request! };

  request!.leave_start = data.leave_start;
  request!.leave_end = data.leave_end;
  request!.leave_days = daysInclusive(data.leave_start, data.leave_end);
  request!.leave_type = data.leave_type;
  request!.reason = data.reason;
  request!.status = "pending";
  request!.management_remarks = null;
  request!.updated_at = nowIso();

  const info = await getRequestInfo();
  logActivity(db, user.id, "LEAVE_FILED", "leave_request", request!.id, { resubmitted: true }, {
    module: "leave",
    previous_value: before,
    updated_value: request,
    ...info,
  });
  notify(
    db,
    supervisorRecipients(db, request!.supervisor_id),
    "leave_status",
    "Leave Request Resubmitted",
    `${user.full_name} resubmitted a leave request for ${request!.leave_start} to ${request!.leave_end}.`,
    "/leave"
  );
  await writeDb(db);
  redirect("/leave?filed=1");
}

export async function reviewLeaveAction(formData: FormData) {
  const { user, db } = await requireUser();
  requirePermission(user, "leave", "approve", db, "/leave");

  const parsed = leaveReviewSchema.safeParse({
    id: formData.get("id"),
    decision: formData.get("decision"),
    management_remarks: formData.get("management_remarks"),
  });
  if (!parsed.success) redirect("/leave");
  const data = parsed.data;

  const request = db.leave_requests.find((r) => r.id === data.id);
  if (!request) redirect("/leave");

  if (user.role === "team_lead" && request!.supervisor_id !== user.id) {
    redirect(`/leave?error=${encodeURIComponent("You can only review requests for your own team.")}`);
  }

  const before = { ...request! };
  request!.status = data.decision as LeaveStatus;
  request!.management_remarks = data.management_remarks || null;
  request!.reviewed_by = user.id;
  request!.reviewed_at = nowIso();
  request!.updated_at = nowIso();

  const info = await getRequestInfo();
  const actionName =
    data.decision === "approved" ? "LEAVE_APPROVED" : data.decision === "rejected" ? "LEAVE_REJECTED" : "LEAVE_RETURNED";
  logActivity(db, user.id, actionName, "leave_request", request!.id, { decision: data.decision }, {
    module: "leave",
    previous_value: before,
    updated_value: request,
    ...info,
  });

  if (data.decision === "approved") {
    for (const date of eachDate(request!.leave_start, request!.leave_end)) {
      const att = db.attendance.find((a) => a.user_id === request!.agent_id && a.work_date === date);
      if (att) {
        att.status = "on_leave";
        att.updated_by = user.id;
        att.updated_at = nowIso();
      } else {
        db.attendance.push({
          id: uuid(),
          user_id: request!.agent_id,
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
          status: "on_leave",
          remarks: `Approved leave request (${request!.leave_type})`,
          attachment_path: null,
          created_by: user.id,
          updated_by: user.id,
          updated_at: nowIso(),
        });
      }
    }
  }

  const label = data.decision === "returned_for_revision" ? "Returned for Revision" : data.decision[0].toUpperCase() + data.decision.slice(1);
  notify(
    db,
    [request!.agent_id],
    "leave_status",
    "Leave Request Update",
    `Your leave request for ${request!.leave_start}${request!.leave_start !== request!.leave_end ? ` – ${request!.leave_end}` : ""} was ${label}.`,
    "/leave"
  );

  await writeDb(db);
  redirect("/leave?reviewed=1");
}
