import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDbLite, writeDb } from "@/lib/db";
import { can } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { notify } from "@/lib/notifications";
import { scopeAgentsForSchedule } from "@/lib/schedule-access";
import { copySchedules } from "@/lib/actions/schedules";

/** Section 7: "copy schedules from a previous day, week, or month onto a
 * target range" -- a preview (dry-run) then an apply, sharing this endpoint. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const db = await readDbLite();
  if (!can(user.role, "schedules", "assign", db.role_permissions)) {
    return NextResponse.json({ ok: false, error: "You do not have permission to copy schedules." }, { status: 403 });
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
  const sourceStart = String(body.source_start || "");
  const sourceEnd = String(body.source_end || "");
  const targetStart = String(body.target_start || "");
  if (agentIds.length === 0 || !sourceStart || !sourceEnd || !targetStart) {
    return NextResponse.json({ ok: false, error: "Agents, source range, and target start date are required." }, { status: 400 });
  }

  const dryRun = !body.confirm_replace && !body.apply;

  // Preview: run against a scratch copy of the db so nothing persists until
  // the user confirms (Section 7: "preview + conflict summary before applying").
  const workingDb = dryRun ? JSON.parse(JSON.stringify(db)) : db;
  const summary = copySchedules(workingDb, user, {
    agentIds,
    sourceStart,
    sourceEnd,
    targetStart,
    confirmReplace: !!body.confirm_replace,
  });

  if (dryRun) {
    return NextResponse.json({ ok: true, preview: true, summary });
  }

  const info = await getRequestInfo();
  logActivity(
    db,
    user.id,
    "SCHEDULE_COPIED",
    "schedule",
    null,
    { agent_count: agentIds.length, source_start: sourceStart, source_end: sourceEnd, target_start: targetStart, ...summary },
    { module: "schedules", ...info }
  );
  for (const agentId of summary.affectedAgentIds) {
    notify(
      db,
      [agentId],
      "schedule_change",
      "Schedule Updated",
      `Your duty schedule was copied starting ${targetStart}.`,
      "/schedule"
    );
  }

  await writeDb(db);
  return NextResponse.json({ ok: true, preview: false, summary });
}
