import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { LinkButton } from "@/components/ui/Button";
import { ScheduleImportClient } from "@/components/ScheduleImportClient";
import { getCurrentUser } from "@/lib/auth";
import { readDb } from "@/lib/db";
import { can } from "@/lib/permissions";
import { scopeAgentsForSchedule } from "@/lib/schedule-access";

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
  const db = await readDb();

  if (!can(user.role, "schedules", "create", db.role_permissions)) {
    return <Alert kind="error">You do not have permission to import schedules.</Alert>;
  }

  const agentCount = scopeAgentsForSchedule(db, user).filter(
    (p) => p.role === "agent" && p.is_active && !p.is_deleted
  ).length;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-page-title text-slate-900">Import Schedule</h1>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>1. Download the roster template</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-600">
            The template comes with your {agentCount} agent account{agentCount === 1 ? "" : "s"} already listed — one
            row each, one column per date, defaulting to next Monday through Sunday. Fill each cell with a shift like{" "}
            <span className="font-medium text-slate-700">08:00-17:00</span>, or{" "}
            <span className="font-medium text-slate-700">REST</span> for a rest day. Leave a cell blank to say nothing
            about that day.
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
          <ScheduleImportClient templateHref={TEMPLATE_HREF} />
        </CardContent>
      </Card>
    </div>
  );
}
