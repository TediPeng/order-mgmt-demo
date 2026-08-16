"use client";

import { useState } from "react";
import Link from "next/link";
import { PhoneCall, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { formatElapsed, useCallSession } from "@/components/CallSessionProvider";
import { TIME_IN_HREF } from "@/lib/time-in-gate";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

export interface CallingState {
  session: { id: string; order_id: string; started_at: string } | null;
  /** Another order already holds this agent's active call. */
  blockedBy: { id: string; order_number: string } | null;
}

/**
 * Start/stop control and the live call timer for one order.
 *
 * The session itself lives in CallSessionProvider (app-level), so the timer
 * keeps running across route changes and is restored from the server after a
 * refresh. This component only renders whichever state that session implies for
 * *this* order.
 */
export function CallingPanel({
  orderId,
  onStarted,
  onEnded,
  onOpenActive,
  compact = false,
}: {
  orderId: string;
  onStarted?: () => void;
  onEnded?: () => void;
  onOpenActive: (orderId: string) => void;
  /** Renders as a single row of controls, for the popup's footer bar. */
  compact?: boolean;
}) {
  const { session, now, startCall, endCall } = useCallSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeInBlocked, setTimeInBlocked] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const active = Boolean(session && session.order_id === orderId);
  const blockedByOtherOrder = session && session.order_id !== orderId ? session.order_id : null;

  async function start() {
    setBusy(true);
    setError(null);
    setTimeInBlocked(false);
    const result = await startCall(orderId);
    setBusy(false);
    if (result.ok) {
      onStarted?.();
      return;
    }
    setError(result.error || "Could not start the call.");
    if (result.timeInRequired) setTimeInBlocked(true);
    if (result.activeOrder) onOpenActive(result.activeOrder.id);
  }

  async function endWithoutUpdate() {
    setConfirmEnd(false);
    setBusy(true);
    setError(null);
    await endCall();
    setBusy(false);
    onEnded?.();
  }

  // In the popup's footer the panel is one control among others, not a section
  // of its own: no explanatory strip, no border, and any error said in a line
  // beside the button rather than in an alert that would double the height of a
  // bar the form is scrolling under.
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {error && (
          <span
            className={cn(
              "max-w-[18rem] text-[11px] leading-tight",
              timeInBlocked ? "text-amber-700" : "text-red-600"
            )}
          >
            {error}{" "}
            {timeInBlocked && (
              <Link href={TIME_IN_HREF} className="font-medium underline">
                Go to Time In
              </Link>
            )}
          </span>
        )}

        {blockedByOtherOrder && !active && (
          <Button type="button" size="sm" variant="secondary" onClick={() => onOpenActive(blockedByOtherOrder)}>
            Return to active call
          </Button>
        )}

        {!blockedByOtherOrder && !active && (
          <Button type="button" size="sm" disabled={busy} onClick={start}>
            <PhoneCall className="h-4 w-4" /> {busy ? "Starting…" : "Calling"}
          </Button>
        )}

        {active && (
          <>
            <span className="flex items-center gap-1.5 whitespace-nowrap rounded-md bg-green-50 px-2 py-1 text-green-800">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-600" />
              </span>
              <span className="font-mono text-xs tabular-nums text-green-900" aria-live="off">
                {formatElapsed(session!.started_at, now)}
              </span>
            </span>
            {/* Red: ending a call is the one control here that closes something
                and cannot be taken back, and outlined it looked like Close. */}
            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={busy}
              className="whitespace-nowrap"
              onClick={() => setConfirmEnd(true)}
            >
              <PhoneOff className="h-4 w-4" /> End call
            </Button>
          </>
        )}
        {confirmEnd && (
          <ConfirmDialog
            title="End this call?"
            message="No status update will be recorded for this call. The call still ends and stays in the call history."
            confirmLabel="End call"
            cancelLabel="Keep calling"
            busy={busy}
            onConfirm={endWithoutUpdate}
            onCancel={() => setConfirmEnd(false)}
          />
        )}
      </div>
    );
  }

  if (blockedByOtherOrder && !active) {
    return (
      <Alert kind="error" className="flex items-center justify-between gap-3">
        <span>You already have a call in progress on another order.</span>
        <Button type="button" size="sm" variant="secondary" onClick={() => onOpenActive(blockedByOtherOrder)}>
          Return to active call
        </Button>
      </Alert>
    );
  }

  if (!active) {
    return (
      <div className="space-y-2">
        {error && (
          <Alert kind={timeInBlocked ? "warning" : "error"}>
            <div className="flex flex-wrap items-center gap-3">
              <span>{error}</span>
              {timeInBlocked && (
                <Link
                  href={TIME_IN_HREF}
                  className="rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700"
                >
                  Go to Time In
                </Link>
              )}
            </div>
          </Alert>
        )}
        <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-xs text-slate-500">Click Calling before editing or updating this order.</p>
          <Button type="button" size="sm" disabled={busy} onClick={start}>
            <PhoneCall className="h-4 w-4" /> {busy ? "Starting…" : "Calling"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {error && <Alert kind="error">{error}</Alert>}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-600" />
          </span>
          <span className="text-sm font-medium text-green-800">Call in progress</span>
          <span className="font-mono text-sm tabular-nums text-green-900" aria-live="off">
            {formatElapsed(session!.started_at, now)}
          </span>
        </div>
        <Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => setConfirmEnd(true)}>
          <PhoneOff className="h-4 w-4" /> End without update
        </Button>
      </div>
        {confirmEnd && (
          <ConfirmDialog
            title="End this call?"
            message="No status update will be recorded for this call. The call still ends and stays in the call history."
            confirmLabel="End call"
            cancelLabel="Keep calling"
            busy={busy}
            onConfirm={endWithoutUpdate}
            onCancel={() => setConfirmEnd(false)}
          />
        )}
    </div>
  );
}
