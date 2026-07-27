import type { AttendanceStatus } from "./types";

function getTzOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  parts.forEach((p) => (map[p.type] = p.value));
  const hour = map.hour === "24" ? "00" : map.hour;
  const asUTC = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(hour), Number(map.minute), Number(map.second));
  return (asUTC - date.getTime()) / 60000;
}

/** Absolute instant corresponding to `HH:mm` on `workDate` (YYYY-MM-DD), in `timeZone`. */
export function scheduledInstant(workDate: string, hhmm: string, timeZone: string): Date {
  const naiveUTC = new Date(`${workDate}T${hhmm}:00Z`);
  const offsetMin = getTzOffsetMinutes(naiveUTC, timeZone);
  return new Date(naiveUTC.getTime() - offsetMin * 60000);
}

/** Minutes late relative to the scheduled time-in; 0 if on time or early. */
export function computeMinutesLate(timeInIso: string, workDate: string, scheduledTimeIn: string, timeZone: string): number {
  const scheduled = scheduledInstant(workDate, scheduledTimeIn, timeZone);
  const actual = new Date(timeInIso);
  const diffMinutes = Math.round((actual.getTime() - scheduled.getTime()) / 60000);
  return diffMinutes > 0 ? diffMinutes : 0;
}

export function computeMinutesBetween(startIso: string, endIso: string): number {
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
}

/** Hours worked beyond the scheduled time-out (Section 0.6); 0 if timed out at or before schedule. */
export function computeOvertimeHours(timeOutIso: string, workDate: string, scheduledTimeOut: string, timeZone: string): number {
  const scheduled = scheduledInstant(workDate, scheduledTimeOut, timeZone);
  const actual = new Date(timeOutIso);
  const diffHours = (actual.getTime() - scheduled.getTime()) / 3600000;
  return diffHours > 0 ? Math.round(diffHours * 100) / 100 : 0;
}

export const STATUS_LABELS: Record<AttendanceStatus, string> = {
  on_time: "On Time",
  late: "Late",
  absent: "Absent",
  on_leave: "On Leave",
  half_day: "Half Day",
  over_break: "Over Break",
  timed_out: "Timed Out",
  wfh: "Work From Home",
  rest_day: "Rest Day",
  suspended: "Suspended",
};

export const STATUS_COLORS: Record<AttendanceStatus, string> = {
  on_time: "bg-green-100 text-green-700",
  late: "bg-amber-100 text-amber-700",
  absent: "bg-red-100 text-red-700",
  on_leave: "bg-orange-100 text-orange-700",
  half_day: "bg-orange-100 text-orange-700",
  over_break: "bg-red-100 text-red-700",
  timed_out: "bg-slate-200 text-slate-600",
  wfh: "bg-blue-100 text-blue-700",
  rest_day: "bg-slate-100 text-slate-500",
  suspended: "bg-orange-200 text-orange-900",
};

/** Calendar-day fill colors per Section 4 of the attendance calendar spec
 * (present=green, absent=red, late=yellow, on_leave=orange, wfh=blue, rest_day=white/gray). */
export const CALENDAR_DAY_COLORS: Record<AttendanceStatus, string> = {
  on_time: "bg-green-500",
  timed_out: "bg-green-500",
  absent: "bg-red-500",
  late: "bg-yellow-500",
  on_leave: "bg-orange-500",
  half_day: "bg-orange-400",
  over_break: "bg-red-400",
  wfh: "bg-blue-500",
  rest_day: "bg-slate-300",
  suspended: "bg-orange-700",
};
