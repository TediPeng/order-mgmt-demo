import { redirect } from "next/navigation";
import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { updateThresholdsAction, updateWorkScheduleAction } from "@/lib/actions/settings";

export default async function SystemSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = readDb();

  if (!can(user.role, "settings", "view", db.role_permissions)) redirect("/dashboard");
  const canManage = can(user.role, "settings", "manage", db.role_permissions);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">System Settings</h1>

      {sp.saved && <Alert kind="success">Settings updated.</Alert>}
      {sp.error && <Alert kind="error">{sp.error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Work schedule &amp; attendance</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updateWorkScheduleAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="work_start">Scheduled time in</Label>
              <Input id="work_start" name="work_start" type="time" defaultValue={db.work_schedule.work_start} disabled={!canManage} required />
            </div>
            <div>
              <Label htmlFor="work_end">Scheduled time out</Label>
              <Input id="work_end" name="work_end" type="time" defaultValue={db.work_schedule.work_end} disabled={!canManage} required />
            </div>
            <div>
              <Label htmlFor="break_minutes">Break allowance (minutes)</Label>
              <Input
                id="break_minutes"
                name="break_minutes"
                type="number"
                min={1}
                max={240}
                defaultValue={db.work_schedule.break_minutes}
                disabled={!canManage}
                required
              />
            </div>
            <div className="sm:col-span-2 space-y-2">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  name="auto_mark_absent"
                  defaultChecked={db.work_schedule.auto_mark_absent}
                  disabled={!canManage}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Automatically mark agents Absent for past work days with no time-in recorded
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  name="require_attachment_for_sick_leave"
                  defaultChecked={db.work_schedule.require_attachment_for_sick_leave}
                  disabled={!canManage}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Require a supporting document when filing Sick leave
              </label>
            </div>
            {canManage && (
              <div className="sm:col-span-2">
                <Button type="submit">Save Work Schedule</Button>
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Performance status thresholds</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-xs text-slate-500">
            Used on the Agent Ranking page to badge agents as Top Performer / On Track / Needs Improvement, relative
            to the team average for the selected ranking metric.
          </p>
          <form action={updateThresholdsAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="top_performer_min_ratio">Top Performer threshold (× team average)</Label>
              <Input
                id="top_performer_min_ratio"
                name="top_performer_min_ratio"
                type="number"
                step={0.05}
                min={1.01}
                defaultValue={db.performance_thresholds.top_performer_min_ratio}
                disabled={!canManage}
                required
              />
            </div>
            <div>
              <Label htmlFor="needs_improvement_max_ratio">Needs Improvement threshold (× team average)</Label>
              <Input
                id="needs_improvement_max_ratio"
                name="needs_improvement_max_ratio"
                type="number"
                step={0.05}
                min={0.01}
                max={0.99}
                defaultValue={db.performance_thresholds.needs_improvement_max_ratio}
                disabled={!canManage}
                required
              />
            </div>
            <div>
              <Label htmlFor="rts_warning_threshold_pct">RTS % warning threshold (Returned Qty ÷ Delivered Qty)</Label>
              <Input
                id="rts_warning_threshold_pct"
                name="rts_warning_threshold_pct"
                type="number"
                step={1}
                min={1}
                max={100}
                defaultValue={db.performance_thresholds.rts_warning_threshold_pct}
                disabled={!canManage}
                required
              />
              <p className="mt-1 text-xs text-slate-400">RTS % above this value is styled as a warning on dashboards (lower is better).</p>
            </div>
            {canManage && (
              <div className="sm:col-span-2">
                <Button type="submit">Save Thresholds</Button>
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Environment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-slate-600">
          <p>
            <span className="font-medium text-slate-800">Attendance timezone:</span>{" "}
            {process.env.APP_TIMEZONE || "Asia/Manila"} (set via the <code className="font-mono">APP_TIMEZONE</code>{" "}
            environment variable)
          </p>
          <p>
            <span className="font-medium text-slate-800">System roles:</span>{" "}
            {db.roles.map((r) => r.name).join(", ")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
