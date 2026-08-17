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

/**
 * Start/stop control and the live call timer for one call.
 *
 * The session itself lives in CallSessionProvider (app-level), so the timer
 * keeps running across route changes and is restored from the server after a
 * refresh. This component only renders whichever state that session implies for
 * *this* target.
 *
 * The target is an order for a lead, or a regular customer who has no order
 * yet: the New Order form raised from Regular Customers shows this panel keyed
 * on the customer, so the agent can ring them and write the order during the
 * call rather than having to invent an order first.
 */
export function CallingPanel({
  orderId,
  customerId,
  onStarted,
  onEnded,
  onOpenActive,
  compact = false,
}: {
  /** The lead being called. Omit for a call on a regular customer. */
  orderId?: string;
  /** The regular customer being called, when there is no order yet. */
  customerId?: string;
  onStarted?: () => void;
  onEnded?: () => void;
  onOpenActive: (orderId: string) => void;
  /** Renders as a single row of controls, for the popup's footer bar. */
  compact?: boolean;
}) {
  const { session, now, startCall, startCustomerCall, endCall } = useCallSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeInBlocked, setTimeInBlocked] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  // A customer call stays this panel's own once the order it produced has been
  // attached to it — the agent is still on the phone to the same person.
  const active = Boolean(
    session && (orderId ? session.order_id === orderId : Boolean(customerId) && session.customer_id === customerId)
  );
  const other = session && !active ? session : null;
  // The way back to whatever else is running. A call that has not produced an
  // order yet has no order to open, so it returns to the form it started on.
  const otherHref = other && !other.order_id ? `/leads/new?customer=${other.customer_id}` : null;

  async function start() {
    setBusy(true);
    setError(null);
    setTimeInBlocked(false);
    const result = orderId ? await startCall(orderId) : await startCustomerCall(customerId!);
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

        {other &&
          (otherHref ? (
            <Link
              href={otherHref}
              className="inline-flex items-center rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Return to active call
            </Link>
          ) : (
            <Button type="button" size="sm" variant="secondary" onClick={() => onOpenActive(other.order_id!)}>
              Return to active call
            </Button>
          ))}

        {!other && !active && (
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

  if (other) {
    return (
      <Alert kind="error" className="flex items-center justify-between gap-3">
        <span>
          You already have a call in progress on another {otherHref ? "customer" : "order"}.
        </span>
        {otherHref ? (
          <Link
            href={otherHref}
            className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Return to active call
          </Link>
        ) : (
          <Button type="button" size="sm" variant="secondary" onClick={() => onOpenActive(other.order_id!)}>
            Return to active call
          </Button>
        )}
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
