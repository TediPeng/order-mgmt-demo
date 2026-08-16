import Link from "next/link";
import { Download } from "lucide-react";
import { readDbLite } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { formatDate, formatTime, todayInTz } from "@/lib/utils";
import { AttendanceWidget } from "@/components/AttendanceWidget";
import { AttendanceCalendar } from "@/components/AttendanceCalendar";
import { RequestLeaveButton } from "@/components/RequestLeaveButton";
import { leaveCountsByDate, leavePickerWindow, maxApprovedPerDay } from "@/lib/leave";
import { BackToCallButton } from "@/components/BackToCallButton";
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

/** One day either side of a YYYY-MM-DD, in UTC so the arithmetic never lands on
 * a daylight-saving edge and repeats or skips a date. */
function shiftDay(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
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
  searchParams: Promise<{ error?: string; timedin?: string; timedout?: string; user?: string; month?: string; view?: string; date?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDbLite();
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

  // The six weeks the leave form's calendar draws.
  const leaveWindow = leavePickerWindow(todayStr);
  const leaveDays = leaveCountsByDate(db, leaveWindow.from, leaveWindow.to);

  const isTableView = sp.view === "table";
  // Everyone, for one day. The other two views answer "this person, this
  // month", which means picking a name from a dropdown before the page can
  // say anything — and the question actually asked most mornings is who came
  // in, and when. Rows are people here, so nobody is chosen first.
  const isEveryoneView = sp.view === "all" && canViewAll;
  const dayDate = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayStr;
  const dayByUserId: Record<string, Attendance> = Object.fromEntries(
    db.attendance.filter((a) => a.work_date === dayDate).map((a) => [a.user_id, a])
  );
  // The floor, and only the floor.
  //
  // Administrators and Team Leads are not on a shift the way an agent is, and
  // the System Administrator turned up in this table every single day. Test
  // accounts go for the same reason they are left out of the Leads scope: their
  // rows are real but they are not the floor's work.
  //
  // Decided by scope rather than by the word "agent", so somebody on a custom
  // role that only sees their own leads is counted with the agents — the same
  // rule the Leads page uses to pick which UI to show.
  const activeEmployees = pickableEmployees.filter(
    (p) => p.is_active && !p.is_deleted && !p.is_test_account && !isFullAccess(p.role) && p.role !== "team_lead"
  );
  // Only people who actually have a record for the day. Listing everybody else
  // underneath meant the table opened on a block of dashes — every account that
  // does not work the floor, every rest day, every not-yet — and the four lines
  // worth reading were above a screenful of nothing. How many are missing is
  // still said, in the line above the table, where it costs one sentence
  // instead of twenty rows.
  const dayRoster = activeEmployees
    .map((p) => ({ person: p, record: dayByUserId[p.id] as Attendance | undefined }))
    .filter((r): r is { person: (typeof activeEmployees)[number]; record: Attendance } => Boolean(r.record))
    .sort((a, b) => {
      const at = a.record.time_in || "";
      const bt = b.record.time_in || "";
      if (at && bt) return at.localeCompare(bt);
      if (at) return -1;
      if (bt) return 1;
      return a.person.full_name.localeCompare(b.person.full_name);
    });
  const timedInCount = dayRoster.filter((r) => r.record.time_in).length;
  const noRecordCount = activeEmployees.length - dayRoster.length;
  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  const qs = (overrides: Record<string, string | undefined>) => {
    const merged = { user: sp.user, month: sp.month, view: sp.view, date: sp.date, ...overrides };
    const params = new URLSearchParams();
    Object.entries(merged).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    return `?${params.toString()}`;
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-page-title text-slate-900">Attendance</h1>
        <div className="flex flex-wrap items-center gap-2">
          {/* An agent comes here mid-shift to start a break or check their
              hours. One call is open at a time and the popup that ends it lives
              in the leads table, so without this the way back is to remember
              which lead it was on. Renders nothing when no call is running. */}
          <BackToCallButton />
          {canFileLeave && <RequestLeaveButton action={fileLeaveAction} today={todayStr} leaveDays={leaveDays} cap={maxApprovedPerDay(db)} />}
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
        {/* The Everyone view reads one day, so it steps by days. The other two
            read one month and step by months — the same three controls, moving
            whichever unit is on screen. */}
        {isEveryoneView ? (
          <div className="flex items-center gap-2">
            <LinkButton href={qs({ date: shiftDay(dayDate, -1) })} variant="outline" size="sm">
              ← Previous
            </LinkButton>
            <span className="min-w-[10rem] text-center text-sm font-semibold text-slate-700">
              {formatDate(dayDate)}
            </span>
            <LinkButton href={qs({ date: shiftDay(dayDate, 1) })} variant="outline" size="sm">
              Next →
            </LinkButton>
            <LinkButton href={qs({ date: todayStr })} variant="secondary" size="sm">
              Today
            </LinkButton>
          </div>
        ) : (
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
        )}
        <div className="flex items-center gap-2">
          {/* No employee picker in the Everyone view — the whole point of it is
              that nobody has to be chosen before the page says anything. */}
          {canViewAll && !isEveryoneView && (
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
            {canViewAll && (
              <Link
                href={qs({ view: "all" })}
                className={`rounded px-2.5 py-1 font-medium ${isEveryoneView ? "bg-[var(--brand-primary)] text-white" : "text-slate-500 hover:bg-slate-100"}`}
              >
                Everyone
              </Link>
            )}
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

      {isEveryoneView ? (
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-medium text-slate-700">
              {timedInCount} timed in
              {noRecordCount > 0 && (
                <span className="ml-2 font-normal text-slate-400">
                  · {noRecordCount} with no record for this day
                </span>
              )}
            </p>
            <p className="text-xs text-slate-400">Earliest first.</p>
          </div>
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="sticky top-0 z-20 bg-slate-50 text-xs uppercase text-slate-500 shadow-sm">
                <tr>
                  <th className="px-4 py-3">Employee</th>
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
                {dayRoster.map(({ person, record }) => (
                  <tr key={person.id} className={record.time_in ? undefined : "bg-slate-50/60"}>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800">
                      {person.full_name}
                      {person.id === user.id && <span className="ml-1 text-xs font-normal text-slate-400">(You)</span>}
                    </td>
                    <td className="px-4 py-3">{record.time_in ? formatTime(record.time_in) : "—"}</td>
                    <td className="px-4 py-3">{record.time_out ? formatTime(record.time_out) : "—"}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {record.break_start ? `${formatTime(record.break_start)} – ${formatTime(record.break_end)}` : "—"}
                      {record.break_minutes != null && <span className="ml-1 text-xs">({record.break_minutes}m)</span>}
                    </td>
                    <td className="px-4 py-3">{record.total_hours ?? "—"}</td>
                    <td className="px-4 py-3">{record.overtime_hours > 0 ? record.overtime_hours : "—"}</td>
                    <td className="px-4 py-3">
                      <AttendanceStatusBadge status={record.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <LateFlag minutesLate={record.minutes_late} />
                        <OverBreakFlag minutes={record.over_break_minutes} />
                        {record.overridden && (
                          <span className="inline-flex rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                            Overridden
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {dayRoster.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                      No employees in your scope.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        <div className="lg:col-span-3">
          {isTableView ? (
            <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full min-w-[1000px] text-left text-sm">
                <thead className="sticky top-0 z-20 bg-slate-50 shadow-sm text-xs uppercase text-slate-500">
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
      )}
    </div>
  );
}
