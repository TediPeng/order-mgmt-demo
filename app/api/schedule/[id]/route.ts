import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDb, writeDb } from "@/lib/db";
import { can } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { scheduleInScope, scopeAgentsForSchedule } from "@/lib/schedule-access";
import { upsertSchedule, deleteSchedule, notifyAgentSchedule } from "@/lib/actions/schedules";

/** Handles edit-popup saves, drag-drop moves, and resizes -- all are just
 * field updates on an existing schedule row. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const db = readDb();

  const existing = db.schedules.find((s) => s.id === id);
  if (!existing) return NextResponse.json({ ok: false, error: "Schedule not found." }, { status: 404 });
  if (!scheduleInScope(user, existing, db) || !can(user.role, "schedules", "edit", db.role_permissions)) {
    return NextResponse.json({ ok: false, error: "You do not have permission to edit this schedule." }, { status: 403 });
  }
  if (existing.suspension_id) {
    return NextResponse.json(
      { ok: false, error: "Suspension entries can only be changed by lifting the suspension." },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const agentId = (body.agent_id as string) ?? existing.agent_id;
  const allowedIds = new Set(scopeAgentsForSchedule(db, user).map((a) => a.id));
  if (!allowedIds.has(agentId)) {
    return NextResponse.json({ ok: false, error: "You can only schedule agents in your own team." }, { status: 403 });
  }

  const before = { ...existing };
  const isRestDay = (body.is_rest_day as boolean | undefined) ?? existing.is_rest_day;
  const result = upsertSchedule(
    db,
    user,
    {
      agent_id: agentId,
      schedule_date: (body.schedule_date as string) ?? existing.schedule_date,
      duty_start: isRestDay ? null : ((body.duty_start as string | undefined) ?? existing.duty_start),
      duty_end: isRestDay ? null : ((body.duty_end as string | undefined) ?? existing.duty_end),
      is_rest_day: isRestDay,
      remarks: (body.remarks as string | undefined) ?? existing.remarks,
    },
    { confirmReplace: !!body.confirm_replace, targetSchedule: existing }
  );

  if (!result.ok) {
    const status = result.code === "conflict" || result.code === "suspended" ? 409 : 400;
    return NextResponse.json({ ok: false, code: result.code, error: result.error, existing: result.existing }, { status });
  }

  const info = await getRequestInfo();
  logActivity(
    db,
    user.id,
    "SCHEDULE_UPDATED",
    "schedule",
    result.schedule.id,
    { agent_id: result.schedule.agent_id },
    { module: "schedules", previous_value: before, updated_value: result.schedule, ...info }
  );
  const action = body.schedule_date && body.schedule_date !== before.schedule_date ? "moved" : "updated";
  notifyAgentSchedule(db, result.schedule, action);
  writeDb(db);

  return NextResponse.json({ ok: true, schedule: result.schedule });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const db = readDb();

  const existing = db.schedules.find((s) => s.id === id);
  if (!existing) return NextResponse.json({ ok: false, error: "Schedule not found." }, { status: 404 });
  if (!scheduleInScope(user, existing, db) || !can(user.role, "schedules", "delete", db.role_permissions)) {
    return NextResponse.json({ ok: false, error: "You do not have permission to delete this schedule." }, { status: 403 });
  }
  if (existing.suspension_id) {
    return NextResponse.json(
      { ok: false, error: "Suspension entries can only be removed by lifting the suspension." },
      { status: 403 }
    );
  }

  const removed = deleteSchedule(db, id);
  if (!removed) return NextResponse.json({ ok: false, error: "Schedule not found." }, { status: 404 });

  const info = await getRequestInfo();
  logActivity(
    db,
    user.id,
    "SCHEDULE_DELETED",
    "schedule",
    id,
    { agent_id: removed.agent_id, schedule_date: removed.schedule_date },
    { module: "schedules", previous_value: removed, ...info }
  );
  notifyAgentSchedule(db, removed, "deleted");
  writeDb(db);

  return NextResponse.json({ ok: true });
}
