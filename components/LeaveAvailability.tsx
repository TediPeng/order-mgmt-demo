"use client";

import type { LeaveDayCount } from "@/lib/leave";

/**
 * How many people are already off, day by day, as a calendar you pick from.
 *
 * The question an agent asks before picking a date is whether anybody else is
 * already off then, and the only way to find out was to ask a Team Lead. This
 * answers it while they are choosing rather than after they have filed -- and
 * because the answer is about dates, choosing happens here too: tap a day to
 * set it, tap a second to stretch the range, tap the one picked day again to
 * clear it. The date fields stay in step, so anyone who would rather type
 * still can.
 *
 * Counts only, never names: how many are off is what the decision needs, and who
 * they are is their colleagues' business.
 *
 * Nothing here blocks anything except the past. No rule in this system caps leave
 * per day, so a busy date is a thing to know rather than a thing forbidden --
 * presenting it as a limit would invent a policy the company has not set. The
 * three days' notice is still only warned about, on submit, where it was.
 */
export function LeaveAvailability({
  days,
  start,
  end,
  today,
  cap,
  onPick,
}: {
  days: LeaveDayCount[];
  /** The range currently in the form, for marking the days it covers. */
  start: string;
  end: string;
  /** Earlier than this cannot be filed for, so it cannot be picked. */
  today: string;
  /** Settings › System. Passed in rather than imported: this runs in the
   *  browser, where there is no database to ask. */
  cap: number;
  onPick: (date: string) => void;
}) {
  if (days.length === 0) return null;

  const selected = (iso: string) => Boolean(start && end && iso >= start && iso <= end);

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      {/* Five weeks of bare numbers begin at whatever day of the month today
          happens to be, so the grid opens on something like "16" with nothing
          saying which 16. The span carries the month names and the year; the
          1st still carries its own month, which is what marks where one turns
          into the next. */}
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Who is already off — tap to pick, tap again to clear
        </p>
        <p className="text-xs font-semibold text-slate-600">{monthSpan(days[0].date, days[days.length - 1].date)}</p>
      </div>

      {/* Seven columns on a phone leave about 32px of readable width, which the
          full words overrun. They shorten there rather than the calendar
          sliding sideways: a month you have to drag to see is worse than a word
          you have to expand. */}
      <div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEKDAYS.map((w) => (
            <div key={w} className="pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {w}
            </div>
          ))}

          {/* The grid wraps at seven on its own, so the days go in as one list. */}
          {days.map((d) => {
            const total = d.approved + d.pending;
            const past = d.date < today;
            // At the cap the day is closed, and a day you cannot be given is
            // not a day to offer: it greys out with the past rather than
            // letting someone pick a date the server will only refuse.
            const isFull = d.approved >= cap;
            const isSelected = selected(d.date);
            const isEdge = d.date === start || d.date === end;

            return (
              <button
                key={d.date}
                type="button"
                disabled={past || isFull}
                onClick={() => onPick(d.date)}
                aria-pressed={isSelected}
                aria-label={`${longLabel(d.date)} — ${isFull ? "Full, nobody else can be off" : countSentence(d)}`}
                className={[
                  "flex h-14 flex-col items-center justify-center rounded-md border px-0.5 text-xs transition",
                  past
                    ? "cursor-default border-transparent text-slate-300"
                    : isFull
                      ? "cursor-default border-slate-200 bg-slate-100 text-slate-400"
                      : // A free day is the answer the whole panel exists to give, so
                        // it is the one the eye should catch without reading: the box
                        // itself goes green. A day with people off keeps a plain box
                        // and says so in words, because there the count is the point
                        // and a tinted box would only shout over it.
                        total === 0
                        ? "border-green-200 bg-green-50 text-green-900 hover:border-green-400"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-400",
                  isSelected ? "ring-1 ring-[var(--brand-primary)]" : "",
                  isEdge ? "ring-2" : "",
                ].join(" ")}
              >
                {/* The 1st carries its month, so five weeks of squares never
                    leave you counting forward to work out which one it is. */}
                <span className={`font-semibold ${isSelected ? "text-[var(--brand-primary)]" : ""}`}>
                  {isFirstOfMonth(d.date) ? shortMonth(d.date) + " " : ""}
                  {dayOfMonth(d.date)}
                </span>
                {/* Each line names itself, so a figure is never left to be
                    guessed at from its colour alone. */}
                {!past &&
                  (isFull ? (
                    <span className="whitespace-nowrap text-[9px] font-semibold uppercase leading-tight tracking-wide">
                      Full
                    </span>
                  ) : total === 0 ? (
                    <span className="whitespace-nowrap text-[9px] font-medium leading-tight text-green-700">
                      <Word short="Free" full="Available" />
                    </span>
                  ) : (
                    <>
                      {d.approved > 0 && (
                        <span className="whitespace-nowrap text-[9px] font-semibold leading-tight text-green-700">
                          {d.approved} <Word short="Appr" full="Approved" />
                        </span>
                      )}
                      {d.pending > 0 && (
                        <span className="whitespace-nowrap text-[9px] font-semibold leading-tight text-amber-600">
                          {d.pending} <Word short="Pend" full="Pending" />
                        </span>
                      )}
                    </>
                  ))}
              </button>
            );
          })}
        </div>
      </div>

      {/* No key any more: the squares spell out their own words. What is left is
          the one thing they cannot say, which is what a pending count means for
          a date being chosen now. */}
      <p className="mt-2 text-[11px] text-slate-500">
        Only {cap} {cap === 1 ? "person" : "people"} may be off per day. A day reading Full has reached that and cannot be
        picked. Pending requests do not hold a place, but they may be approved before yours and take the last one.
      </p>
    </div>
  );
}

/** The same label at two lengths, picked by the width there is to say it in. */
function Word({ short, full }: { short: string; full: string }) {
  return (
    <>
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{full}</span>
    </>
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** All of these read the date in UTC, the timezone the strings were built in. */
function utc(iso: string) {
  return new Date(`${iso}T00:00:00Z`);
}

function dayOfMonth(iso: string): number {
  return utc(iso).getUTCDate();
}

function isFirstOfMonth(iso: string): boolean {
  return dayOfMonth(iso) === 1;
}

function shortMonth(iso: string): string {
  return utc(iso).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
}

/**
 * "August 2026", or "August – September 2026" when the weeks cross a month.
 *
 * The year is only said once when both ends share it, and said twice when they
 * do not, which is the only time it is in question.
 */
function monthSpan(from: string, to: string): string {
  const a = utc(from);
  const b = utc(to);
  const month = (d: Date) => d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  const year = (d: Date) => d.getUTCFullYear();

  if (year(a) !== year(b)) return `${month(a)} ${year(a)} – ${month(b)} ${year(b)}`;
  if (month(a) !== month(b)) return `${month(a)} – ${month(b)} ${year(b)}`;
  return `${month(a)} ${year(a)}`;
}

function longLabel(iso: string): string {
  return utc(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  });
}

function countSentence(d: LeaveDayCount): string {
  const parts: string[] = [];
  if (d.approved > 0) parts.push(`${d.approved} approved`);
  if (d.pending > 0) parts.push(`${d.pending} pending`);
  return parts.length === 0 ? "Nobody is off" : parts.join(", ");
}
