"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useCallSession } from "@/components/CallSessionProvider";
import { OverBreakDialog } from "@/components/OverBreakDialog";
import { AfterDutyDialog } from "@/components/AfterDutyDialog";
import { checkOverBreakAction } from "@/lib/actions/attendance";

/**
 * The two shift warnings, watching from the app layout rather than from one page.
 *
 * They used to live inside BreakControls, which is mounted on Leads alone. That
 * covered the common case — an agent works out of Leads all day — and missed
 * every other one: a break started from the clock page and forgotten while
 * uploading a call log, or a shift ending while somebody was reading Reports.
 * The warning would then arrive whenever they next happened to visit Leads,
 * which is not a rule so much as a coincidence.
 *
 * This renders nothing but the dialogs. The buttons and the header timers stay
 * where they are; what moved is only the decision about when to raise a warning,
 * and it moved so there is exactly one place making it. Two would mean the
 * dialog appearing twice on the page that still has both.
 */
export function ShiftWatcher({
  breakStart,
  breakEnd,
  allowanceMinutes,
  dutyEndsAt,
  scheduledTimeOut,
  onTheClock,
  redirectTo,
}: {
  breakStart: string | null;
  breakEnd: string | null;
  allowanceMinutes: number;
  /** End of shift as an instant, resolved server-side. Null when off the clock. */
  dutyEndsAt: string | null;
  scheduledTimeOut: string | null;
  /** Timed in and not yet timed out. Nothing is watched otherwise. */
  onTheClock: boolean;
  redirectTo: string;
}) {
  const router = useRouter();
  const { clock } = useCallSession();
  const [, startTransition] = useTransition();
  const [now, setNow] = useState(() => clock());
  const [overBreakOpen, setOverBreakOpen] = useState(false);
  const [afterDutyOpen, setAfterDutyOpen] = useState(false);
  const [afterDutySeen, setAfterDutySeen] = useState(false);
  const overBreakSeenRef = useRef(false);

  const onBreak = onTheClock && !!breakStart && !breakEnd;

  useEffect(() => {
    if (!onBreak && !dutyEndsAt) return;
    const id = setInterval(() => setNow(clock()), 1000);
    return () => clearInterval(id);
    // clock reads a ref and never changes identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onBreak, dutyEndsAt]);

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

  // The shift end DOES fire retroactively — unlike the break — because arriving
  // on any page after hours is exactly the case worth catching. Once per mount,
  // so dismissing it is a decision that holds until the next navigation.
  useEffect(() => {
    if (!dutyEndsAt || afterDutySeen) return;
    if (now >= new Date(dutyEndsAt).getTime()) {
      setAfterDutySeen(true);
      setAfterDutyOpen(true);
    }
  }, [now, dutyEndsAt, afterDutySeen]);

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
      {afterDutyOpen && dutyEndsAt && (
        <AfterDutyDialog
          dutyEndsAt={dutyEndsAt}
          scheduledTimeOut={scheduledTimeOut || ""}
          redirectTo={redirectTo}
          onDismiss={() => setAfterDutyOpen(false)}
        />
      )}
    </>
  );
}
