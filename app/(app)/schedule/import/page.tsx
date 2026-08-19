import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { LinkButton } from "@/components/ui/Button";
import { ScheduleImportClient } from "@/components/ScheduleImportClient";
import { getCurrentUser } from "@/lib/auth";
import { readDbLite } from "@/lib/db";
import { can } from "@/lib/permissions";
import { scopeAgentsForSchedule, rosterAgents } from "@/lib/schedule-access";
import { ScheduleRosterBuilder } from "@/components/ScheduleRosterBuilder";
import { DUTY_STATUSES, shiftForStatus } from "@/lib/schedule-import";
import { cutoffFor } from "@/lib/cutoff";
import { todayInTz } from "@/lib/utils";

const TEMPLATE_HREF = "/api/schedule/template";

/**
 * Import a duty roster from a spreadsheet.
 *
 * The template is generated per user with their agent accounts already in it,
 * so the flow is download → fill in the shifts → upload. Gated on
 * schedules.create, the same grant that lets someone assign a shift by hand.
 */
export default async function ImportSchedulePage() {
  const user = (await getCurrentUser())!;
  const db = await readDbLite();

  if (!can(user.role, "schedules", "create", db.role_permissions)) {
    return <Alert kind="error">You do not have permission to import schedules.</Alert>;
  }

  const agentCount = scopeAgentsForSchedule(db, user).filter(
    (p) => p.role === "agent" && p.is_active && !p.is_deleted
  ).length;

  const workDay = { work_start: db.work_schedule.work_start, work_end: db.work_schedule.work_end };
  const halfDayEndsAt = shiftForStatus("HALF DAY", workDay).duty_end;

  // Named here rather than left to the download so the copy and the file agree:
  // /api/schedule/template with no parameters returns exactly this period.
  const currentCutoff = cutoffFor(todayInTz());

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-page-title text-slate-900">Create Schedule</h1>
        <LinkButton href="/schedule" variant="outline" size="sm">
          ← Back to roster
        </LinkButton>
      </div>

      {/* The roster itself, in the grid it is read in. Setting a cut-off used
          to mean downloading a spreadsheet, filling it in somewhere else and
          uploading it back — three steps and a file, to say who is off on
          Sunday. The Excel path is still below for a roster that arrives as a
          file, but it is no longer the only way in. */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Build the cut-off</CardTitle>
        </CardHeader>
        <CardContent>
          <ScheduleRosterBuilder agents={rosterAgents(db, user).map((a) => ({ id: a.id, full_name: a.full_name }))} />
        </CardContent>
      </Card>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Or import from Excel</h2>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>1. Download the roster template</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-600">
            The template comes with your {agentCount} agent account{agentCount === 1 ? "" : "s"} already listed — one
            row each, one column per date, covering{" "}
            <span className="font-medium">{currentCutoff.label}</span>, the cut-off the grid above opens on. Every date
            cell is a dropdown of {DUTY_STATUSES.join(", ")}, pre-set to ON DUTY and colour-coded, so you only change
            the exceptions. Leave a cell blank to say nothing about that day.
          </p>
          <p className="text-xs text-slate-500">
            ON DUTY and TRAINING run {db.work_schedule.work_start}–{db.work_schedule.work_end} (the company work
            schedule); HALF DAY ends at {halfDayEndsAt}; OFF and ON LEAVE are rest days. A shift outside those hours can
            still be typed as <span className="font-medium">08:00-17:00</span>.
          </p>
          {agentCount === 0 && (
            <Alert kind="warning">
              There are no active agent accounts in your scope yet, so the template would come out empty.
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <LinkButton href={TEMPLATE_HREF}>Download template (next week)</LinkButton>
            <LinkButton href={`${TEMPLATE_HREF}?days=14`} variant="outline">
              Two weeks
            </LinkButton>
            <LinkButton href={`${TEMPLATE_HREF}?days=31`} variant="outline">
              One month
            </LinkButton>
          </div>
          <p className="text-xs text-slate-400">
            Need a different range? Add <code>?start=YYYY-MM-DD&amp;days=N</code> to the template link.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Upload the filled-in roster</CardTitle>
        </CardHeader>
        <CardContent>
          <ScheduleImportClient
            templateHref={TEMPLATE_HREF}
            workDay={{ work_start: db.work_schedule.work_start, work_end: db.work_schedule.work_end }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
