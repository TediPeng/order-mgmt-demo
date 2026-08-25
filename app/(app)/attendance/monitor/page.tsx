import { redirect } from "next/navigation";
import { readDbLite } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { todayInTz } from "@/lib/utils";
import { activeSuspensionOn } from "@/lib/schedule-access";
import { displayUserName } from "@/lib/types";
import { getActiveSessions, callTotalsForDay, describeCallTargets } from "@/lib/call-sessions";
import { getActiveBioBreaks, bioBreakTotalsForDay } from "@/lib/bio-breaks";
import { AgentMonitorBoard, type AttendanceSource, type MonitorRow, type MonitorState } from "@/components/AgentMonitorBoard";
import { fetchPortalAttendance, portalOwnsAttendance } from "@/lib/portal-attendance";
import { MonitorDatePicker } from "@/components/MonitorDatePicker";

export const dynamic = "force-dynamic";

/** How long after hanging up an agent still counts as working the queue
 * rather than idle. Their calls average under two minutes, so three covers a
 * normal pause to log the outcome and dial the next number without hiding
 * somebody who has genuinely stopped. */
const BETWEEN_CALLS_SECONDS = 180;

/**
 * Live view of who is on a call, who is idle, and who is on a break.
 *
 * Administrators see everyone; a Team Lead sees only their own agents, matching
 * how scoping already works across the app. Gated on the existing `attendance`
 * permission rather than a new module key, which would mean altering the
 * module_key Postgres enum for no real gain.
 */
export default async function AgentMonitorPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; state?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDbLite();

  if (!can(user.role, "attendance", "view", db.role_permissions)) redirect("/dashboard");
  // Monitoring other people is a supervisory act, so an agent who happens to
  // hold attendance.view for their own record does not get the board.
  const isTeamLead = user.role === "team_lead";
  if (!isFullAccess(user.role) && !isTeamLead) redirect("/attendance");

  const today = todayInTz();
  /**
   * The day being shown. Today unless asked otherwise.
   *
   * A future date is snapped back rather than refused: it can only come from a
   * hand-typed URL or a mis-click on the picker, and an empty board for a day
   * that has not happened reads as a fault.
   */
  const requested = (sp.date || "").slice(0, 10);
  const asked =
    requested.length === 10 && !Number.isNaN(Date.parse(`${requested}T00:00:00Z`)) ? requested : today;
  const viewDate = asked > today ? today : asked;
  const isToday = viewDate === today;

  const agents = db.profiles
    // A test account is left out of the board, unless it is the one looking —
    // the account has to be able to see the feature it is testing.
    .filter(
      (p) => !p.is_deleted && p.is_active && p.role === "agent" && (!p.is_test_account || p.id === user.id)
    )
    .filter((p) => (isTeamLead ? p.team_lead_id === user.id : true))
    .sort((a, b) => displayUserName(a).localeCompare(displayUserName(b)));

  const agentIds = agents.map((a) => a.id);
  const [activeCalls, activeBio, callTotals, bioTotals, portalAttendance] = await Promise.all([
    getActiveSessions(agentIds),
    getActiveBioBreaks(agentIds),
    callTotalsForDay(agentIds, viewDate),
    bioBreakTotalsForDay(agentIds, viewDate),
    // The clock lives in the company portal now. Fetched alongside the rest
    // rather than before it: the board should not wait on another application
    // to start counting calls, and if the portal is slow this is the request
    // that gives up first.
    portalOwnsAttendance() ? fetchPortalAttendance(viewDate) : Promise.resolve(null),
  ]);

  // Whether this board is showing what the portal says, ROMA's own older table,
  // or the portal's answer having failed. The third case has to be visible:
  // without attendance every agent reads as "Not timed in", which looks like an
  // empty floor rather than a missing answer, and a supervisor would act on it.
  const attendanceSource: AttendanceSource = !portalOwnsAttendance()
    ? "roma"
    : portalAttendance
      ? "portal"
      : "portal-unavailable";

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
    // Same shape either way, so everything below this line is unchanged by
    // where the day came from. The portal keys its answer by ROMA profile id,
    // which is this agent's id -- that is the whole point of the link.
    //
    // Breaks come across too. The portal grew a real break clock in its
    // migration 097 -- break_start and break_end, not just the scheduled
    // deduction it had before -- so the Break state below still works once the
    // portal owns attendance, and over-break is measured against the allowance
    // on the side that pays for it.
    const portalDay = portalAttendance?.get(agent.id) ?? null;
    const attendance =
      attendanceSource === "portal"
        ? portalDay
          ? {
              time_in: portalDay.timeIn,
              time_out: portalDay.timeOut,
              status: portalDay.status,
              break_start: portalDay.breakStart,
              break_end: portalDay.breakEnd,
              break_minutes: portalDay.breakMinutes ?? 0,
            }
          : undefined
        : db.attendance.find((a) => a.user_id === agent.id && a.work_date === viewDate);
    // An open session is open NOW. On a past day it belongs to today's board,
    // not to this one, so it is never read into a historical row.
    const call = isToday ? activeCalls.get(agent.id) || null : null;
    const bio = isToday ? activeBio.get(agent.id) || null : null;
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
      const suspension = activeSuspensionOn(db, agent.id, viewDate, viewDate);
      const restDayRostered = db.schedules.some(
        (s) => s.agent_id === agent.id && s.schedule_date === viewDate && s.is_rest_day
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

      // A gap of seconds between two calls is not idleness, and calling it
      // Standby made the busiest people on the floor look like the least busy:
      // an agent placing fifteen calls in half an hour is caught by the board
      // in the pause between hanging up and dialling again, which is most of
      // the time they are visible. Reported as its own state so that Standby
      // can go on meaning what it says.
      //
      // Only a completed CALL opens the window — a gap after a break, or after
      // timing in, is ordinary standby however recent, which is why this asks
      // whether the gap STARTED with a call rather than merely that one
      // happened today.
      if (calls.lastEndedAt && sinceIso === calls.lastEndedAt) {
        const gapSeconds = (Date.now() - new Date(calls.lastEndedAt).getTime()) / 1000;
        if (gapSeconds < BETWEEN_CALLS_SECONDS) state = "between_calls";
      }
    }

    // A finished day has no running stretch, so nothing counts up from it. The
    // states still describe how the day ended — timed out, on leave, absent —
    // but "For" is a live figure and there is no live to measure.
    if (!isToday) sinceIso = null;

    // Standby is what is left of the shift after talking and breaks. Computed
    // from the total elapsed shift rather than summed from gaps, so any time
    // unaccounted for lands here rather than silently disappearing.
    let standbyBaseSeconds = 0;
    if (attendance?.time_in) {
      // Now, for today. For a past day whose shift was never closed, the last
      // thing the agent actually did — running the clock to the present would
      // charge them every hour since as standby.
      const lastActivity = [attendance.break_end, calls.lastEndedAt, bios.lastEndedAt, attendance.time_in]
        .filter((t): t is string => Boolean(t))
        .reduce((latest, t) => (t > latest ? t : latest));
      const shiftEnd = attendance.time_out
        ? new Date(attendance.time_out).getTime()
        : isToday
          ? Date.now()
          : new Date(lastActivity).getTime();
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
      const liveStates: MonitorState[] = ["on_call", "bio_break", "break", "standby", "between_calls"];
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-page-title text-slate-900">Agent Monitoring</h1>
          {/* The same board, any day. Yesterday is the question people actually
              ask of it — "what did the floor do" — and it was answerable only
              by having been watching at the time. */}
          <MonitorDatePicker date={viewDate} today={today} />
        </div>
        <p className="text-sm text-slate-500">
          {isTeamLead ? "Your agents" : "All agents"} for {viewDate}
          {isToday ? "" : " — a finished day, so nothing is counting up"}.{" "}
          <span className="font-medium">Calling</span> says who is on the other end — a lead, or one of the agent&apos;s
          own regular customers. <span className="font-medium">Between calls</span> is the first three minutes after hanging
          up — dialling again, not idle. Standby is the rest of the shift time that is not a call and not a break —{" "}
          <span className="font-medium">For</span> is how long the current stretch has run,{" "}
          <span className="font-medium">Standby today</span> is the shift&apos;s total so far. Totals across a date
          range are in the Activity Report.
        </p>
      </div>
      <AgentMonitorBoard rows={rows} generatedAt={generatedAt} attendanceSource={attendanceSource} live={isToday} />
    </div>
  );
}
