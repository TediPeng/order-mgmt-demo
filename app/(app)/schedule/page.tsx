import { redirect } from "next/navigation";
import { readDbLite } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeAgentsForSchedule, scopeSchedules, scopeSuspensions, isDateWithinSuspension } from "@/lib/schedule-access";
import { todayInTz } from "@/lib/utils";
import { displayCallName } from "@/lib/types";
import { cutoffFor, shiftCutoff, datesIn, shortDate, weekdayOf, isWeekend } from "@/lib/cutoff";
import { Download, Upload, ChevronLeft, ChevronRight } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { ScheduleGrid, type ScheduleGridCells, type CellState } from "@/components/ScheduleGrid";
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

  const scopedAgents = scopeAgentsForSchedule(db, user);
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
    const state: CellState =
      s.status === "suspension" || s.suspension_id ? "suspended" : s.is_rest_day || s.status === "rest_day" ? "off" : "on_duty";
    cells[`${s.agent_id}|${s.schedule_date}`] = state;
  }
  // A suspension outranks whatever the roster says: the day is not workable,
  // and showing ON DUTY over it would have somebody expected on the floor.
  for (const s of suspensions) {
    for (const date of dates) {
      if (isDateWithinSuspension(s, date, date)) cells[`${s.employee_id}|${date}`] = "suspended";
    }
  }

  // The tiles stay on today, deliberately — they answer "who is on right now",
  // which does not become a different question because the grid is showing
  // next fortnight.
  const todayCells = scopedAgents.map((a) => cells[`${a.id}|${today}`] ?? "none");
  const onDutyToday = todayCells.filter((c) => c === "on_duty").length;
  const offToday = todayCells.filter((c) => c === "off").length;
  const suspendedToday = todayCells.filter((c) => c === "suspended").length;
  const unassignedToday = todayCells.filter((c) => c === "none").length;

  const columns = dates.map((date) => ({
    date,
    label: shortDate(date),
    weekday: weekdayOf(date),
    isWeekend: isWeekend(date),
    isToday: date === today,
  }));

  const qs = (start: string) => `/schedule?start=${start}`;

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
              <Upload className="h-4 w-4" /> Import Schedule
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

      <ScheduleGrid
        agents={scopedAgents.map((a) => ({
          id: a.id,
          name: a.full_name,
          callName: displayCallName(a) === a.full_name ? null : displayCallName(a),
        }))}
        columns={columns}
        cells={cells}
        canEdit={canEditGrid}
      />
    </div>
  );
}
