import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDbLite, writeDb, uuid } from "@/lib/db";
import { can } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { notify } from "@/lib/notifications";
import { scopeAgentsForSchedule, eachDateInclusive, addDaysToYmd } from "@/lib/schedule-access";
import { bulkAssignSchedules } from "@/lib/actions/schedules";

/** Section 7: multi-assign, bulk assign (whole week/month), and recurring
 * (weekly pattern for N weeks) all resolve to a list of dates here, then
 * share the same bulkAssignSchedules core. */
function resolveDates(body: Record<string, unknown>): string[] {
  const mode = String(body.mode || "single");
  const startDate = String(body.start_date || "");
  if (!startDate) return [];

  if (mode === "single") return [startDate];

  if (mode === "range") {
    const endDate = String(body.end_date || startDate);
    return eachDateInclusive(startDate, endDate);
  }

  if (mode === "weekly") {
    const weekdays = new Set((body.weekdays as number[]) || []);
    const weeks = Math.max(1, Math.min(52, Number(body.weeks) || 1));
    const endDate = addDaysToYmd(startDate, weeks * 7 - 1);
    return eachDateInclusive(startDate, endDate).filter((d) => weekdays.has(new Date(d + "T00:00:00Z").getUTCDay()));
  }

  return [];
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const db = await readDbLite();
  if (!can(user.role, "schedules", "assign", db.role_permissions)) {
    return NextResponse.json({ ok: false, error: "You do not have permission to bulk-assign schedules." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const requestedIds = Array.isArray(body.agent_ids) ? (body.agent_ids as string[]) : [];
  const allowedIds = new Set(scopeAgentsForSchedule(db, user).map((a) => a.id));
  const agentIds = requestedIds.filter((id) => allowedIds.has(id));
  if (agentIds.length === 0) {
    return NextResponse.json({ ok: false, error: "Select at least one agent you're allowed to schedule." }, { status: 400 });
  }

  const dates = resolveDates(body);
  if (dates.length === 0) {
    return NextResponse.json({ ok: false, error: "No valid dates resolved for this pattern." }, { status: 400 });
  }

  const isRestDay = !!body.is_rest_day;
  const recurrenceGroup = body.mode === "weekly" ? uuid() : null;

  const summary = bulkAssignSchedules(db, user, {
    agentIds,
    dates,
    dutyStart: isRestDay ? null : (body.duty_start as string) || null,
    dutyEnd: isRestDay ? null : (body.duty_end as string) || null,
    isRestDay,
    remarks: (body.remarks as string) || null,
    confirmReplace: !!body.confirm_replace,
    recurrenceGroup,
  });

  const info = await getRequestInfo();
  logActivity(
    db,
    user.id,
    "SCHEDULE_BULK_ASSIGNED",
    "schedule",
    null,
    { agent_count: agentIds.length, date_count: dates.length, mode: body.mode, ...summary },
    { module: "schedules", ...info }
  );
  for (const agentId of summary.affectedAgentIds) {
    notify(
      db,
      [agentId],
      "schedule_change",
      "Schedule Updated",
      `Your duty schedule was updated for ${dates.length} date(s) starting ${dates[0]}.`,
      "/schedule"
    );
  }

  await writeDb(db);
  return NextResponse.json({ ok: true, summary });
}
