"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Utensils } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useCallSession } from "@/components/CallSessionProvider";
import { endBreakAction } from "@/lib/actions/attendance";

function mmss(totalSeconds: number): string {
  const abs = Math.abs(Math.floor(totalSeconds));
  return `${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/**
 * Raised the moment a break passes its allowance.
 *
 * This was a window.alert. An alert is a single line with an OK on it: it says
 * the break is over, then leaves — no figure to look at, no way to act on it,
 * and nothing left behind once it is dismissed. It also blocks the whole browser
 * tab, so an agent mid-call had a modal dialog they could not get past.
 *
 * What replaces it says three things the alert could not: how far over the break
 * is, and that the overage is on the attendance record — which is the part that
 * matters to the agent — and it offers the one action that stops the clock,
 * right there, rather than sending them looking for it.
 *
 * The counter keeps running while the dialog is open. A number frozen at the
 * moment of the warning would understate the overage by however long the dialog
 * sat unread.
 */
export function OverBreakDialog({
  breakStart,
  allowanceMinutes,
  redirectTo,
  onDismiss,
}: {
  /** When the break started, from the server — never a client-side stopwatch. */
  breakStart: string;
  allowanceMinutes: number;
  redirectTo: string;
  onDismiss: () => void;
}) {
  const { clock } = useCallSession();
  const [now, setNow] = useState(() => clock());

  useEffect(() => {
    const id = setInterval(() => setNow(clock()), 1000);
    return () => clearInterval(id);
    // clock is stable — it reads a ref, so it never changes identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const elapsed = Math.floor((now - new Date(breakStart).getTime()) / 1000);
  const over = Math.max(0, elapsed - allowanceMinutes * 60);
  const overMinutes = Math.floor(over / 60);

  return (
    // No click-outside-to-close. Everything else in this app closes on the
    // backdrop, and this is the one dialog where an accidental click past it
    // would dismiss the only warning the agent gets.
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 whitespace-normal">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="overbreak-title"
        className="w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-xl"
      >
        <div className="flex items-center gap-2 bg-red-600 px-5 py-3 text-white">
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
          <h2 id="overbreak-title" className="text-base font-semibold">
            Break time is over
          </h2>
        </div>

        <div className="space-y-4 p-5">
          <div className="flex items-center justify-center gap-2 rounded-lg bg-red-50 py-4">
            <Utensils className="h-5 w-5 text-red-500" aria-hidden />
            <span className="font-mono text-3xl font-semibold tabular-nums text-red-700" aria-live="off">
              +{mmss(over)}
            </span>
          </div>

          <p className="text-sm text-slate-700">
            Your {allowanceMinutes}-minute break is over
            {overMinutes >= 1 ? ` by ${overMinutes} minute${overMinutes === 1 ? "" : "s"}` : ""}. The overage is
            recorded on your attendance as <span className="font-medium text-slate-900">Over Break</span>, and your
            team lead can see it.
          </p>

          <div className="flex flex-col gap-2">
            {/* The action that stops the clock, first and largest. An alert that
                only reports a problem leaves the agent to go and find the End
                Break button, which is on another part of the screen and, on the
                clock page, another route entirely. */}
            <form action={endBreakAction}>
              <input type="hidden" name="redirect_to" value={redirectTo} />
              <Button type="submit" className="w-full justify-center">
                End Break Now
              </Button>
            </form>
            <Button type="button" variant="outline" className="w-full justify-center" onClick={onDismiss}>
              Keep working
            </Button>
          </div>

          {/* Dismissing hides the dialog, not the fact. The header timer stays
              red and counting for as long as the break is open. */}
          <p className="text-center text-xs text-slate-400">
            The count keeps running until the break is ended.
          </p>
        </div>
      </div>
    </div>
  );
}
