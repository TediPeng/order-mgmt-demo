import { redirect } from "next/navigation";
import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeAgentsForSchedule, scopeSchedules, scopeSuspensions, isDateWithinSuspension } from "@/lib/schedule-access";
import { todayInTz } from "@/lib/utils";
import { Download } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { ScheduleCalendar } from "@/components/ScheduleCalendar";
import { Button } from "@/components/ui/Button";
import { PrintButton } from "@/components/PrintButton";

export default async function SchedulePage() {
  const user = (await getCurrentUser())!;
  const db = readDb();

  if (!can(user.role, "schedules", "view", db.role_permissions)) redirect("/dashboard");
  const canCreate = can(user.role, "schedules", "create", db.role_permissions);
  const canEdit = can(user.role, "schedules", "edit", db.role_permissions);
  const canDelete = can(user.role, "schedules", "delete", db.role_permissions);
  const canBulk = can(user.role, "schedules", "assign", db.role_permissions);
  const canExport = can(user.role, "schedules", "export", db.role_permissions);

  const today = todayInTz();
  const scopedAgents = scopeAgentsForSchedule(db, user);
  const scopedAgentIds = new Set(scopedAgents.map((a) => a.id));

  const schedulesToday = scopeSchedules(user, db.schedules, db).filter((s) => s.schedule_date === today);
  const scheduledToday = schedulesToday.filter((s) => s.status === "scheduled").length;
  const restDayToday = schedulesToday.filter((s) => s.status === "rest_day").length;

  const suspendedEmployeeIds = new Set(
    scopeSuspensions(user, db.suspensions, db)
      .filter((s) => scopedAgentIds.has(s.employee_id) && isDateWithinSuspension(s, today, today))
      .map((s) => s.employee_id)
  );

  const assignedTodayIds = new Set(schedulesToday.map((s) => s.agent_id));
  const unassignedToday = scopedAgents.filter((a) => !assignedTodayIds.has(a.id) && !suspendedEmployeeIds.has(a.id)).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Schedule</h1>
        <div className="flex gap-2">
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

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Scheduled Today" value={scheduledToday} accent="text-green-700" />
        <StatCard label="Rest Day Today" value={restDayToday} accent="text-blue-700" />
        <StatCard label="Suspended" value={suspendedEmployeeIds.size} accent="text-orange-700" />
        <StatCard label="Unassigned" value={unassignedToday} accent="text-slate-500" />
      </div>

      <ScheduleCalendar
        agents={scopedAgents.map((a) => ({ id: a.id, full_name: a.full_name }))}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
        canBulk={canBulk}
      />
    </div>
  );
}
