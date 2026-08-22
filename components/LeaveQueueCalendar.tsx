"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Paperclip, X } from "lucide-react";
import type { LeaveDetails } from "@/components/LeaveDetailsButton";
import { Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmitButton";
import { reviewLeaveAction } from "@/lib/actions/leave";

/** The record, plus the id the decision has to be attached to. */
export type QueueRequest = LeaveDetails & { id: string };

export interface QueueDay {
  /** YYYY-MM-DD */
  date: string;
  /** Undecided, and the reason an approver is here. */
  requests: QueueRequest[];
  /** Everything already settled on this day — approved, rejected, cancelled,
   *  returned. Read-only, and the answer to "what happened to Maria's day off",
   *  which the counts alone cannot give. */
  decided: QueueRequest[];
  /** Of the decided, how many are approved: the figure the cap measures. */
  approved: number;
}

/**
 * The review queue as a month, before it is a list.
 *
 * A queue sorted by when things were filed answers "what came in", which is the
 * wrong question for cover. What an approver has to see is where the floor is
 * thin: six people asking for the same Tuesday arrive scattered down a filed-
 * order list, and no amount of sorting makes a month's shape visible in rows.
 *
 * Picking a day opens what was asked for on it. The counts are the map; the
 * panel is the record, and it is the same panel the list rows open, so a
 * request reads identically whichever way it was reached.
 */
export function LeaveQueueCalendar({
  month,
  days,
  today,
  cap,
  prevMonthHref,
  nextMonthHref,
}: {
  /** YYYY-MM — the month drawn. */
  month: string;
  /** One entry per day in the grid, including the days either side. */
  days: QueueDay[];
  today: string;
  /** Settings › System, for marking the days that have no room left. */
  cap: number;
  /** Plain strings, not builders: a Server Component cannot hand a function
   *  across to a Client one, and month navigation is two links. */
  prevMonthHref: string;
  nextMonthHref: string;
}) {
  const [openDate, setOpenDate] = useState<string | null>(null);
  // Stays open across a decision, because deciding re-renders this and the
  // request that was just approved reappears below as decided. That is the
  // approver's only sight of what their click actually did -- which matters
  // most when the cap split or refused part of what they approved.
  const open = openDate ? days.find((d) => d.date === openDate && dayHasAnything(d)) : null;

  const [year, mon] = month.split("-").map(Number);
  const monthLabel = new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center gap-1">
        <Link
          href={prevMonthHref}
          aria-label="Previous month"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
        >
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <Link
          href={nextMonthHref}
          aria-label="Next month"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
        >
          <ChevronRight className="h-4 w-4" />
        </Link>
        <span className="ml-1 text-sm font-semibold text-slate-800">{monthLabel}</span>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((w) => (
          <div key={w} className="pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {w}
          </div>
        ))}

        {days.map((d) => {
          const inMonth = d.date.slice(0, 7) === month;
          const isToday = d.date === today;
          const full = d.approved >= cap;
          const count = d.requests.length;
          // A day with nothing pending can still be worth opening: what was
          // decided on it lives in the panel too.
          const idle = !dayHasAnything(d);

          return (
            <button
              key={d.date}
              type="button"
              disabled={idle}
              onClick={() => setOpenDate(d.date)}
              aria-label={`${longLabel(d.date)} — ${count} request${count === 1 ? "" : "s"}, ${d.approved} approved off`}
              className={[
                "flex h-16 flex-col items-center justify-center gap-0.5 rounded-md border px-0.5 text-xs transition-colors",
                idle
                  ? "cursor-default border-slate-200 bg-white"
                  : "border-slate-200 bg-white hover:border-slate-400 hover:bg-slate-50",
                inMonth ? "text-slate-700" : "text-slate-300",
                isToday ? "ring-1 ring-[var(--brand-primary)]" : "",
              ].join(" ")}
            >
              {/* The month on every square, the way the filing calendar reads,
                  so a date lifted off this grid is never a bare number. It
                  moves above the figure on a phone, where the column is about
                  32px and "Aug 26" will not fit beside it. */}
              <span className="flex flex-col items-center leading-none sm:block">
                <span className="text-[9px] font-medium opacity-80 sm:hidden">{shortMonth(d.date)}</span>
                <span className={`font-semibold ${isToday ? "text-[var(--brand-primary)]" : ""}`}>
                  <span className="hidden sm:inline">{shortMonth(d.date)} </span>
                  {dayOfMonth(d.date)}
                </span>
              </span>
              {count > 0 && (
                <span className="whitespace-nowrap text-[9px] font-semibold leading-tight text-amber-600">
                  {count} <Word short="req" full={count === 1 ? "request" : "requests"} />
                </span>
              )}
              {d.approved > 0 && (
                <span
                  className={`whitespace-nowrap text-[9px] font-semibold leading-tight ${
                    full ? "text-red-600" : "text-green-700"
                  }`}
                >
                  {d.approved} off{full ? " · full" : ""}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-[11px] text-slate-500">
        Pick a day to read what was asked for on it. A day reading{" "}
        <span className="font-semibold text-red-600">full</span> has its {cap} approved already, so nothing more can be
        approved on it.
      </p>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 whitespace-normal"
          onClick={() => setOpenDate(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h3 className="text-base font-semibold text-slate-900">
                {longLabel(open.date)} —{" "}
                {open.requests.length > 0
                  ? `${open.requests.length} to decide`
                  : `${open.decided.length} decided`}
              </h3>
              <button
                type="button"
                onClick={() => setOpenDate(null)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {open.requests.map((r) => (
                <RequestPanel key={r.id} d={r} />
              ))}
            </div>

            {open.decided.length > 0 && (
              <div className="border-t border-slate-200 bg-slate-50">
                <p className="px-5 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Already decided
                </p>
                <div className="divide-y divide-slate-100">
                  {open.decided.map((r) => (
                    <RequestPanel key={r.id} d={r} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** One request, laid out the way the row's own details panel lays it out, with
 *  the decision underneath it.
 *
 *  The same server action the queue row submits, so a request approved from the
 *  calendar and one approved from the list travel exactly the same path --
 *  including the daily cap, the knock-on closures and the agent's notification.
 *  Two buttons, not three: Return sends a request back to be edited, which is a
 *  conversation rather than a decision, and it stays on the row where the
 *  remarks explaining it can be read alongside the reply. */
function RequestPanel({ d }: { d: QueueRequest }) {
  return (
    <div className="space-y-3 px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{d.agentName}</p>
        <span className="text-xs text-slate-500">
          {d.dates} ({d.days}d) · filed {d.filedAt}
        </span>
      </div>
      <Field label="Reason">
        <p className="whitespace-pre-wrap">{d.reason}</p>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Status">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_TONE[d.status] || "bg-slate-100 text-slate-700"}`}
          >
            {d.status.replace(/_/g, " ")}
          </span>
        </Field>
        <Field label="Supervisor">{d.supervisorName || "—"}</Field>
      </div>
      {/* Who settled it and what they said. Without this the decided list is a
          record of outcomes with nobody attached to them. */}
      {d.reviewedBy && (
        <Field label="Decided by">
          {d.reviewedBy}
          {d.reviewedAt ? ` · ${d.reviewedAt}` : ""}
        </Field>
      )}
      {d.remarks && (
        <Field label="Remarks">
          <p className="whitespace-pre-wrap">{d.remarks}</p>
        </Field>
      )}
      {d.clashes.length > 0 && (
        <Field label="Also off these days">
          <ul className="space-y-0.5">
            {d.clashes.map((c, i) => (
              <li key={i} className="text-xs text-slate-600">
                {c.name} — {c.dates} ({c.status})
              </li>
            ))}
          </ul>
        </Field>
      )}
      {d.attachmentHref && (
        <a
          href={d.attachmentHref}
          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--brand-primary)] hover:underline"
        >
          <Paperclip className="h-3 w-3" /> Supporting document
        </a>
      )}

      {d.status === "pending" && (
        <form action={reviewLeaveAction} className="space-y-1.5 border-t border-slate-100 pt-3">
          <input type="hidden" name="id" value={d.id} />
          <Input name="management_remarks" placeholder="Remarks (optional)" className="w-full text-control" />
          {/* items-stretch: the filled Approve has no border and the outlined
              Reject does, so left alone they sit a pixel or two apart. */}
          <div className="flex items-stretch gap-1.5">
            <Button name="decision" value="approved" variant="success" size="sm">
              Approve
            </Button>
            <ConfirmSubmitButton
              name="decision"
              value="rejected"
              confirmMessage="Reject this leave request? The agent will be notified."
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-red-300 bg-white px-2.5 py-1.5 text-control font-medium text-red-700 transition-colors hover:bg-red-50"
            >
              Reject
            </ConfirmSubmitButton>
            {/* Sending it back to be edited is neither yes nor no, so it sits
                apart from the two that decide. */}
            <Button
              name="decision"
              value="returned_for_revision"
              variant="outline"
              size="sm"
              className="ml-auto border-amber-300 text-amber-700 hover:bg-amber-50"
            >
              Return
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <div className="mt-0.5 text-sm text-slate-800">{children}</div>
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

const STATUS_TONE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-700",
  cancelled: "bg-slate-200 text-slate-700",
  returned_for_revision: "bg-orange-100 text-orange-800",
};

const dayHasAnything = (d: QueueDay) => d.requests.length > 0 || d.decided.length > 0;

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const dayOfMonth = (iso: string) => utc(iso).getUTCDate();
const shortMonth = (iso: string) => utc(iso).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
const longLabel = (iso: string) =>
  utc(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
