"use client";

import { useEffect, useState } from "react";
import { Coffee, Utensils } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { startBreakAction, endBreakAction } from "@/lib/actions/attendance";
import { startBioBreakAction, endBioBreakAction } from "@/lib/actions/bio-breaks";
import { useCallSession } from "@/components/CallSessionProvider";

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
  redirectTo,
}: {
  breakStart: string | null;
  breakEnd: string | null;
  allowanceMinutes: number;
  bioStartedAt: string | null;
  /** Timed in and not yet timed out. */
  canBreak: boolean;
  redirectTo: string;
}) {
  // Read from the app-wide provider rather than a server prop, so the Bio Break
  // button disables the moment a call starts instead of waiting for a refresh —
  // and the page avoids another query. Its shared tick only runs during a call,
  // so break timers keep their own interval below.
  const { session, clock } = useCallSession();
  const onCall = !!session;
  const [now, setNow] = useState(() => clock());
  const onBreak = !!breakStart && !breakEnd;
  const onBio = !!bioStartedAt;

  useEffect(() => {
    if (!onBreak && !onBio) return;
    const id = setInterval(() => setNow(clock()), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onBreak, onBio]);

  if (!canBreak) return null;

  const breakRemaining = breakStart ? allowanceMinutes * 60 - Math.floor((now - new Date(breakStart).getTime()) / 1000) : 0;
  const overBreak = breakRemaining <= 0;
  const bioElapsed = bioStartedAt ? Math.max(0, Math.floor((now - new Date(bioStartedAt).getTime()) / 1000)) : 0;

  return (
    <div className="flex items-center gap-2">
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
