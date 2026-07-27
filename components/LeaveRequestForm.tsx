"use client";

import { useMemo, useState } from "react";
import { Input, Label, Select, Textarea } from "@/components/ui/Field";
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
  defaults,
  submitLabel = "Submit Request",
}: {
  action: (formData: FormData) => void;
  today: string;
  defaults?: { leave_start?: string; leave_end?: string; leave_type?: string; reason?: string };
  submitLabel?: string;
}) {
  const [start, setStart] = useState(defaults?.leave_start || "");
  const [end, setEnd] = useState(defaults?.leave_end || "");
  const [leaveType, setLeaveType] = useState(defaults?.leave_type || "unpaid");
  const [showWarning, setShowWarning] = useState(false);
  const days = useMemo(() => daysInclusive(start, end), [start, end]);
  const advance = useMemo(() => daysInAdvance(today, start), [today, start]);

  // Section 0.4: within the 3-day window, only Emergency Leave (with a reason,
  // already enforced by the textarea's `required`) may proceed -- Sick now
  // follows the same rule as Unpaid, blocked with a modal warning.
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (leaveType !== "emergency" && advance !== null && advance < 3) {
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
        <div>
          <Label htmlFor="leave_type">Leave type</Label>
          <Select id="leave_type" name="leave_type" value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
            <option value="sick">Sick</option>
            <option value="emergency">Emergency</option>
            <option value="unpaid">Unpaid</option>
          </Select>
        </div>
        <div>
          <Label>Number of leave days</Label>
          <Input value={days ?? ""} disabled placeholder="Select dates" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="reason">Reason</Label>
          <Textarea id="reason" name="reason" rows={3} required defaultValue={defaults?.reason} placeholder="Explain the reason for your leave request" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="attachment">Supporting document (optional for Emergency/Unpaid; may be required for Sick, PDF/JPG/PNG, max 5 MB)</Label>
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
              Only Emergency Leave (with a reason) may be filed within three days.
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
