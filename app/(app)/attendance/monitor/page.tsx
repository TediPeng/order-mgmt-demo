import { redirect } from "next/navigation";
import { readDbLite } from "@/lib/db";
import { orderNumbersByIds } from "@/lib/orders-lookup";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { todayInTz } from "@/lib/utils";
import { activeSuspensionOn } from "@/lib/schedule-access";
import { displayUserName } from "@/lib/types";
import { getActiveSessions, callTotalsForDay } from "@/lib/call-sessions";
import { getActiveBioBreaks, bioBreakTotalsForDay } from "@/lib/bio-breaks";
import { AgentMonitorBoard, type MonitorRow, type MonitorState } from "@/components/AgentMonitorBoard";

export const dynamic = "force-dynamic";

/**
 * Live view of who is on a call, who is idle, and who is on a break.
 *
 * Administrators see everyone; a Team Lead sees only their own agents, matching
 * how scoping already works across the app. Gated on the existing `attendance`
 * permission rather than a new module key, which would mean altering the
 * module_key Postgres enum for no real gain.
 */
export default async function AgentMonitorPage() {
  const user = (await getCurrentUser())!;
  const db = await readDbLite();

  if (!can(user.role, "attendance", "view", db.role_permissions)) redirect("/dashboard");
  // Monitoring other people is a supervisory act, so an agent who happens to
  // hold attendance.view for their own record does not get the board.
  const isTeamLead = user.role === "team_lead";
  if (!isFullAccess(user.role) && !isTeamLead) redirect("/attendance");

  const today = todayInTz();

  const agents = db.profiles
    // A test account is left out of the board, unless it is the one looking —
    // the account has to be able to see the feature it is testing.
    .filter(
      (p) => !p.is_deleted && p.is_active && p.role === "agent" && (!p.is_test_account || p.id === user.id)
    )
    .filter((p) => (isTeamLead ? p.team_lead_id === user.id : true))
    .sort((a, b) => displayUserName(a).localeCompare(displayUserName(b)));

  const agentIds = agents.map((a) => a.id);
  const [activeCalls, activeBio, callTotals, bioTotals] = await Promise.all([
    getActiveSessions(agentIds),
    getActiveBioBreaks(agentIds),
    callTotalsForDay(agentIds, today),
    bioBreakTotalsForDay(agentIds, today),
  ]);

  // Order numbers for the calls actually in progress — at most one per agent,
  // usually a handful. This board refreshes every twenty seconds, and it used
  // to build the map from every order in the system: three full reads of
  // 51,000 rows per minute, per open tab, to label a dozen cells.
  const orderNumberById = await orderNumbersByIds(
    Array.from(activeCalls.values()).map((c) => c.order_id)
  );
  const leadNameById = new Map(db.profiles.map((p) => [p.id, displayUserName(p)]));
  const generatedAt = new Date().toISOString();

  const rows: MonitorRow[] = agents.map((agent) => {
    const attendance = db.attendance.find((a) => a.user_id === agent.id && a.work_date === today);
    const call = activeCalls.get(agent.id) || null;
    const bio = activeBio.get(agent.id) || null;
    const calls = callTotals.get(agent.id) || { count: 0, seconds: 0 };
    const bios = bioTotals.get(agent.id) || { count: 0, seconds: 0 };

    // The order below is the precedence when several could apply at once. Call
    // and bio break are mutually exclusive by construction, but a stale open
    // record after a timeout should still read as timed out.
    let state: MonitorState;
    let sinceIso: string | null;
    if (!attendance?.time_in) {
      // Not on the clock — but say WHY. "Not timed in" reads as a problem, and
      // for somebody on approved leave or a rostered rest day it is not one; a
      // supervisor scanning the board had to go and look up which it was for
      // every grey row.
      //
      // The attendance row is asked first because leave approval, suspension and
      // the absence sweep all write their answer into it. The schedule is the
      // fallback for a rest day nothing has stamped a row for yet.
      const suspension = activeSuspensionOn(db, agent.id, today, today);
      const restDayRostered = db.schedules.some(
        (s) => s.agent_id === agent.id && s.schedule_date === today && s.is_rest_day
      );

      if (suspension || attendance?.status === "suspended") state = "suspended";
      else if (attendance?.status === "on_leave") state = "on_leave";
      else if (attendance?.status === "rest_day" || restDayRostered) state = "rest_day";
      else state = "not_in";

      sinceIso = null;
    } else if (attendance.time_out) {
      state = "timed_out";
      sinceIso = attendance.time_out;
    } else if (call) {
      state = "on_call";
      sinceIso = call.started_at;
    } else if (bio) {
      state = "bio_break";
      sinceIso = bio.started_at;
    } else if (attendance.break_start && !attendance.break_end) {
      state = "break";
      sinceIso = attendance.break_start;
    } else {
      state = "standby";
      // Standby began when the last thing that wasn't standby ended. Falling
      // back to time_in covers an agent who has done nothing yet.
      sinceIso = attendance.break_end || attendance.time_in;
    }

    // The day's standby total is not computed here any more. This board shows
    // the stretch running now, which the browser times from `sinceIso`; the
    // total belongs to the Activity Report, which already derives it the same
    // way (shift elapsed, less talking and breaks) over a date range.
    return {
      agentId: agent.id,
      name: displayUserName(agent),
      callName: agent.call_name,
      teamLead: isTeamLead ? null : agent.team_lead_id ? leadNameById.get(agent.team_lead_id) || null : null,
      state,
      sinceIso,
      orderNumber: call ? orderNumberById.get(call.order_id) || null : null,
      calls: calls.count,
      talkSeconds: calls.seconds,
      bioCount: bios.count,
      bioSeconds: bios.seconds,
    };
  });

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-page-title text-slate-900">Agent Monitoring</h1>
        <p className="text-sm text-slate-500">
          {isTeamLead ? "Your agents" : "All agents"} for {today}. Standby is shift time that is not a call and not a
          break; the figure here is the stretch running now, and restarts each time one begins. The day&apos;s total is
          in the Activity Report.
        </p>
      </div>
      <AgentMonitorBoard rows={rows} generatedAt={generatedAt} />
    </div>
  );
}
