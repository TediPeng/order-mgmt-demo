"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useCallSession } from "@/components/CallSessionProvider";
import { OverBreakDialog } from "@/components/OverBreakDialog";
import { checkOverBreakAction } from "@/lib/actions/attendance";

/**
 * The over-break warning, watching from the app layout rather than from one page.
 *
 * It used to live inside BreakControls, which is mounted on Leads alone. That
 * covered the common case — an agent works out of Leads all day — and missed
 * every other one: a break started from the clock page and forgotten while
 * uploading a call log. The warning would then arrive whenever they next
 * happened to visit Leads, which is not a rule so much as a coincidence.
 *
 * The end of shift used to be watched here too. It is swept server-side now, so
 * a forgotten time out is closed whether or not anyone is at the screen.
 *
 * This renders nothing but the dialog. The buttons and the header timers stay
 * where they are; what moved is only the decision about when to raise a warning,
 * and it moved so there is exactly one place making it. Two would mean the
 * dialog appearing twice on the page that still has both.
 */
export function ShiftWatcher({
  breakStart,
  breakEnd,
  allowanceMinutes,
  onTheClock,
  redirectTo,
}: {
  breakStart: string | null;
  breakEnd: string | null;
  allowanceMinutes: number;
  /** Timed in and not yet timed out. Nothing is watched otherwise. */
  onTheClock: boolean;
  redirectTo: string;
}) {
  const router = useRouter();
  const { clock } = useCallSession();
  const [, startTransition] = useTransition();
  const [now, setNow] = useState(() => clock());
  const [overBreakOpen, setOverBreakOpen] = useState(false);
  const overBreakSeenRef = useRef(false);

  const onBreak = onTheClock && !!breakStart && !breakEnd;

  useEffect(() => {
    if (!onBreak) return;
    const id = setInterval(() => setNow(clock()), 1000);
    return () => clearInterval(id);
    // clock reads a ref and never changes identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onBreak]);

  // Never retroactively for a break already over when this mounted: an agent who
  // navigates during a long break would otherwise be shown it again on every
  // page they open.
  useEffect(() => {
    if (!onBreak || !breakStart) return;
    const elapsed = Math.floor((clock() - new Date(breakStart).getTime()) / 1000);
    overBreakSeenRef.current = elapsed >= allowanceMinutes * 60;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onBreak, breakStart, allowanceMinutes]);

  useEffect(() => {
    if (!onBreak || !breakStart) return;
    if (overBreakSeenRef.current) return;
    if (now - new Date(breakStart).getTime() >= allowanceMinutes * 60 * 1000) {
      overBreakSeenRef.current = true;
      setOverBreakOpen(true);
    }
  }, [now, onBreak, breakStart, allowanceMinutes]);

  useEffect(() => {
    if (!onBreak) setOverBreakOpen(false);
  }, [onBreak]);

  // Keeps the over-break flag and its notification firing without the agent
  // having to open the clock page. This ran on Leads only; it follows them now.
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

  return (
    <>
      {overBreakOpen && onBreak && breakStart && (
        <OverBreakDialog
          breakStart={breakStart}
          allowanceMinutes={allowanceMinutes}
          redirectTo={redirectTo}
          onDismiss={() => setOverBreakOpen(false)}
        />
      )}
    </>
  );
}
