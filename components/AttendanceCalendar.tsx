"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { CALENDAR_DAY_COLORS, STATUS_LABELS } from "@/lib/attendance-logic";
import { formatTime } from "@/lib/utils";
import type { Attendance } from "@/lib/types";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const LEGEND: { color: string; label: string }[] = [
  { color: "bg-green-500", label: "Present" },
  { color: "bg-yellow-500", label: "Late" },
  { color: "bg-red-500", label: "Absent" },
  { color: "bg-orange-500", label: "On Leave" },
  { color: "bg-blue-500", label: "Work From Home" },
  { color: "bg-slate-300", label: "Rest Day" },
];

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function AttendanceCalendar({
  year,
  month, // 1-12
  recordsByDate,
  restDayDates = {},
  today,
  canEdit,
}: {
  year: number;
  month: number;
  recordsByDate: Record<string, Attendance>;
  /** Dates with a schedule marked Rest Day but no attendance row yet -- the
   * calendar derives Rest Day from the schedule (Section 0.2) unless an actual
   * attendance record (e.g. a manual override) already exists for that date. */
  restDayDates?: Record<string, boolean>;
  today: string;
  canEdit: boolean;
}) {
  const [openDate, setOpenDate] = useState<string | null>(null);

  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const startWeekday = firstOfMonth.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells: (string | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(ymd(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const openRecord = openDate ? recordsByDate[openDate] : null;
  const derivedRestDayForOpen = openDate && !openRecord && restDayDates[openDate];

  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} className="px-2 py-2 text-center">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((date, idx) => {
            if (!date) return <div key={idx} className="h-20 border-b border-r border-slate-100 bg-slate-50/50 sm:h-24" />;
            const rec = recordsByDate[date];
            const derivedRestDay = !rec && restDayDates[date];
            const dayNum = Number(date.slice(8, 10));
            const isToday = date === today;
            return (
              <button
                key={date}
                type="button"
                onClick={() => setOpenDate(date)}
                className={`flex h-20 flex-col items-start gap-1 border-b border-r border-slate-100 p-2 text-left transition-colors hover:bg-slate-50 motion-reduce:transition-none sm:h-24 ${
                  isToday ? "ring-2 ring-inset ring-[var(--brand-primary)]" : ""
                }`}
              >
                <span className={`text-xs font-medium ${isToday ? "text-[var(--brand-primary)]" : "text-slate-600"}`}>{dayNum}</span>
                {rec && (
                  <span className="flex items-center gap-1">
                    <span className={`h-2.5 w-2.5 rounded-full ${CALENDAR_DAY_COLORS[rec.status]}`} />
                    {rec.status === "over_break" || rec.over_break_minutes > 0 ? (
                      <span className="h-2.5 w-2.5 rounded-full bg-orange-400" title="Over Break" />
                    ) : null}
                  </span>
                )}
                {derivedRestDay && <span className={`h-2.5 w-2.5 rounded-full ${CALENDAR_DAY_COLORS.rest_day}`} title="Rest Day (from schedule)" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
        {LEGEND.map((l) => (
          <span key={l.label} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${l.color}`} /> {l.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-orange-400" /> Over Break
        </span>
      </div>

      {openDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpenDate(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h3 className="text-sm font-semibold text-slate-800">{openDate}</h3>
              <button type="button" onClick={() => setOpenDate(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 p-5 text-sm">
              {openRecord ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Status</span>
                    <span className="font-medium text-slate-800">{STATUS_LABELS[openRecord.status]}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Time In</span>
                    <span className="font-medium text-slate-800">{formatTime(openRecord.time_in)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Time Out</span>
                    <span className="font-medium text-slate-800">{formatTime(openRecord.time_out)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Break Start</span>
                    <span className="font-medium text-slate-800">{formatTime(openRecord.break_start)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Break End</span>
                    <span className="font-medium text-slate-800">{formatTime(openRecord.break_end)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Total Break Time</span>
                    <span className="font-medium text-slate-800">{openRecord.break_minutes != null ? `${openRecord.break_minutes} min` : "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Total Working Hours</span>
                    <span className="font-medium text-slate-800">{openRecord.total_hours ?? "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Late Duration</span>
                    <span className="font-medium text-slate-800">{openRecord.minutes_late > 0 ? `${openRecord.minutes_late} min` : "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Overtime Hours</span>
                    <span className="font-medium text-slate-800">{openRecord.overtime_hours > 0 ? openRecord.overtime_hours : "—"}</span>
                  </div>
                  <div>
                    <p className="text-slate-500">Remarks</p>
                    <p className="mt-1 font-medium text-slate-800">{openRecord.remarks || "—"}</p>
                  </div>
                  {canEdit && (
                    <Link
                      href={`/attendance/manage?edit=${openRecord.id}`}
                      className="mt-2 block rounded-md bg-[var(--brand-primary)] px-3 py-2 text-center text-sm font-medium text-white hover:opacity-90"
                    >
                      Edit Record
                    </Link>
                  )}
                </>
              ) : derivedRestDayForOpen ? (
                <p className="py-6 text-center text-slate-400">Rest Day (from the agent's schedule).</p>
              ) : (
                <p className="py-6 text-center text-slate-400">No attendance record for this date.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
