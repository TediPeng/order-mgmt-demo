"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { LeaveRequestForm } from "@/components/LeaveRequestForm";
import type { LeaveDayCount } from "@/lib/leave";

/** Popup entry point for filing a leave request (Section 5) -- the Attendance
 * module's primary way to file; also reused on /leave so filing still works there. */
export function RequestLeaveButton({
  action,
  today,
  leaveDays = [],
  cap,
}: {
  action: (formData: FormData) => void;
  today: string;
  leaveDays?: LeaveDayCount[];
  /** Settings › System: how many may be off per day. */
  cap: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Request Leave
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h3 className="text-base font-semibold text-slate-900">Request Leave</h3>
              <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5">
              <LeaveRequestForm
                action={(formData) => {
                  setOpen(false);
                  action(formData);
                }}
                today={today}
                leaveDays={leaveDays}
                cap={cap}
              />
              <p className="mt-3 text-xs text-slate-400">
                A day off must be filed at least 3 days before the date. If you need it sooner than that,
                raise it with your Team Lead.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
