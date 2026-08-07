"use client";

import { useEffect, useState } from "react";
import { Coffee } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { startBioBreakAction, endBioBreakAction } from "@/lib/actions/bio-breaks";

function formatMinSec(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * The short, repeatable break — separate from the daily one BreakTimer owns,
 * which allows exactly one and then reads "Break already used today".
 *
 * Counts up rather than down: bio breaks are unlimited by policy, so there is
 * no allowance to run out. The number is there to be seen, by the agent and on
 * the supervisor's monitor.
 */
export function BioBreakTimer({
  startedAt,
  countToday,
  secondsToday,
  redirectTo,
  onCall,
}: {
  startedAt: string | null;
  countToday: number;
  secondsToday: number;
  redirectTo: string;
  onCall: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);
  const active = !!startedAt;

  // Derived from the server-stored started_at on every tick, never from
  // accumulated interval state, so a refresh or a second tab shows the same
  // figure rather than restarting at zero.
  useEffect(() => {
    if (!startedAt) return;
    const startMs = new Date(startedAt).getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">Bio Break</p>
        <span className="text-xs text-slate-400">
          {countToday} today · {formatMinSec(secondsToday)} total
        </span>
      </div>

      {active ? (
        <div className="space-y-3">
          <div className="rounded-lg bg-amber-50 p-4 text-center">
            <p className="text-xs uppercase tracking-wide text-amber-700">On bio break</p>
            <p className="font-mono text-3xl font-bold tabular-nums text-amber-900">{formatMinSec(elapsed)}</p>
          </div>
          <form action={endBioBreakAction}>
            <input type="hidden" name="redirect_to" value={redirectTo} />
            <Button type="submit" variant="secondary" className="w-full">
              End Bio Break
            </Button>
          </form>
        </div>
      ) : (
        <form action={startBioBreakAction}>
          <input type="hidden" name="redirect_to" value={redirectTo} />
          <Button type="submit" variant="outline" className="w-full" disabled={onCall}>
            <Coffee className="h-4 w-4" />
            {onCall ? "End your call first" : "Start Bio Break"}
          </Button>
        </form>
      )}
    </div>
  );
}
