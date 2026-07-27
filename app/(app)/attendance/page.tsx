import Link from "next/link";
import { Download } from "lucide-react";
import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDate, formatTime, todayInTz } from "@/lib/utils";
import { AttendanceWidget } from "@/components/AttendanceWidget";
import { AttendanceCalendar } from "@/components/AttendanceCalendar";
import { RequestLeaveButton } from "@/components/RequestLeaveButton";
import { AttendanceStatusBadge, LateFlag, OverBreakFlag } from "@/components/ui/AttendanceBadge";
import { Alert } from "@/components/ui/Alert";
import { Select } from "@/components/ui/Field";
import { Button, LinkButton } from "@/components/ui/Button";
import { fileLeaveAction } from "@/lib/actions/leave";
import type { Attendance, AttendanceStatus } from "@/lib/types";

function parseMonth(raw: string | undefined, todayStr: string): { year: number; month: number } {
  const m = raw && /^\d{4}-\d{2}$/.test(raw) ? raw : todayStr.slice(0, 7);
  const [y, mo] = m.split("-").map(Number);
  return { year: y, month: mo };
}

function monthRange(year: number, month: number): { from: string; to: string } {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

function shiftMonth(year: number, month: number, delta: number): string {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const SUMMARY_STATUSES: { key: AttendanceStatus; label: string }[] = [
  { key: "on_time", label: "Present (On Time)" },
  { key: "timed_out", label: "Present (Timed Out)" },
  { key: "late", label: "Late" },
  { key: "absent", label: "Absent" },
  { key: "on_leave", label: "On Leave" },
  { key: "wfh", label: "Work From Home" },
  { key: "rest_day", label: "Rest Days" },
];

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; timedin?: string; timedout?: string; user?: string; month?: string; view?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = readDb();
  const canViewAll = can(user.role, "attendance", "view", db.role_permissions);
  const canExport = can(user.role, "attendance", "export", db.role_permissions);
  const canManage = can(user.role, "attendance", "create", db.role_permissions);
  const canFileLeave = can(user.role, "leave", "create", db.role_permissions);

  const visibleUserIds =
    canViewAll && user.role === "team_lead"
      ? new Set([user.id, ...db.profiles.filter((p) => p.team_lead_id === user.id).map((p) => p.id)])
      : null;
  const pickableEmployees = db.profiles.filter((p) => !visibleUserIds || visibleUserIds.has(p.id));

  const targetUserId = canViewAll && sp.user && (!visibleUserIds || visibleUserIds.has(sp.user)) ? sp.user : user.id;
  const targetUser = db.profiles.find((p) => p.id === targetUserId) || user;

  const todayStr = todayInTz();
  const { year, month } = parseMonth(sp.month, todayStr);
  const { from, to } = monthRange(year, month);

  const monthRecords = db.attendance.filter((a) => a.user_id === targetUserId && a.work_date >= from && a.work_date <= to);
  const recordsByDate: Record<string, Attendance> = Object.fromEntries(monthRecords.map((r) => [r.work_date, r]));

  // Section 0.2: Rest Day derives from the schedule when no attendance row
  // (e.g. a manual override) already exists for that date.
  const restDayDates: Record<string, boolean> = Object.fromEntries(
    db.schedules
      .filter((s) => s.agent_id === targetUserId && s.is_rest_day && s.schedule_date >= from && s.schedule_date <= to)
      .map((s) => [s.schedule_date, true])
  );

  const summaryCounts = Object.fromEntries(SUMMARY_STATUSES.map((s) => [s.key, 0])) as Record<AttendanceStatus, number>;
  let totalHours = 0;
  let totalOvertime = 0;
  let totalOverBreak = 0;
  for (const r of monthRecords) {
    summaryCounts[r.status] = (summaryCounts[r.status] || 0) + 1;
    totalHours += r.total_hours || 0;
    totalOvertime += r.overtime_hours || 0;
    totalOverBreak += r.over_break_minutes || 0;
  }

  const isTableView = sp.view === "table";
  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  const qs = (overrides: Record<string, string | undefined>) => {
    const merged = { user: sp.user, month: sp.month, view: sp.view, ...overrides };
    const params = new URLSearchParams();
    Object.entries(merged).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    return `?${params.toString()}`;
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Attendance</h1>
        <div className="flex gap-2">
          {canFileLeave && <RequestLeaveButton action={fileLeaveAction} today={todayStr} />}
          {canManage && (
            <LinkButton href="/attendance/manage" variant="outline" size="sm">
              Manage Attendance
            </LinkButton>
          )}
        </div>
      </div>

      {sp.error && (
        <Alert kind="error" className="mb-4">
          {sp.error}
        </Alert>
      )}
      {sp.timedin && (
        <Alert kind="success" className="mb-4">
          Timed in successfully.
        </Alert>
      )}
      {sp.timedout && (
        <Alert kind="success" className="mb-4">
          Timed out successfully.
        </Alert>
      )}

      <div className="mb-6 max-w-sm">
        <AttendanceWidget user={user} redirectTo="/attendance" showClock />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <LinkButton href={qs({ month: shiftMonth(year, month, -1) })} variant="outline" size="sm">
            ← Previous
          </LinkButton>
          <span className="min-w-[10rem] text-center text-sm font-semibold text-slate-700">{monthLabel}</span>
          <LinkButton href={qs({ month: shiftMonth(year, month, 1) })} variant="outline" size="sm">
            Next →
          </LinkButton>
          <LinkButton href={qs({ month: todayStr.slice(0, 7) })} variant="secondary" size="sm">
            Today
          </LinkButton>
        </div>
        <div className="flex items-center gap-2">
          {canViewAll && (
            <form className="flex items-center gap-2">
              <input type="hidden" name="month" value={sp.month || ""} />
              <input type="hidden" name="view" value={sp.view || ""} />
              <Select name="user" defaultValue={targetUserId} className="w-52">
                {pickableEmployees.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                    {p.id === user.id ? " (You)" : ""}
                  </option>
                ))}
              </Select>
              <Button type="submit" variant="secondary" size="sm">
                View
              </Button>
            </form>
          )}
          <div className="flex rounded-md border border-slate-200 bg-white p-1 text-xs">
            <Link
              href={qs({ view: undefined })}
              className={`rounded px-2.5 py-1 font-medium ${!isTableView ? "bg-[var(--brand-primary)] text-white" : "text-slate-500 hover:bg-slate-100"}`}
            >
              Calendar
            </Link>
            <Link
              href={qs({ view: "table" })}
              className={`rounded px-2.5 py-1 font-medium ${isTableView ? "bg-[var(--brand-primary)] text-white" : "text-slate-500 hover:bg-slate-100"}`}
            >
              Table
            </Link>
          </div>
          {canExport && (
            <a href={`/api/attendance/export?${new URLSearchParams({ user: targetUserId, from, to }).toString()}`}>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4" /> Export CSV
              </Button>
            </a>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        <div className="lg:col-span-3">
          {isTableView ? (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full min-w-[1000px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Time In</th>
                    <th className="px-4 py-3">Time Out</th>
                    <th className="px-4 py-3">Break</th>
                    <th className="px-4 py-3">Total Hours</th>
                    <th className="px-4 py-3">Overtime</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Flags</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...monthRecords].sort((a, b) => b.work_date.localeCompare(a.work_date)).map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-3">{formatDate(r.work_date)}</td>
                      <td className="px-4 py-3">{formatTime(r.time_in)}</td>
                      <td className="px-4 py-3">{formatTime(r.time_out)}</td>
                      <td className="px-4 py-3 text-slate-500">
                        {r.break_start ? `${formatTime(r.break_start)} – ${formatTime(r.break_end)}` : "—"}
                        {r.break_minutes !== null && <span className="ml-1 text-xs">({r.break_minutes}m)</span>}
                      </td>
                      <td className="px-4 py-3">{r.total_hours ?? "—"}</td>
                      <td className="px-4 py-3">{r.overtime_hours > 0 ? r.overtime_hours : "—"}</td>
                      <td className="px-4 py-3">
                        <AttendanceStatusBadge status={r.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          <LateFlag minutesLate={r.minutes_late} />
                          <OverBreakFlag minutes={r.over_break_minutes} />
                          {r.overridden && (
                            <span className="inline-flex rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                              Overridden
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {monthRecords.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                        No attendance records for {monthLabel}.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <AttendanceCalendar
              year={year}
              month={month}
              recordsByDate={recordsByDate}
              restDayDates={restDayDates}
              today={todayStr}
              canEdit={canManage}
            />
          )}
        </div>

        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700">
            Monthly Summary
            {targetUser.id !== user.id && <span className="block text-xs font-normal text-slate-400">{targetUser.full_name}</span>}
          </h2>
          <ul className="space-y-1.5 text-sm">
            {SUMMARY_STATUSES.map((s) => (
              <li key={s.key} className="flex justify-between">
                <span className="text-slate-500">{s.label}</span>
                <span className="font-medium text-slate-800">{summaryCounts[s.key] || 0}</span>
              </li>
            ))}
          </ul>
          <div className="border-t border-slate-100 pt-2">
            <ul className="space-y-1.5 text-sm">
              <li className="flex justify-between">
                <span className="text-slate-500">Total Hours Worked</span>
                <span className="font-medium text-slate-800">{Math.round(totalHours * 100) / 100}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-slate-500">Total Overtime</span>
                <span className="font-medium text-slate-800">{Math.round(totalOvertime * 100) / 100}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-slate-500">Total Over-Break (min)</span>
                <span className="font-medium text-slate-800">{totalOverBreak}</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
