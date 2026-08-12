"use client";

import { useState } from "react";
import { Paperclip, X } from "lucide-react";

/**
 * The whole leave request, on click.
 *
 * The queue truncates the reason to keep the row one line, and the rest of it
 * lived in a `title` attribute — a native tooltip that arrives late, cuts off
 * at the edge of the window, cannot be selected or copied, and disappears the
 * moment the pointer moves. An approver deciding on somebody's day off was
 * reading a sentence through a letterbox.
 *
 * Everything the record holds is here instead, in a panel that stays open.
 * Every value is formatted on the server and passed through as a string, so
 * this component cannot disagree with the row it came from about a date.
 */
export interface LeaveDetails {
  agentName: string;
  filedAt: string;
  dates: string;
  days: number;
  leaveType: string;
  reason: string;
  attachmentHref: string | null;
  status: string;
  urgent: boolean;
  supervisorName: string | null;
  remarks: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  /** Everyone else already off across these days — the thing worth knowing
   * before approving, and the reason this panel is more than a reason. */
  clashes: { name: string; dates: string; status: string }[];
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <div className="mt-0.5 text-sm text-slate-800">{children}</div>
    </div>
  );
}

export function LeaveDetailsButton({ preview, details }: { preview: string; details: LeaveDetails }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* The reason itself is the control — it is what an approver reaches for,
          and a separate "view" link beside it would be a second thing to aim at. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Open the full request"
        className="block max-w-[220px] truncate text-left text-slate-600 underline decoration-slate-300 underline-offset-2 hover:text-slate-900 hover:decoration-slate-500"
      >
        {preview || "(no reason given)"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">{details.agentName}</h3>
                <p className="mt-0.5 text-xs text-slate-500">Filed {details.filedAt}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Dates">
                  {details.dates} ({details.days}d)
                </Field>
                <Field label="Type">
                  <span className="capitalize">{details.leaveType}</span>
                </Field>
                <Field label="Status">
                  <span className="capitalize">{details.status.replace(/_/g, " ")}</span>
                  {details.urgent && (
                    <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                      Urgent
                    </span>
                  )}
                </Field>
                <Field label="Supervisor">{details.supervisorName || "—"}</Field>
              </div>

              {/* The whole thing, wrapped and selectable. This is what the
                  tooltip was hiding. */}
              <Field label="Reason">
                <p className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-slate-700">
                  {details.reason || "—"}
                </p>
              </Field>

              {details.attachmentHref && (
                <Field label="Attachment">
                  <a
                    href={details.attachmentHref}
                    className="inline-flex items-center gap-1 font-medium text-[var(--brand-primary)] hover:underline"
                  >
                    <Paperclip className="h-3.5 w-3.5" /> Open the attached file
                  </a>
                </Field>
              )}

              {details.remarks && (
                <Field label="Management remarks">
                  <p className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-slate-700">
                    {details.remarks}
                  </p>
                </Field>
              )}

              {details.reviewedBy && (
                <Field label="Reviewed">
                  {details.reviewedBy}
                  {details.reviewedAt ? ` · ${details.reviewedAt}` : ""}
                </Field>
              )}

              {/* Not decoration: approving a fourth person for a Tuesday three
                  others already have is the mistake this panel exists to stop. */}
              <Field label={`Also off on these days (${details.clashes.length})`}>
                {details.clashes.length === 0 ? (
                  <span className="text-slate-400">Nobody else — these days are clear.</span>
                ) : (
                  <ul className="divide-y divide-slate-100 rounded-lg border border-amber-200 bg-amber-50/50">
                    {details.clashes.map((c, i) => (
                      <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-1.5">
                        <span className="font-medium text-slate-800">{c.name}</span>
                        <span className="text-xs text-slate-500">
                          {c.dates} · <span className="capitalize">{c.status.replace(/_/g, " ")}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Field>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
