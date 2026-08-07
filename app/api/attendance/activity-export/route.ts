import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDb, writeDb } from "@/lib/db";
import { can, isFullAccess } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { displayUserName } from "@/lib/types";
import { resolveDateRange } from "@/lib/performance";
import { callTotalsForRange } from "@/lib/call-sessions";
import { bioBreakTotalsForRange } from "@/lib/bio-breaks";
import { computeActivityReport } from "@/lib/activity-report";
import { buildBrandedCsv } from "@/lib/csv";

/** CSV of the Agent Activity Report.
 *
 * Recomputes from the same helpers the page uses rather than accepting figures
 * from the client — an export is the copy that gets forwarded and filed, so it
 * must not be something a crafted request could dictate.
 *
 * Durations go out as decimal hours, not "7h 32m". The screen is for reading
 * and the file is for a spreadsheet, where a formatted string is a value you
 * cannot sum.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await readDb();
  // Gated on the same pair the page is: attendance:export for the file, and
  // the supervisory check so an agent cannot export a board of everyone else.
  if (!can(user.role, "attendance", "export", db.role_permissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const isTeamLead = user.role === "team_lead";
  if (!isFullAccess(user.role) && !isTeamLead) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const range = resolveDateRange(
    searchParams.get("range") || "this_month",
    searchParams.get("from") || undefined,
    searchParams.get("to") || undefined
  );

  const agents = db.profiles
    .filter((p) => !p.is_deleted && p.role === "agent")
    .filter((p) => (isTeamLead ? p.team_lead_id === user.id : true))
    .map((p) => ({ id: p.id, name: displayUserName(p) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const agentIds = agents.map((a) => a.id);
  const [callTotals, bioTotals] = await Promise.all([
    callTotalsForRange(agentIds, range.from, range.to),
    bioBreakTotalsForRange(agentIds, range.from, range.to),
  ]);

  const rows = computeActivityReport(db, agents, range.from, range.to, callTotals, bioTotals);

  const hours = (seconds: number) => Math.round((seconds / 3600) * 100) / 100;

  const header = [
    "Agent",
    "Days Worked",
    "Open Shifts",
    "Shift Hours",
    "Talk Hours",
    "Calls",
    "Standby Hours",
    "Break Hours",
    "Bio Breaks",
    "Minutes Late",
    "Over Break Minutes",
    // Overtime is off the screen but stays in the file: an export is what gets
    // filed and reconciled later, and dropping a column from it loses data
    // that removing a column from a table does not.
    "Overtime Hours",
    "Utilisation %",
  ];
  const body = rows.map((r) => [
    r.name,
    r.days,
    r.openShifts,
    hours(r.shiftSeconds),
    hours(r.talkSeconds),
    r.calls,
    hours(r.standbySeconds),
    hours(r.breakSeconds + r.bioSeconds),
    r.bioCount,
    r.lateMinutes,
    r.overBreakMinutes,
    r.overtimeHours,
    // Blank rather than 0 when nothing was worked, matching the page's dash:
    // a spreadsheet averaging this column must not be handed a false zero.
    r.utilisation === null ? "" : r.utilisation,
  ]);

  const csv = buildBrandedCsv(`Agent Activity Report (${range.from} to ${range.to})`, header, body);

  logActivity(
    db,
    user.id,
    "REPORT_EXPORTED",
    "attendance",
    null,
    { report: "agent_activity", from: range.from, to: range.to, agents: rows.length },
    { module: "attendance" }
  );
  await writeDb(db);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="agent-activity-${range.from}-to-${range.to}.csv"`,
    },
  });
}
