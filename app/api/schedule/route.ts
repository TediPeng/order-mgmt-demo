import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDbLite, writeDb } from "@/lib/db";
import { can } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { scopeSchedules, scopeAgentsForSchedule } from "@/lib/schedule-access";
import { upsertSchedule, notifyAgentSchedule } from "@/lib/actions/schedules";
import { displayCallName, displayUserName } from "@/lib/types";

/** Carried on the events this route returns. The month calendar that rendered
 * them is gone — the roster is a cut-off grid now, which colours its own cells
 * — but the field is part of the response and cheap to keep, and these are the
 * 700 shades because white on green-600 is 3.5:1 and fails AA at label size. */
const SCHEDULE_STATUS_COLORS: Record<string, string> = {
  scheduled: "#15803d", // green -- Scheduled for Duty
  rest_day: "#1d4ed8", // blue -- Rest Day
  suspension: "#c2410c", // orange -- Suspension
  unassigned: "#64748b", // slate -- No Schedule Assigned
};

/** Fetches only the visible date range (Section 9) -- FullCalendar's `events`
 * object form appends `start`/`end` automatically. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await readDbLite();
  if (!can(user.role, "schedules", "view", db.role_permissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const start = (searchParams.get("start") || "").slice(0, 10);
  const end = (searchParams.get("end") || "").slice(0, 10);
  const agentFilter = searchParams.get("agent") || "";
  const statusFilter = searchParams.get("status") || "";
  const q = (searchParams.get("q") || "").toLowerCase();

  let schedules = scopeSchedules(user, db.schedules, db);
  if (start) schedules = schedules.filter((s) => s.schedule_date >= start);
  if (end) schedules = schedules.filter((s) => s.schedule_date < end); // FullCalendar's end is exclusive
  if (agentFilter) schedules = schedules.filter((s) => s.agent_id === agentFilter);
  if (statusFilter) schedules = schedules.filter((s) => s.status === statusFilter);

  const byId = new Map(db.profiles.map((p) => [p.id, p]));
  // Search still matches the full name as well as the call name: the chip shows
  // the short one, but someone looking for "Aaliyah Cruz" should still find her.
  if (q) {
    schedules = schedules.filter((s) => {
      const agent = byId.get(s.agent_id);
      return `${agent?.full_name || ""} ${agent?.call_name || ""}`.toLowerCase().includes(q);
    });
  }

  const events = schedules.map((s) => {
    const agent = byId.get(s.agent_id);
    return {
      id: s.id,
      // The name and nothing else. Everyone on the floor works the same hours,
      // so repeating "08:00-17:00" down a column of fifteen agents cost the
      // width that the names needed. The times are still on the event (start /
      // end below, and extendedProps for the popup), and the week and day
      // views still show them — this is about the month grid.
      title: displayCallName(agent),
      start: s.duty_start ? `${s.schedule_date}T${s.duty_start}` : s.schedule_date,
      end: s.duty_end ? `${s.schedule_date}T${s.duty_end}` : undefined,
      allDay: !s.duty_start,
      editable: !s.suspension_id,
      backgroundColor: SCHEDULE_STATUS_COLORS[s.status] || SCHEDULE_STATUS_COLORS.unassigned,
      borderColor: SCHEDULE_STATUS_COLORS[s.status] || SCHEDULE_STATUS_COLORS.unassigned,
      extendedProps: {
        agent_id: s.agent_id,
        // The popup has room for the full name, and that is where someone
        // goes to be sure which person a chip refers to.
        agent_name: displayUserName(agent),
        status: s.status,
        is_rest_day: s.is_rest_day,
        remarks: s.remarks,
        suspension_id: s.suspension_id,
        schedule_date: s.schedule_date,
        duty_start: s.duty_start,
        duty_end: s.duty_end,
      },
    };
  });

  return NextResponse.json(events);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const db = await readDbLite();
  if (!can(user.role, "schedules", "create", db.role_permissions)) {
    return NextResponse.json({ ok: false, error: "You do not have permission to create schedules." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const agentId = String(body.agent_id || "");
  const allowedIds = new Set(scopeAgentsForSchedule(db, user).map((a) => a.id));
  if (!allowedIds.has(agentId)) {
    return NextResponse.json({ ok: false, error: "You can only schedule agents in your own team." }, { status: 403 });
  }

  const isRestDay = !!body.is_rest_day;
  const result = upsertSchedule(
    db,
    user,
    {
      agent_id: agentId,
      schedule_date: String(body.schedule_date || ""),
      duty_start: isRestDay ? null : (body.duty_start as string) || null,
      duty_end: isRestDay ? null : (body.duty_end as string) || null,
      is_rest_day: isRestDay,
      remarks: (body.remarks as string) || null,
    },
    { confirmReplace: !!body.confirm_replace }
  );

  if (!result.ok) {
    const status = result.code === "conflict" || result.code === "suspended" ? 409 : 400;
    return NextResponse.json({ ok: false, code: result.code, error: result.error, existing: result.existing }, { status });
  }

  const info = await getRequestInfo();
  logActivity(
    db,
    user.id,
    result.replaced ? "SCHEDULE_REPLACED" : "SCHEDULE_CREATED",
    "schedule",
    result.schedule.id,
    { agent_id: result.schedule.agent_id, schedule_date: result.schedule.schedule_date },
    { module: "schedules", updated_value: result.schedule, ...info }
  );
  notifyAgentSchedule(db, result.schedule, result.replaced ? "updated" : "created");
  await writeDb(db);

  return NextResponse.json({ ok: true, schedule: result.schedule });
}
