"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Coffee, Utensils } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { startBreakAction, endBreakAction, checkOverBreakAction } from "@/lib/actions/attendance";
import { startBioBreakAction, endBioBreakAction } from "@/lib/actions/bio-breaks";
import { useCallSession } from "@/components/CallSessionProvider";
import { OverBreakDialog } from "@/components/OverBreakDialog";
import { AfterDutyDialog } from "@/components/AfterDutyDialog";

/**
 * Compact break controls for a page header.
 *
 * The Time In / Out page has full BreakTimer / BioBreakTimer cards. Agents work
 * out of Leads all day, so making them navigate away to start a break meant
 * either not taking one or losing their place; these are the same two actions
 * sized to sit in a toolbar.
 *
 * Both timers derive from the server-stored start on every tick rather than
 * accumulating locally, so this and the clock page always agree, and neither
 * restarts at zero on a refresh.
 */
function mmss(totalSeconds: number): string {
  const abs = Math.abs(Math.floor(totalSeconds));
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function BreakControls({
  breakStart,
  breakEnd,
  allowanceMinutes,
  bioStartedAt,
  canBreak,
  dutyEndsAt,
  scheduledTimeOut,
  redirectTo,
}: {
  breakStart: string | null;
  breakEnd: string | null;
  allowanceMinutes: number;
  bioStartedAt: string | null;
  /** Timed in and not yet timed out. */
  canBreak: boolean;
  /** End of shift as an instant, resolved server-side. Null when off the clock. */
  dutyEndsAt?: string | null;
  scheduledTimeOut?: string | null;
  redirectTo: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Read from the app-wide provider rather than a server prop, so the Bio Break
  // button disables the moment a call starts instead of waiting for a refresh —
  // and the page avoids another query. Its shared tick only runs during a call,
  // so break timers keep their own interval below.
  const { session } = useCallSession();
  const onCall = !!session;
  const [now, setNow] = useState(() => Date.now());
  const onBreak = !!breakStart && !breakEnd;
  const onBio = !!bioStartedAt;
  const alertedRef = useRef(false);
  const [overBreakOpen, setOverBreakOpen] = useState(false);
  const [afterDutyOpen, setAfterDutyOpen] = useState(false);
  const [afterDutySeen, setAfterDutySeen] = useState(false);

  useEffect(() => {
    // Ticks for the shift-end watch too, not only the two break timers — the
    // dialog has to arrive at the scheduled minute for an agent who has taken
    // no break at all.
    if (!onBreak && !onBio && !dutyEndsAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [onBreak, onBio, dutyEndsAt]);

  // Same over-break alert the clock page raises, so taking a break from here is
  // not a way to miss it. Fires once, and never retroactively for a threshold
  // already crossed before this page loaded.
  useEffect(() => {
    if (!onBreak || !breakStart) return;
    const allowanceSec = allowanceMinutes * 60;
    const elapsed = Math.floor((Date.now() - new Date(breakStart).getTime()) / 1000);
    alertedRef.current = allowanceSec - elapsed <= 0;
  }, [onBreak, breakStart, allowanceMinutes]);

  useEffect(() => {
    if (!onBreak || !breakStart) return;
    const allowanceSec = allowanceMinutes * 60;
    const elapsed = Math.floor((now - new Date(breakStart).getTime()) / 1000);
    if (!alertedRef.current && allowanceSec - elapsed <= 0) {
      alertedRef.current = true;
      setOverBreakOpen(true);
    }
  }, [now, onBreak, breakStart, allowanceMinutes]);

  // Ending the break takes the dialog with it, so a re-render mid-submit cannot
  // leave it hanging over a break that is already closed.
  useEffect(() => {
    if (!onBreak) setOverBreakOpen(false);
  }, [onBreak]);

  // The shift end. Raised once per page load: dismissing it is a decision, and
  // re-raising it every second would make that decision impossible to keep.
  // A shift that had already ended before this page loaded still raises it —
  // unlike the break alert — because arriving on the page after hours is
  // exactly the case worth catching.
  useEffect(() => {
    if (!dutyEndsAt || afterDutySeen) return;
    if (now >= new Date(dutyEndsAt).getTime()) {
      setAfterDutySeen(true);
      setAfterDutyOpen(true);
    }
  }, [now, dutyEndsAt, afterDutySeen]);

  // Keeps the over-60-minute flag and its notification firing without the agent
  // having to open the clock page.
  useEffect(() => {
    if (!onBreak) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      startTransition(() => {
        checkOverBreakAction().then(() => router.refresh());
      });
    }, 20000);
    return () => clearInterval(id);
  }, [onBreak, router, startTransition]);

  if (!canBreak) return null;

  const breakRemaining = breakStart ? allowanceMinutes * 60 - Math.floor((now - new Date(breakStart).getTime()) / 1000) : 0;
  const overBreak = breakRemaining <= 0;
  const bioElapsed = bioStartedAt ? Math.max(0, Math.floor((now - new Date(bioStartedAt).getTime()) / 1000)) : 0;

  return (
    <div className="flex items-center gap-2">
      {overBreakOpen && onBreak && breakStart && (
        <OverBreakDialog
          breakStart={breakStart}
          allowanceMinutes={allowanceMinutes}
          redirectTo={redirectTo}
          onDismiss={() => setOverBreakOpen(false)}
        />
      )}
      {afterDutyOpen && dutyEndsAt && (
        <AfterDutyDialog
          dutyEndsAt={dutyEndsAt}
          scheduledTimeOut={scheduledTimeOut || ""}
          redirectTo={redirectTo}
          onDismiss={() => setAfterDutyOpen(false)}
        />
      )}
      {onBreak ? (
        <form action={endBreakAction} className="flex items-center gap-1.5">
          <input type="hidden" name="redirect_to" value={redirectTo} />
          <span
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-mono text-sm font-semibold tabular-nums ${
              overBreak ? "bg-red-50 text-red-700" : "bg-orange-50 text-orange-700"
            }`}
            title={overBreak ? "Over break" : "Break time remaining"}
          >
            <Utensils className="h-3.5 w-3.5" aria-hidden />
            {overBreak ? "+" : ""}
            {mmss(breakRemaining)}
          </span>
          <Button type="submit" variant="secondary" size="sm">
            End Break
          </Button>
        </form>
      ) : (
        <form action={startBreakAction}>
          <input type="hidden" name="redirect_to" value={redirectTo} />
          <Button type="submit" variant="outline" size="sm" disabled={!!breakEnd || onBio}>
            <Utensils className="h-4 w-4" />
            {breakEnd ? "Break used" : "Break"}
          </Button>
        </form>
      )}

      {onBio ? (
        <form action={endBioBreakAction} className="flex items-center gap-1.5">
          <input type="hidden" name="redirect_to" value={redirectTo} />
          <span
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 font-mono text-sm font-semibold tabular-nums text-amber-800"
            title="Bio break elapsed"
          >
            <Coffee className="h-3.5 w-3.5" aria-hidden />
            {mmss(bioElapsed)}
          </span>
          <Button type="submit" variant="secondary" size="sm">
            End Bio
          </Button>
        </form>
      ) : (
        <form action={startBioBreakAction}>
          <input type="hidden" name="redirect_to" value={redirectTo} />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={onCall || onBreak}
            title={onCall ? "End your call first" : undefined}
          >
            <Coffee className="h-4 w-4" />
            Bio Break
          </Button>
        </form>
      )}
    </div>
  );
}
