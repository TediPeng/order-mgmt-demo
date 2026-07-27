import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDate, formatTime, todayInTz } from "@/lib/utils";
import { AnalogClock } from "@/components/AnalogClock";
import { BreakTimer } from "@/components/BreakTimer";
import { AttendanceStatusBadge, LateFlag, OverBreakFlag } from "@/components/ui/AttendanceBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select, Textarea } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";
import { timeInAction, timeOutAction, overrideAttendanceAction } from "@/lib/actions/attendance";

export default async function TimeClockPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; timedin?: string; timedout?: string; overridden?: string; breakstarted?: string; breakended?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDb();
  const today = todayInTz();
  const record = db.attendance.find((a) => a.user_id === user.id && a.work_date === today);
  const canOverride = can(user.role, "attendance", "approve", db.role_permissions);

  let status: React.ReactNode;
  if (!record) {
    status = <span className="text-slate-500">Not timed in</span>;
  } else if (!record.time_out) {
    status = (
      <span className="text-blue-700">
        Timed in at <span className="font-semibold">{formatTime(record.time_in)}</span>
      </span>
    );
  } else {
    status = (
      <span className="text-green-700">
        Completed: {formatTime(record.time_in)} – {formatTime(record.time_out)} ({record.total_hours} hrs)
      </span>
    );
  }

  const recentOverrides = db.attendance
    .filter((a) => a.overridden)
    .sort((a, b) => b.work_date.localeCompare(a.work_date))
    .slice(0, 10);
  const byId = new Map(db.profiles.map((p) => [p.id, p.full_name]));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Time In / Time Out</h1>

      {sp.error && <Alert kind="error">{sp.error}</Alert>}
      {sp.timedin && <Alert kind="success">Timed in successfully.</Alert>}
      {sp.timedout && <Alert kind="success">Timed out successfully.</Alert>}
      {sp.overridden && <Alert kind="success">Attendance override recorded.</Alert>}
      {sp.breakstarted && <Alert kind="success">Break started.</Alert>}
      {sp.breakended && <Alert kind="success">Break ended.</Alert>}

      <Card>
        <CardContent className="flex flex-col items-center gap-6 py-8">
          <AnalogClock />
          <div className="w-full max-w-xs text-center">
            <p className="mb-2 text-sm">{status}</p>
            {record && (
              <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
                <AttendanceStatusBadge status={record.status} />
                <LateFlag minutesLate={record.minutes_late} />
                <OverBreakFlag minutes={record.over_break_minutes} />
              </div>
            )}
            {record && (
              <p className="mb-3 text-xs text-slate-400">
                Scheduled {record.scheduled_time_in} – {record.scheduled_time_out}
                {record.minutes_late > 0 && ` · actual time-in ${formatTime(record.time_in)}`}
              </p>
            )}
            <div className="flex justify-center gap-2">
              <form action={timeInAction}>
                <input type="hidden" name="redirect_to" value="/attendance/clock" />
                <Button type="submit" disabled={!!record}>
                  Time In
                </Button>
              </form>
              <form action={timeOutAction}>
                <input type="hidden" name="redirect_to" value="/attendance/clock" />
                <Button type="submit" variant="secondary" disabled={!record || !!record?.time_out}>
                  Time Out
                </Button>
              </form>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Duplicate time-in/out is blocked automatically. Recorded times use server time in{" "}
              {db.work_schedule.timezone}.
            </p>
          </div>
        </CardContent>
      </Card>

      <BreakTimer
        breakStart={record?.break_start ?? null}
        breakEnd={record?.break_end ?? null}
        allowanceMinutes={db.work_schedule.break_minutes}
        canBreak={!!record && !record.time_out}
        redirectTo="/attendance/clock"
      />

      {canOverride && (
        <Card>
          <CardHeader>
            <CardTitle>Management Override</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-xs text-slate-500">
              Use this to correct a missed or duplicate time entry. A reason is required and every override is
              recorded in the audit log with the previous and updated values.
            </p>
            <form action={overrideAttendanceAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="user_id">Agent</Label>
                <Select id="user_id" name="user_id" required>
                  {db.profiles
                    .filter((p) => p.is_active)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                      </option>
                    ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="work_date">Date</Label>
                <Input id="work_date" name="work_date" type="date" defaultValue={today} required />
              </div>
              <div>
                <Label htmlFor="time_in">Time in</Label>
                <Input id="time_in" name="time_in" type="time" required />
              </div>
              <div>
                <Label htmlFor="time_out">Time out (optional)</Label>
                <Input id="time_out" name="time_out" type="time" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="reason">Reason</Label>
                <Textarea id="reason" name="reason" rows={2} required placeholder="e.g. Forgot to time out, corrected per agent request" />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit">Save Override</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {canOverride && recentOverrides.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Overrides</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Time In</th>
                  <th className="px-4 py-2">Time Out</th>
                  <th className="px-4 py-2">Overridden By</th>
                  <th className="px-4 py-2">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentOverrides.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-2">{byId.get(a.user_id) || "—"}</td>
                    <td className="px-4 py-2">{formatDate(a.work_date)}</td>
                    <td className="px-4 py-2">{formatTime(a.time_in)}</td>
                    <td className="px-4 py-2">{formatTime(a.time_out)}</td>
                    <td className="px-4 py-2">{a.overridden_by ? byId.get(a.overridden_by) || "—" : "—"}</td>
                    <td className="px-4 py-2 text-slate-500">{a.override_reason || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
