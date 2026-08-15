import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { AnalogClock } from "@/components/AnalogClock";
import { formatTime, todayInTz } from "@/lib/utils";
import { readDbLite } from "@/lib/db";
import type { Profile } from "@/lib/types";
import { timeInAction, timeOutAction } from "@/lib/actions/attendance";

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
        <Link href="/attendance/clock" className="text-xs font-medium text-[var(--brand-primary)] hover:underline">
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
        {record?.time_out ? (
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
