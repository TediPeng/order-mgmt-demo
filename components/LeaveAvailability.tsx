"use client";

import type { LeaveDayCount } from "@/lib/leave";

/**
 * How many people are already off, day by day, beside the date fields.
 *
 * The question an agent asks before picking a date is whether anybody else is
 * already off then, and the only way to find out was to ask a Team Lead. This
 * answers it while they are choosing rather than after they have filed.
 *
 * Counts only, never names: how many are off is what the decision needs, and who
 * they are is their colleagues' business.
 *
 * Nothing here blocks anything. No rule in this system caps leave per day, so a
 * busy date is a thing to know rather than a thing forbidden — presenting it as
 * a limit would invent a policy the company has not set.
 */
export function LeaveAvailability({
  days,
  start,
  end,
}: {
  days: LeaveDayCount[];
  /** The range currently typed into the form, for marking the rows it covers. */
  start: string;
  end: string;
}) {
  if (days.length === 0) return null;

  const label = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      weekday: "short",
      timeZone: "UTC",
    });

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Ilan ang naka-leave</p>

      <ul className="max-h-48 space-y-1 overflow-auto">
        {days.map((d) => {
          const total = d.approved + d.pending;
          // Inside the range being asked for. Those are the rows the agent is
          // actually deciding about; the rest are context.
          const picked = Boolean(start && end && d.date >= start && d.date <= end);
          const tone =
            total === 0
              ? "border-green-200 bg-green-50 text-green-800"
              : total === 1
                ? "border-slate-200 bg-white text-slate-700"
                : "border-amber-200 bg-amber-50 text-amber-900";

          return (
            <li
              key={d.date}
              className={`flex items-center justify-between gap-3 rounded-md border px-2.5 py-1.5 text-xs ${tone} ${
                picked ? "ring-1 ring-[var(--brand-primary)]" : ""
              }`}
            >
              <span className="font-medium">{label(d.date)}</span>
              <span className="flex items-center gap-1.5">
                {total === 0 ? (
                  <span className="font-medium">Walang naka-leave</span>
                ) : (
                  <>
                    {d.approved > 0 && (
                      <span className="rounded-full bg-white/70 px-1.5 py-0.5 font-semibold">
                        {d.approved} approved
                      </span>
                    )}
                    {d.pending > 0 && (
                      <span className="rounded-full bg-white/70 px-1.5 py-0.5 font-semibold">{d.pending} pending</span>
                    )}
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-2 text-xs text-slate-400">
        Kasama ang mga nakabinbin pa — maaari pa silang maaprubahan bago ang sa iyo. Hindi ito humaharang; gabay lang
        ito sa pagpili ng petsa.
      </p>
    </div>
  );
}
