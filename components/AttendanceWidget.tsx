import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { AnalogClock } from "@/components/AnalogClock";
import { formatTime, todayInTz } from "@/lib/utils";
import { readDbLite } from "@/lib/db";
import type { Profile } from "@/lib/types";
import { timeInAction, timeOutAction } from "@/lib/actions/attendance";
import { portalClockUrl, portalOwnsAttendance } from "@/lib/portal-attendance";

export async function AttendanceWidget({
  user,
  redirectTo = "/dashboard",
  showClock = false,
}: {
  user: Profile;
  redirectTo?: string;
  showClock?: boolean;
}) {
  // Lite: this widget reads one attendance row. Through the full read it was
  // pulling every order in the system into the render of a clock — the single
  // biggest cost left on the dashboard once the cards were moved to SQL.
  const db = await readDbLite();
  const today = todayInTz();
  const record = db.attendance.find((a) => a.user_id === user.id && a.work_date === today);

  // This card sits on the Dashboard, so it is the one place the clock survives
  // hiding the nav item -- and the dangerous one. A time-in taken here writes
  // ROMA's row without the portal's, which is the record that pays them: the
  // agent would work a full day, satisfy ROMA's gate, and be absent from
  // payroll. So the buttons go where the menu entry goes.
  //
  // What is shown instead is still the day: the status line above is the
  // mirrored row, which is the same fact, just written by the portal.
  // Two separate questions, and conflating them is what left the buttons live.
  //
  // `movedToPortal` decides whether the buttons appear at all, and depends only
  // on the portal owning the clock. `clockUrl` is where to send somebody
  // instead, and is null until PORTAL_APP_URL is configured — which it was not,
  // so this card went on offering a working Time In on the Attendance page long
  // after the menu entry had gone.
  const movedToPortal = portalOwnsAttendance();
  const clockUrl = portalClockUrl();

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

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Today&apos;s Attendance</CardTitle>
        <Link
          href={clockUrl ?? "/attendance/clock"}
          className="text-xs font-medium text-[var(--brand-primary)] hover:underline"
        >
          Time Clock
        </Link>
      </CardHeader>
      <CardContent>
        {showClock && (
          <div className="mb-4 flex justify-center">
            <AnalogClock />
          </div>
        )}
        <p className="mb-4 text-sm">{status}</p>
        {/* The day is over: both buttons would be dead, and two dead buttons are
            worse than none — they invite a press that does nothing and leave the
            reader to work out why. The card already says Completed above this,
            with the hours and the badge. */}
        {movedToPortal ? (
          <div className="space-y-2">
            {clockUrl && (
              <Link href={clockUrl}>
                <Button type="button">Time In / Out in the Portal</Button>
              </Link>
            )}
            <p className="text-xs text-slate-400">
              The clock is kept in the company portal now — that is the record you are paid from. What shows here
              follows it.
            </p>
          </div>
        ) : record?.time_out ? (
          <p className="text-sm text-slate-400">
            Your day is recorded. Ask Management for an override if something here is wrong.
          </p>
        ) : (
          <div className="flex gap-2">
            <form action={timeInAction}>
              <input type="hidden" name="redirect_to" value={redirectTo} />
              <Button type="submit" disabled={!!record}>
                Time In
              </Button>
            </form>
            <form action={timeOutAction}>
              <input type="hidden" name="redirect_to" value={redirectTo} />
              <Button type="submit" variant="secondary" disabled={!record}>
                Time Out
              </Button>
            </form>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
