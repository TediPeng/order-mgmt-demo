"use client";

import { useMemo, useState } from "react";
import { LeaveAvailability } from "@/components/LeaveAvailability";
import type { LeaveDayCount } from "@/lib/leave";
import { Input, Label, Textarea } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

function daysInclusive(start: string, end: string): number | null {
  if (!start || !end) return null;
  const s = Date.parse(start + "T00:00:00Z");
  const e = Date.parse(end + "T00:00:00Z");
  if (isNaN(s) || isNaN(e) || e < s) return null;
  return Math.round((e - s) / 86400000) + 1;
}

function daysInAdvance(today: string, start: string): number | null {
  if (!start) return null;
  const t = Date.parse(today + "T00:00:00Z");
  const s = Date.parse(start + "T00:00:00Z");
  if (isNaN(t) || isNaN(s)) return null;
  return Math.round((s - t) / 86400000);
}

const WARNING_MESSAGE = "Leave requests must be submitted at least three days before the requested leave date.";

export function LeaveRequestForm({
  action,
  today,
  leaveDays = [],
  cap,
  defaults,
  submitLabel = "Submit Request",
}: {
  action: (formData: FormData) => void;
  today: string;
  /** Per-day counts for the window the panel shows. Empty hides it. */
  leaveDays?: LeaveDayCount[];
  /** Settings › System: how many may be off per day. */
  cap: number;
  defaults?: { leave_start?: string; leave_end?: string; leave_type?: string; reason?: string };
  submitLabel?: string;
}) {
  const [start, setStart] = useState(defaults?.leave_start || "");
  const [end, setEnd] = useState(defaults?.leave_end || "");
  const [showWarning, setShowWarning] = useState(false);
  const days = useMemo(() => daysInclusive(start, end), [start, end]);
  const advance = useMemo(() => daysInAdvance(today, start), [today, start]);

  /**
   * One tap is a single day; a second tap on another day stretches it into a
   * range, whichever side it falls. Tapping the one day already picked clears
   * it again -- the way out of a wrong choice is the same gesture that made it.
   * Once a range exists the next tap starts over, so there is never a
   * half-picked state the form cannot submit.
   */
  function pickDate(date: string) {
    if (start === end && date === start) {
      setStart("");
      setEnd("");
    } else if (!start || !end || start !== end) {
      setStart(date);
      setEnd(date);
    } else if (date > start) {
      setEnd(date);
    } else {
      setStart(date);
    }
  }

  // Section 0.4: three days' notice, warned about here and enforced on the
  // server. The Emergency exemption went with the type picker — see the note
  // beside the hidden field below.
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (advance !== null && advance < 3) {
      e.preventDefault();
      setShowWarning(true);
    }
  }

  return (
    <>
      <form action={action} onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="leave_start">Leave start date</Label>
          <Input id="leave_start" name="leave_start" type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="leave_end">Leave end date</Label>
          <Input id="leave_end" name="leave_end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} required />
        </div>
        {/* Between the dates and the rest of the form: it is read while the
            dates are being chosen, not after. */}
        <div className="sm:col-span-2">
          <LeaveAvailability days={leaveDays} start={start} end={end} today={today} cap={cap} onPick={pickDate} />
        </div>
        {/* There is one kind of request now: a day off.

            Sick, Emergency and Unpaid were three names for the same form, and
            in the whole history of this system every request ever filed was
            Unpaid — nobody chose the other two. The column keeps that value so
            no row has to be rewritten and no enum has to change; what the agent
            no longer has is a choice that never meant anything to them. */}
        <input type="hidden" name="leave_type" value="unpaid" />
        <div>
          <Label>Number of leave days</Label>
          <Input value={days ?? ""} disabled placeholder="Select dates" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="reason">Reason</Label>
          <Textarea id="reason" name="reason" rows={3} required defaultValue={defaults?.reason} placeholder="Explain the reason for your leave request" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="attachment">Supporting document (optional — PDF/JPG/PNG, max 5 MB)</Label>
          <input
            id="attachment"
            name="attachment"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-md file:border-0 file:bg-[var(--brand-primary)] file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:opacity-90"
          />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit">{submitLabel}</Button>
        </div>
      </form>

      {showWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowWarning(false)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900">Leave request too close to the date</h3>
            <p className="mt-2 text-sm text-slate-600">{WARNING_MESSAGE}</p>
            <p className="mt-2 text-xs text-slate-400">
              If you need the time sooner than that, raise it with your Team Lead.
            </p>
            <div className="mt-5 flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowWarning(false)}>
                OK
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
