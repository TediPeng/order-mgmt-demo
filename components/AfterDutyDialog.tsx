"use client";

import { useEffect, useState, useTransition } from "react";
import { Clock, LogOut } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useCallSession } from "@/components/CallSessionProvider";
import { acknowledgeUnpaidOvertimeAction, timeOutAction } from "@/lib/actions/attendance";

function hhmmss(totalSeconds: number): string {
  const abs = Math.abs(Math.floor(totalSeconds));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

/**
 * Raised when the agent is still on the clock past their scheduled time out.
 *
 * Built like the over-break dialog, and for the same reason: the moment matters
 * and there was nothing marking it. An agent who works to 6:40 because nobody
 * told them the shift ended at 5:00 finds out at payroll.
 *
 * It does not force a time out. Somebody mid-call at 5:02 is not doing anything
 * wrong, and a dialog that logged them out would be worse than one that lets
 * them finish. What it does is put the terms in front of them before the hours
 * are worked: continuing is a choice, and the choice is recorded — a
 * notification they keep, and an activity-log entry — so that unpaid overtime is
 * something agreed to rather than discovered afterwards.
 */
export function AfterDutyDialog({
  dutyEndsAt,
  scheduledTimeOut,
  redirectTo,
  onDismiss,
}: {
  /** The scheduled end of shift as an instant, resolved server-side from the
   * agent's own schedule and the configured timezone — never from the browser's
   * clock or its idea of what timezone it is in. */
  dutyEndsAt: string;
  /** The same time as it reads on a roster, for saying out loud. */
  scheduledTimeOut: string;
  redirectTo: string;
  onDismiss: () => void;
}) {
  const { clock } = useCallSession();
  const [now, setNow] = useState(() => clock());
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const id = setInterval(() => setNow(clock()), 1000);
    return () => clearInterval(id);
    // clock is stable — it reads a ref, so it never changes identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const over = Math.max(0, Math.floor((now - new Date(dutyEndsAt).getTime()) / 1000));

  function continueWorking() {
    startTransition(async () => {
      await acknowledgeUnpaidOvertimeAction();
      onDismiss();
    });
  }

  return (
    // No click-outside-to-close: this is the one notice that has to be read
    // rather than clicked past, because what follows it is unpaid.
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="afterduty-title"
        className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-xl"
      >
        <div className="flex items-center gap-2 bg-amber-500 px-5 py-3 text-white">
          <Clock className="h-5 w-5 shrink-0" aria-hidden />
          <h2 id="afterduty-title" className="text-base font-semibold">
            Your shift has ended
          </h2>
        </div>

        <div className="space-y-4 p-5">
          <div className="flex items-center justify-center gap-2 rounded-lg bg-amber-50 py-4">
            <Clock className="h-5 w-5 text-amber-500" aria-hidden />
            <span className="font-mono text-3xl font-semibold tabular-nums text-amber-700">+{hhmmss(over)}</span>
          </div>

          <p className="text-sm text-slate-700">
            Your shift was scheduled to end at{" "}
            <span className="font-medium text-slate-900">{scheduledTimeOut}</span>. You can time out now.
          </p>

          {/* Said here as well as in the notification. The notification is the
              record; this is the part that has to be read before the hours are
              worked, not after. */}
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            If you continue, please note: <span className="font-medium">hours worked beyond your scheduled time out are
            not paid</span> unless overtime was approved in advance by your Team Lead or Management. If this work is
            required, request approval first so the hours can be recorded and paid correctly.
          </p>

          <div className="flex flex-col gap-2">
            <form action={timeOutAction}>
              <input type="hidden" name="redirect_to" value={redirectTo} />
              <Button type="submit" className="w-full justify-center">
                <LogOut className="h-4 w-4" /> Time Out Now
              </Button>
            </form>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-center"
              disabled={pending}
              onClick={continueWorking}
            >
              {pending ? "Recording…" : "Continue working (unpaid)"}
            </Button>
          </div>

          <p className="text-center text-xs text-slate-400">
            This reminder is sent to your notifications as a record.
          </p>
        </div>
      </div>
    </div>
  );
}
