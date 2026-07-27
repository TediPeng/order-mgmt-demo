"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { startBreakAction, endBreakAction, checkOverBreakAction } from "@/lib/actions/attendance";

function formatMinSec(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? "-" : "";
  const abs = Math.abs(totalSeconds);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${sign}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function BreakTimer({
  breakStart,
  breakEnd,
  allowanceMinutes,
  canBreak,
  redirectTo,
}: {
  breakStart: string | null;
  breakEnd: string | null;
  allowanceMinutes: number;
  canBreak: boolean;
  redirectTo: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [elapsedSec, setElapsedSec] = useState(0);
  const onBreak = !!breakStart && !breakEnd;
  const alertedRef = useRef(false);

  // Countdown is derived from the server-stored break_start on every tick (never
  // from client-side interval state), so refreshing or reopening the browser
  // mid-break always shows the correct remaining time (Section 0.8).
  useEffect(() => {
    if (!onBreak || !breakStart) return;
    const allowanceSec = allowanceMinutes * 60;
    const startMs = new Date(breakStart).getTime();
    // Don't retroactively alert for a threshold already crossed before this
    // page load -- only fire once when it crosses live, in this session.
    alertedRef.current = allowanceSec - Math.floor((Date.now() - startMs) / 1000) <= 0;
    const tick = () => {
      const elapsed = Math.floor((Date.now() - startMs) / 1000);
      setElapsedSec(elapsed);
      if (!alertedRef.current && allowanceSec - elapsed <= 0) {
        alertedRef.current = true;
        window.alert(`Your ${allowanceMinutes}-minute break has ended.`);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [onBreak, breakStart, allowanceMinutes]);

  // Poll the server periodically while on break so the over-60-minute flag
  // (and its notification) fires without the agent needing to click anything.
  useEffect(() => {
    if (!onBreak) return;
    const id = setInterval(() => {
      startTransition(() => {
        checkOverBreakAction().then(() => router.refresh());
      });
    }, 20000);
    return () => clearInterval(id);
  }, [onBreak, router, startTransition]);

  if (!canBreak) return null;

  const allowanceSec = allowanceMinutes * 60;
  const remainingSec = allowanceSec - elapsedSec;

  const isOver = remainingSec <= 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="mb-2 text-sm font-semibold text-slate-700">Break</p>
      {onBreak ? (
        <div className="space-y-3">
          <div className={`rounded-lg p-4 text-center transition-colors motion-reduce:transition-none ${isOver ? "bg-red-50" : "bg-[var(--brand-primary-10)]"}`}>
            <p className="text-xs uppercase tracking-wide text-slate-500">{isOver ? "Over Break By" : "Time Remaining"}</p>
            <p className={`font-mono text-3xl font-bold tabular-nums ${isOver ? "text-red-600" : "text-slate-900"}`}>
              {formatMinSec(Math.abs(remainingSec))}
            </p>
            <p className="mt-1 text-xs text-slate-400">Elapsed {formatMinSec(elapsedSec)} of {allowanceMinutes} min</p>
          </div>
          <form action={endBreakAction}>
            <input type="hidden" name="redirect_to" value={redirectTo} />
            <Button type="submit" variant="secondary" className="w-full">
              End Break
            </Button>
          </form>
        </div>
      ) : (
        <form action={startBreakAction}>
          <input type="hidden" name="redirect_to" value={redirectTo} />
          <Button type="submit" variant="outline" className="w-full" disabled={!!breakEnd}>
            {breakEnd ? "Break already used today" : `Start Break (${allowanceMinutes} min allowance)`}
          </Button>
        </form>
      )}
    </div>
  );
}
