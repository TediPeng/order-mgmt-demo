"use server";

import path from "path";
import { redirect } from "next/navigation";
import { writeDb, uuid, nowIso } from "@/lib/db";
import { uploadFile } from "@/lib/storage";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { notify, supervisorRecipients } from "@/lib/notifications";
import { requireUserLite, requirePermission } from "./guards";
import { leaveRequestSchema, leaveReviewSchema } from "@/lib/validation";
import { todayInTz } from "@/lib/utils";
import { maxApprovedPerDay, fullDates } from "@/lib/leave";
import type { DbShape, LeaveRequest, LeaveStatus } from "@/lib/types";
import { describeParseFailure } from "@/lib/zod-error";

const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED_EXT = [".pdf", ".jpg", ".jpeg", ".png"];

function dateOnlyUTC(d: string): number {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day); // Date.UTC takes a zero-based month index
}

function daysInclusive(start: string, end: string): number {
  return Math.round((dateOnlyUTC(end) - dateOnlyUTC(start)) / 86400000) + 1;
}


/**
 * The stretches of a requested range that the cap leaves room for.
 *
 * A full day used to end the request: everything from it onwards was cut, so
 * somebody asking for the 1st to the 3rd with only the 2nd full lost the 3rd as
 * well -- a day the floor could have given and nobody had a reason to refuse.
 * The range is split around the full days instead, and each surviving stretch
 * becomes leave.
 *
 * Empty when every requested day is full: there is nothing to give.
 */
function freeRuns(start: string, end: string, full: Set<string>): { start: string; end: string }[] {
  const runs: { start: string; end: string }[] = [];
  let open: { start: string; end: string } | null = null;

  for (const day of eachDate(start, end)) {
    if (full.has(day)) {
      open = null;
      continue;
    }
    if (open) open.end = day;
    else {
      open = { start: day, end: day };
      runs.push(open);
    }
  }
  return runs;
}

/**
 * A second (or third) row for the stretches beyond the first.
 *
 * The agent filed one request and ends up holding more than one, which is worth
 * being careful about: each carries the original's reason, type and supervisor,
 * says in its own remarks that it was split and why, and is logged against the
 * person whose decision split it. Nothing is invented except the boundary the
 * cap forced.
 */
function splitOff(
  db: DbShape,
  original: LeaveRequest,
  run: { start: string; end: string },
  status: LeaveStatus,
  actorId: string,
  note: string,
  info: Record<string, unknown>
): LeaveRequest {
  const copy: LeaveRequest = {
    ...original,
    id: uuid(),
    leave_start: run.start,
    leave_end: run.end,
    leave_days: daysInclusive(run.start, run.end),
    status,
    management_remarks: note,
    reviewed_by: status === "pending" ? null : actorId,
    reviewed_at: status === "pending" ? null : nowIso(),
    created_at: original.created_at,
    updated_at: nowIso(),
  };
  db.leave_requests.push(copy);
  logActivity(db, actorId, "LEAVE_SPLIT", "leave_request", copy.id, {
    split_from: original.id,
    dates: `${run.start}..${run.end}`,
    status,
  }, { module: "leave", updated_value: copy, ...info });
  return copy;
}

/** Marks the days of an approved request as on_leave. */
function markOnLeave(db: DbShape, request: LeaveRequest, actorId: string) {
  for (const date of eachDate(request.leave_start, request.leave_end)) {
    const att = db.attendance.find((a) => a.user_id === request.agent_id && a.work_date === date);
    if (att) {
      att.status = "on_leave";
      att.updated_by = actorId;
      att.updated_at = nowIso();
      continue;
    }
    db.attendance.push({
      id: uuid(),
      user_id: request.agent_id,
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
      remarks: `Approved leave request (${request.leave_type})`,
      attachment_path: null,
      created_by: actorId,
      updated_by: actorId,
      updated_at: nowIso(),
    });
  }
}

/**
 * Close every pending request that reaches into a day the cap just filled.
 *
 * The full days are cut out and the stretches either side survive, each as its
 * own row, so a Tuesday filling costs the Tuesday rather than the rest of the
 * week behind it. When every day asked for is full there is nothing to keep and
 * the request is rejected outright. Either way the agent is told which days
 * filled and what became of their request; nobody should find this out by
 * noticing their dates changed.
 *
 * The Team Lead who approved is recorded as the actor, because this is their
 * approval taking effect and not a separate decision by anyone else.
 */
function closeRequestsBlockedBy(
  db: DbShape,
  actorId: string,
  newlyFull: Set<string>,
  info: Record<string, unknown>
) {
  if (newlyFull.size === 0) return;
  const cap = maxApprovedPerDay(db);

  // Snapshotted: splitting appends rows, and a pending row created by this loop
  // must not then be walked by the same loop.
  for (const other of [...db.leave_requests]) {
    if (other.status !== "pending") continue;

    const hitDays = eachDate(other.leave_start, other.leave_end).filter((d) => newlyFull.has(d));
    if (hitDays.length === 0) continue;

    const before = { ...other };
    const runs = freeRuns(other.leave_start, other.leave_end, newlyFull);
    const dayWord = `${hitDays.join(", ")} ${hitDays.length === 1 ? "already has" : "already have"} ${cap} people approved off, which is the daily limit`;

    if (runs.length === 0) {
      other.status = "rejected";
      other.management_remarks = `Automatically rejected: ${dayWord}.`;
      other.reviewed_by = actorId;
      other.reviewed_at = nowIso();
      other.updated_at = nowIso();

      logActivity(db, actorId, "LEAVE_REJECTED", "leave_request", other.id, { reason: "daily_cap", days: hitDays }, {
        module: "leave",
        previous_value: before,
        updated_value: other,
        ...info,
      });
      notify(
        db,
        [other.agent_id],
        "leave_status",
        "Leave Request Not Approved",
        `Your leave request for ${before.leave_start}${before.leave_start !== before.leave_end ? ` – ${before.leave_end}` : ""} was not approved. ${dayWord}. Please pick another date.`,
        "/leave"
      );
    } else {
      // The days that survive stay pending and stay whole: the request keeps
      // the first stretch and the rest become rows of their own, so a full day
      // in the middle costs that day and not everything after it.
      other.leave_start = runs[0].start;
      other.leave_end = runs[0].end;
      other.leave_days = daysInclusive(runs[0].start, runs[0].end);
      other.management_remarks = `Shortened automatically: ${dayWord}.`;
      other.updated_at = nowIso();

      const siblings = runs
        .slice(1)
        .map((run) =>
          splitOff(db, other, run, "pending", actorId, `Split from the request for ${rangeLabel(before)}: ${dayWord}.`, info)
        );

      logActivity(db, actorId, "LEAVE_SHORTENED", "leave_request", other.id, { reason: "daily_cap", days: hitDays }, {
        module: "leave",
        previous_value: before,
        updated_value: other,
        ...info,
      });
      notify(
        db,
        [other.agent_id],
        "leave_status",
        "Leave Request Shortened",
        `Your leave request for ${rangeLabel(before)} now covers ${[other, ...siblings].map(rangeLabel).join(" and ")}. ${dayWord}, so ${hitDays.length === 1 ? "that day was" : "those days were"} removed. What is left is still awaiting your Team Lead's decision.`,
        "/leave"
      );
    }
  }
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
  const { user, db } = await requireUserLite();
  requirePermission(user, "leave", "create", db, "/leave");

  const parsed = leaveRequestSchema.safeParse({
    leave_start: formData.get("leave_start"),
    leave_end: formData.get("leave_end"),
    leave_type: formData.get("leave_type"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    redirect(`/leave?error=${encodeURIComponent(describeParseFailure(parsed.error))}`);
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

  // The calendar greys these days out, so reaching here means the form was
  // bypassed. Refused rather than filed and auto-closed later: a request that
  // cannot be approved is not worth a Team Lead's attention.
  const full = fullDates(db);
  const alreadyFull = eachDate(data.leave_start, data.leave_end).filter((d) => full.has(d));
  if (alreadyFull.length > 0) {
    redirect(
      `/leave?error=${encodeURIComponent(
        `${alreadyFull.join(", ")} already ${alreadyFull.length === 1 ? "has" : "have"} ${maxApprovedPerDay(db)} people approved off, which is the daily limit. Please pick another date.`
      )}`
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
  const { user, db } = await requireUserLite();
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
  const { user, db } = await requireUserLite();
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
    redirect(`/leave?error=${encodeURIComponent(describeParseFailure(parsed.error))}`);
  }
  const data = parsed.data;

  // Resubmitting sets fresh dates, so it meets the cap on the same terms as
  // filing does. Without this the returned-for-revision route is a way round it.
  const resubmitFull = fullDates(db, request!.id);
  const resubmitBlocked = eachDate(data.leave_start, data.leave_end).filter((d) => resubmitFull.has(d));
  if (resubmitBlocked.length > 0) {
    redirect(
      `/leave?error=${encodeURIComponent(
        `${resubmitBlocked.join(", ")} already ${resubmitBlocked.length === 1 ? "has" : "have"} ${maxApprovedPerDay(db)} people approved off, which is the daily limit. Please pick another date.`
      )}`
    );
  }

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
  const { user, db } = await requireUserLite();
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

  // The cap is enforced here rather than only warned about. Measured without
  // this request, so a request already approved is never counted against
  // itself when its decision is revisited.
  const fullBefore = fullDates(db, request!.id);
  const before = { ...request! };
  /** Days the cap refused, and the extra rows the survivors were split into. */
  let refused: string[] = [];
  let extraRuns: { start: string; end: string }[] = [];

  if (data.decision === "approved") {
    refused = eachDate(request!.leave_start, request!.leave_end).filter((d) => fullBefore.has(d));

    if (refused.length > 0) {
      const runs = freeRuns(request!.leave_start, request!.leave_end, fullBefore);

      if (runs.length === 0) {
        // Every day asked for is full. There is no approval to be had.
        redirect(
          `/leave?error=${encodeURIComponent(
            `Cannot approve: ${refused.join(", ")} already ${refused.length === 1 ? "has" : "have"} ${maxApprovedPerDay(db)} people approved off, which is the daily limit. Cancel an approved leave on one of those days, or reject this request.`
          )}`
        );
      }

      // The request keeps the first stretch the cap allows; the rest become
      // rows of their own, so a full day in the middle costs that day alone
      // instead of everything after it.
      request!.leave_start = runs[0].start;
      request!.leave_end = runs[0].end;
      request!.leave_days = daysInclusive(runs[0].start, runs[0].end);
      extraRuns = runs.slice(1);
    }
  }

  request!.status = data.decision as LeaveStatus;
  request!.management_remarks = data.management_remarks || null;
  request!.reviewed_by = user.id;
  request!.reviewed_at = nowIso();
  request!.updated_at = nowIso();

  const info = await getRequestInfo();
  const actionName =
    data.decision === "approved" ? "LEAVE_APPROVED" : data.decision === "rejected" ? "LEAVE_REJECTED" : "LEAVE_RETURNED";
  logActivity(db, user.id, actionName, "leave_request", request!.id, { decision: data.decision, ...(refused.length ? { refused_days: refused, reason: "daily_cap" } : {}) }, {
    module: "leave",
    previous_value: before,
    updated_value: request,
    ...info,
  });

  // The stretches beyond the first become rows of their own, then every
  // approved day -- original and split alike -- is written to attendance.
  const splitRows = extraRuns.map((run) =>
    splitOff(
      db,
      request!,
      run,
      "approved",
      user.id,
      `Split from the request for ${before.leave_start} – ${before.leave_end}: ${refused.join(", ")} already had ${maxApprovedPerDay(db)} people approved off.`,
      info
    )
  );

  if (data.decision === "approved") {
    markOnLeave(db, request!, user.id);
    for (const extra of splitRows) markOnLeave(db, extra, user.id);
  }

  // Whatever days this approval just filled now close for everybody else.
  // Only the days it filled -- a day that was already at the cap closed when it
  // got there, and reopening that decision here would make one approval answer
  // for another's consequences.
  if (data.decision === "approved") {
    const newlyFull = new Set([...fullDates(db)].filter((d) => !fullBefore.has(d)));
    closeRequestsBlockedBy(db, user.id, newlyFull, info);
  }

  const label = data.decision === "returned_for_revision" ? "Returned for Revision" : data.decision[0].toUpperCase() + data.decision.slice(1);
  notify(
    db,
    [request!.agent_id],
    "leave_status",
    "Leave Request Update",
    // Named by what was asked for, not by what survived, and then told exactly
    // which days were kept and which were refused. An agent who asked for three
    // days and reads "your request for the 1st was Approved" has been answered
    // about a request they did not make.
    `Your leave request for ${rangeLabel(before)} was ${label}.${
      refused.length > 0
        ? ` Approved for ${[request!, ...splitRows].map(rangeLabel).join(" and ")}. ${refused.join(", ")} could not be approved — already ${refused.length === 1 ? "has" : "have"} ${maxApprovedPerDay(db)} people off, which is the daily limit.`
        : ""
    }`,
    "/leave"
  );

  await writeDb(db);
  redirect("/leave?reviewed=1");
}

/** "2026-09-01" for one day, "2026-09-01 – 2026-09-03" for more. */
function rangeLabel(r: { leave_start: string; leave_end: string }): string {
  return r.leave_start === r.leave_end ? r.leave_start : `${r.leave_start} – ${r.leave_end}`;
}
