import { redirect } from "next/navigation";
import { readDbLite } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeAgentsForSchedule } from "@/lib/schedule-access";
import { CalendarDays, Table2 } from "lucide-react";
import { ScheduleCalendar } from "@/components/ScheduleCalendar";
import { LinkButton } from "@/components/ui/Button";

/**
 * The month calendar, kept as the second view.
 *
 * The cut-off grid replaced it as the way the roster is read — a cut-off
 * straddles two months, which a month view cannot show. But bulk assign and
 * copy-schedule live in here, and those are how a fortnight gets filled in the
 * first place, so removing the calendar would have taken two working features
 * with it.
 */
export default async function ScheduleCalendarPage() {
  const user = (await getCurrentUser())!;
  const db = await readDbLite();

  if (!can(user.role, "schedules", "view", db.role_permissions)) redirect("/dashboard");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-slate-400" aria-hidden />
          <h1 className="text-page-title text-slate-900">Schedule — Calendar</h1>
        </div>
        <LinkButton href="/schedule" variant="outline" size="sm">
          <Table2 className="h-4 w-4" /> Cut-off grid
        </LinkButton>
      </div>

      <ScheduleCalendar
        agents={scopeAgentsForSchedule(db, user).map((a) => ({ id: a.id, full_name: a.full_name }))}
        canCreate={can(user.role, "schedules", "create", db.role_permissions)}
        canEdit={can(user.role, "schedules", "edit", db.role_permissions)}
        canDelete={can(user.role, "schedules", "delete", db.role_permissions)}
        canBulk={can(user.role, "schedules", "assign", db.role_permissions)}
      />
    </div>
  );
}
