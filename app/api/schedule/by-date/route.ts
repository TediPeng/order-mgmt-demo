import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDbLite, writeDb } from "@/lib/db";
import { can } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { scheduleInScope } from "@/lib/schedule-access";
import { deleteSchedule, notifyAgentSchedule } from "@/lib/actions/schedules";

export const dynamic = "force-dynamic";

/**
 * Clears one agent's schedule on one date.
 *
 * The grid addresses a cell by agent and date — it never sees a schedule id,
 * and asking it to fetch one first would be a round trip to learn something the
 * server can look up itself. Everything else is the same rule as
 * DELETE /api/schedule/[id]: the schedule must be in scope, the caller must
 * hold schedules.delete, and a suspension entry cannot be removed here.
 */
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get("agent") || "";
  const date = (searchParams.get("date") || "").slice(0, 10);
  if (!agentId || !date) {
    return NextResponse.json({ ok: false, error: "agent and date are required." }, { status: 400 });
  }

  const db = await readDbLite();
  const existing = db.schedules.find((s) => s.agent_id === agentId && s.schedule_date === date);
  // Already clear. Said as success rather than 404: the grid asked for the cell
  // to be empty and it is, which is what the caller wanted to be true.
  if (!existing) return NextResponse.json({ ok: true, cleared: false });

  if (!scheduleInScope(user, existing, db) || !can(user.role, "schedules", "delete", db.role_permissions)) {
    return NextResponse.json({ ok: false, error: "You do not have permission to clear this schedule." }, { status: 403 });
  }
  if (existing.suspension_id) {
    return NextResponse.json(
      { ok: false, error: "Suspension entries can only be removed by lifting the suspension." },
      { status: 403 }
    );
  }

  const removed = deleteSchedule(db, existing.id);
  if (!removed) return NextResponse.json({ ok: false, error: "Schedule not found." }, { status: 404 });

  const info = await getRequestInfo();
  logActivity(
    db,
    user.id,
    "SCHEDULE_DELETED",
    "schedule",
    removed.id,
    { agent_id: removed.agent_id, schedule_date: removed.schedule_date },
    { module: "schedules", previous_value: removed, ...info }
  );
  notifyAgentSchedule(db, removed, "deleted");
  await writeDb(db);

  return NextResponse.json({ ok: true, cleared: true });
}
