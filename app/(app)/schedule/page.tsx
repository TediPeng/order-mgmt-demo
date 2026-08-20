import { redirect } from "next/navigation";
import { readDbLite } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { rosterAgents, scopeSchedules, scopeSuspensions, isDateWithinSuspension } from "@/lib/schedule-access";
import { todayInTz } from "@/lib/utils";
import { displayCallName } from "@/lib/types";
import { cutoffFor, shiftCutoff, datesIn, shortDate, weekdayOf, isWeekend } from "@/lib/cutoff";
import { statusOf } from "@/lib/duty-status";
import { Download, Upload, ChevronLeft, ChevronRight } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { ScheduleGrid, type ScheduleGridCells, type CellState } from "@/components/ScheduleGrid";
import { RosterHeadsUp } from "@/components/RosterHeadsUp";
import { ScheduleBulkActions } from "@/components/ScheduleBulkActions";
import { Button, LinkButton } from "@/components/ui/Button";
import { PrintButton } from "@/components/PrintButton";

/**
 * The duty roster, one cut-off at a time.
 *
 * Cut-offs run the 13th to the 27th and the 28th to the 12th, so half of them
 * straddle two months — which is why a month calendar could not show one and
 * why the real roster was living in a spreadsheet next to the app. The grid is
 * that spreadsheet: agents down, days across, ON DUTY or OFF in every cell.
 */
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDbLite();

  if (!can(user.role, "schedules", "view", db.role_permissions)) redirect("/dashboard");
  const canCreate = can(user.role, "schedules", "create", db.role_permissions);
  const canEdit = can(user.role, "schedules", "edit", db.role_permissions);
  const canExport = can(user.role, "schedules", "export", db.role_permissions);
  const canBulk = can(user.role, "schedules", "assign", db.role_permissions);
  // A cell writes through POST (create/replace) and DELETE (clear), so editing
  // the grid needs all three rather than `edit` alone.
  const canEditGrid = canCreate && canEdit && can(user.role, "schedules", "delete", db.role_permissions);

  const today = todayInTz();
  // `start` is the first day of a cut-off, which is where the arrows point.
  // Anything else — a hand-typed date, a stale link — is snapped to the period
  // that contains it rather than refused.
  const cutoff = cutoffFor(sp.start || today);
  const previous = shiftCutoff(cutoff, -1);
  const next = shiftCutoff(cutoff, 1);
  const dates = datesIn(cutoff);

  // Agents on the floor, not everyone the API would let you write to:
  // Administrators, Team Leads and test accounts are not on a duty roster.
  const scopedAgents = rosterAgents(db, user);
  const scopedAgentIds = new Set(scopedAgents.map((a) => a.id));
  const agentOptions = scopedAgents.map((a) => ({ id: a.id, full_name: a.full_name }));

  // Every suspension touching this period, so a suspended day reads as one
  // rather than as an ordinary rest day.
  const suspensions = scopeSuspensions(user, db.suspensions, db).filter((s) => scopedAgentIds.has(s.employee_id));

  const inCutoff = scopeSchedules(user, db.schedules, db).filter(
    (s) => s.schedule_date >= cutoff.start && s.schedule_date <= cutoff.end
  );

  const cells: ScheduleGridCells = {};
  for (const s of inCutoff) {
    if (!scopedAgentIds.has(s.agent_id)) continue;
    // statusOf() is the same reading the spreadsheet import writes, so Half
    // Day, On Leave and Training survive a round trip through either route.
    cells[`${s.agent_id}|${s.schedule_date}`] = statusOf(s) as CellState;
  }
  // A suspension outranks whatever the roster says: the day is not workable,
  // and showing ON DUTY over it would have somebody expected on the floor.
  for (const s of suspensions) {
    for (const date of dates) {
      if (isDateWithinSuspension(s, date, date)) cells[`${s.employee_id}|${date}`] = "SUSPENDED";
    }
  }

  /**
   * Approved leave, laid over the same period.
   *
   * Unlike a suspension this does not replace the cell — the roster may
   * legitimately say something else and only a person can settle it — so it
   * arrives as a mark the grid draws on top. It was not read here at all
   * before: leave is written to attendance on approval and never to the roster,
   * so a supervisor reading a fortnight had no way to see who was already off.
   */
  const approvedLeave = db.leave_requests.filter(
    (r) => r.status === "approved" && scopedAgentIds.has(r.agent_id) && r.leave_start <= cutoff.end && r.leave_end >= cutoff.start
  );
  const leaveDays: Record<string, string> = {};
  for (const leave of approvedLeave) {
    for (const date of dates) {
      if (date >= leave.leave_start && date <= leave.leave_end) leaveDays[`${leave.agent_id}|${date}`] = leave.leave_type;
    }
  }

  /**
   * A day nobody has rostered, on which the agent's leave is already approved,
   * reads as ON LEAVE — derived, exactly as a suspended day is.
   *
   * Nothing is written to do this. The leave is a fact the roster does not hold
   * (approval writes to attendance, never to schedules) and the alternative was
   * a dash: the grid said "nothing decided here" about a day that had been
   * decided a week earlier by a Team Lead. A dash is what invites somebody to
   * fill it with ON DUTY.
   *
   * Only over an empty cell. If the roster actually says something — even ON
   * DUTY over the leave — that is a real entry somebody made, and overwriting
   * it on the way to the screen would hide a clash rather than show it. Those
   * keep their own status and take the amber mark instead.
   */
  for (const key of Object.keys(leaveDays)) {
    if (!cells[key]) cells[key] = "ON LEAVE";
  }

  // The tiles stay on today, deliberately — they answer "who is on right now",
  // which does not become a different question because the grid is showing
  // next fortnight.
  const todayCells = scopedAgents.map((a) => cells[`${a.id}|${today}`] ?? "NONE");
  // Half Day and Training are working days, so they count as on duty here —
  // the tile answers "how many are on the floor", not "what does the row say".
  const onDutyToday = todayCells.filter((c) => c === "ON DUTY" || c === "HALF DAY" || c === "TRAINING").length;
  const offToday = todayCells.filter((c) => c === "OFF" || c === "ON LEAVE").length;
  const suspendedToday = todayCells.filter((c) => c === "SUSPENDED").length;
  const unassignedToday = todayCells.filter((c) => c === "NONE").length;

  const columns = dates.map((date) => ({
    date,
    label: shortDate(date),
    weekday: weekdayOf(date),
    isWeekend: isWeekend(date),
    isToday: date === today,
  }));

  const qs = (start: string) => `/schedule?start=${start}`;

  // The chips above the grid, one per person per stretch. Clamped to the period
  // on screen so a month-long suspension does not read as one.
  const nameOf = (id: string) => scopedAgents.find((a) => a.id === id)?.full_name || "Unknown";
  const clampSpan = (from: string, to: string) => {
    const a = from < cutoff.start ? cutoff.start : from;
    const b = to > cutoff.end ? cutoff.end : to;
    return a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}`;
  };

  const suspendedChips = suspensions
    .filter((s) => dates.some((d) => isDateWithinSuspension(s, d, d)))
    .map((s) => ({
      key: `${s.employee_id}|${s.start_date}`,
      name: nameOf(s.employee_id),
      span: clampSpan(s.start_date, s.end_date),
      title: `Suspension: ${s.reason}`,
    }));

  const leaveChips = approvedLeave.map((r) => ({
    key: `${r.agent_id}|${r.leave_start}|${r.leave_end}`,
    name: nameOf(r.agent_id),
    span: clampSpan(r.leave_start, r.leave_end),
    title: `${r.leave_type} leave, approved`,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-page-title text-slate-900">Schedule</h1>
        <div className="flex flex-wrap gap-2">
          {/* How a cut-off gets filled, as against how one day gets corrected.
              These sat on the calendar's toolbar until it was removed. */}
          {canBulk && <ScheduleBulkActions agents={agentOptions} />}
          {canCreate && (
            <LinkButton href="/schedule/import" variant="outline" size="sm">
              <Upload className="h-4 w-4" /> Create Schedule
            </LinkButton>
          )}
          {canExport && (
            <a href="/api/schedule/export">
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4" /> Export CSV
              </Button>
            </a>
          )}
          <PrintButton />
        </div>
      </div>

      {/* The period, and the way to the ones either side. Cut-offs are what the
          floor plans in, so the heading names one rather than a month. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <LinkButton href={qs(previous.start)} variant="outline" size="sm" aria-label="Previous cut-off">
            <ChevronLeft className="h-4 w-4" /> {previous.shortLabel}
          </LinkButton>
          <div className="px-2 text-center">
            <p className="text-sm font-semibold text-slate-900">{cutoff.label}</p>
            <p className="text-xs text-slate-400">
              Cut-off · {dates.length} days
              {today >= cutoff.start && today <= cutoff.end ? " · current" : ""}
            </p>
          </div>
          <LinkButton href={qs(next.start)} variant="outline" size="sm" aria-label="Next cut-off">
            {next.shortLabel} <ChevronRight className="h-4 w-4" />
          </LinkButton>
        </div>
        {(sp.start || "") !== "" && today >= cutoff.start && today <= cutoff.end ? null : (
          <LinkButton href="/schedule" variant="secondary" size="sm">
            Go to current cut-off
          </LinkButton>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="On Duty Today" value={onDutyToday} accent="text-green-700" />
        <StatCard label="Off Today" value={offToday} accent="text-red-700" />
        <StatCard label="Suspended" value={suspendedToday} accent="text-orange-700" />
        <StatCard label="Unassigned Today" value={unassignedToday} accent="text-slate-500" />
      </div>

      {/* Before the grid, deliberately. Who cannot be rostered and who is
          already spoken for is what the fortnight has to be built around, and
          reading it off three hundred cells is the slow way to find out. */}
      <RosterHeadsUp periodLabel={cutoff.shortLabel} suspended={suspendedChips} leave={leaveChips} />

      <ScheduleGrid
        agents={scopedAgents.map((a) => ({
          id: a.id,
          name: a.full_name,
          callName: displayCallName(a) === a.full_name ? null : displayCallName(a),
        }))}
        columns={columns}
        cells={cells}
        canEdit={canEditGrid}
        leaveDays={leaveDays}
      />
    </div>
  );
}
