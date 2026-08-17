import { redirect } from "next/navigation";
import { readDbLite } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { todayInTz } from "@/lib/utils";
import { activeSuspensionOn } from "@/lib/schedule-access";
import { displayUserName } from "@/lib/types";
import { getActiveSessions, callTotalsForDay, describeCallTargets } from "@/lib/call-sessions";
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

  // What each live call is a call OF — a lead or one of the agent's own regular
  // customers, and who. Keyed by session id, over the calls actually in
  // progress: at most one per agent, usually a handful. This board refreshes
  // every twenty seconds, and it used to build its labels from every order in
  // the system — three full reads of 51,000 rows per minute, per open tab, to
  // fill a dozen cells.
  const callTargets = await describeCallTargets(Array.from(activeCalls.values()));
  const leadNameById = new Map(db.profiles.map((p) => [p.id, displayUserName(p)]));
  const generatedAt = new Date().toISOString();

  const rows: MonitorRow[] = agents.map((agent) => {
    const attendance = db.attendance.find((a) => a.user_id === agent.id && a.work_date === today);
    const call = activeCalls.get(agent.id) || null;
    const bio = activeBio.get(agent.id) || null;
    const calls = callTotals.get(agent.id) || { count: 0, seconds: 0, lastEndedAt: null };
    const bios = bioTotals.get(agent.id) || { count: 0, seconds: 0, lastEndedAt: null };

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
      // Standby began when the last thing that wasn't standby ended — the
      // LATEST of those, which is the whole point. This used to read
      // `break_end || time_in`, so it saw the main break and nothing else:
      // an agent who had just hung up after forty-nine calls was reported as
      // standing by since they timed in, two hours earlier. Every agent on the
      // floor read as idle for their whole shift.
      //
      // Timing in is the floor; a completed call, bio break or break moves it
      // forward. The one in progress is not here by construction — an agent in
      // any of those is not in standby.
      sinceIso = [attendance.time_in, attendance.break_end, calls.lastEndedAt, bios.lastEndedAt]
        .filter((t): t is string => Boolean(t))
        .reduce((latest, t) => (t > latest ? t : latest));
    }

    // Standby is what is left of the shift after talking and breaks. Computed
    // from the total elapsed shift rather than summed from gaps, so any time
    // unaccounted for lands here rather than silently disappearing.
    let standbyBaseSeconds = 0;
    if (attendance?.time_in) {
      const shiftEnd = attendance.time_out ? new Date(attendance.time_out).getTime() : Date.now();
      const elapsed = Math.max(0, (shiftEnd - new Date(attendance.time_in).getTime()) / 1000);
      const mainBreak = (attendance.break_minutes ?? 0) * 60;
      standbyBaseSeconds = Math.max(0, elapsed - calls.seconds - bios.seconds - mainBreak);

      // Whatever stretch is currently running has to come out of the base, for
      // one of two reasons depending on the state — but the arithmetic is the
      // same either way, so it is one rule rather than two branches:
      //   standby  — the browser adds this stretch live, so leaving it here
      //              would count it twice;
      //   anything else — the totals subtracted above only cover COMPLETED
      //              calls, bio breaks and breaks, so the stretch in progress
      //              is still sitting inside `elapsed` and would otherwise be
      //              misreported as standby.
      const liveStates: MonitorState[] = ["on_call", "bio_break", "break", "standby"];
      if (sinceIso && liveStates.includes(state)) {
        standbyBaseSeconds = Math.max(0, standbyBaseSeconds - (Date.now() - new Date(sinceIso).getTime()) / 1000);
      }
    }

    return {
      agentId: agent.id,
      name: displayUserName(agent),
      callName: agent.call_name,
      teamLead: isTeamLead ? null : agent.team_lead_id ? leadNameById.get(agent.team_lead_id) || null : null,
      state,
      sinceIso,
      call: call ? callTargets.get(call.id) || null : null,
      calls: calls.count,
      talkSeconds: calls.seconds,
      bioCount: bios.count,
      bioSeconds: bios.seconds,
      standbyBaseSeconds: Math.round(standbyBaseSeconds),
    };
  });

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-page-title text-slate-900">Agent Monitoring</h1>
        <p className="text-sm text-slate-500">
          {isTeamLead ? "Your agents" : "All agents"} for {today}.{" "}
          <span className="font-medium">Calling</span> says who is on the other end — a lead, or one of the agent&apos;s
          own regular customers. Standby is shift time that is not a call and not a break —{" "}
          <span className="font-medium">For</span> is how long the current stretch has run,{" "}
          <span className="font-medium">Standby today</span> is the shift&apos;s total so far. Totals across a date
          range are in the Activity Report.
        </p>
      </div>
      <AgentMonitorBoard rows={rows} generatedAt={generatedAt} />
    </div>
  );
}
