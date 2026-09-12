"use client";

import { useState } from "react";
import Link from "next/link";
import { PhoneCall, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { formatElapsed, useCallSession } from "@/components/CallSessionProvider";
import { dialHref, type DialScheme } from "@/lib/dial";
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
 *
 * It also DIALS. That is new, and it is the whole point.
 *
 * Pressing Calling and dialling the customer used to be two separate acts in
 * two separate places -- this button opened the session, and the number beside
 * it opened the softphone -- with nothing joining them. An agent who pressed
 * one and not the other left a call ROMA had a record of and the phone system
 * had never seen: no duration, no answered/unanswered, no recording, nothing
 * for anybody to review. Between 9 and 12 September that was 3,488 sessions,
 * and they were LONGER than the ones with a call behind them (median 85s
 * against 65s), so they were real conversations, not stray clicks.
 *
 * One press now does both halves, in this order: open the session, then dial.
 * Never the other way round. A phone that rings on a call ROMA refused -- the
 * agent has not timed in, or already has a call open elsewhere -- is the one
 * outcome worth avoiding, and the refusal is the answer the agent sees.
 */
export function CallingPanel({
  orderId,
  customerId,
  dialPhone,
  dialScheme,
  onStarted,
  onEnded,
  onOpenActive,
  compact = false,
}: {
  /** The lead being called. Omit for a call on a regular customer. */
  orderId?: string;
  /** The regular customer being called, when there is no order yet. */
  customerId?: string;
  /**
   * The number to ring once the session is open.
   *
   * Required rather than optional, so a new place that shows this panel has to
   * answer the question rather than quietly go back to the old behaviour --
   * which looked identical and recorded a call nobody could listen to. Pass
   * null where there is genuinely no number.
   */
  dialPhone: string | null | undefined;
  /** How this agent's browser hands a number over. "off" means do not dial. */
  dialScheme: DialScheme;
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

  const willDial = Boolean(dialHref(dialPhone, dialScheme));

  /**
   * Hand the number to the softphone.
   *
   * Through a real anchor click rather than assigning window.location, because
   * that is exactly what clicking the number in the leads row already does --
   * the one path known to work on the floor's PCs. A custom scheme set on
   * location can be treated as a navigation and fire an unload; a click is not
   * a navigation at all, and the page the agent is working in stays put.
   */
  function dial() {
    const href = dialHref(dialPhone, dialScheme);
    if (!href) return;
    const a = document.createElement("a");
    a.href = href;
    a.rel = "noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function start() {
    setBusy(true);
    setError(null);
    setTimeInBlocked(false);
    const result = orderId ? await startCall(orderId) : await startCustomerCall(customerId!);
    setBusy(false);
    if (result.ok) {
      // Session first, phone second. Always.
      dial();
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
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={start}
            title={
              willDial
                ? "Opens the call and rings the customer on your softphone"
                : "Opens the call. Dial the number yourself — click-to-call is off for you."
            }
          >
            <PhoneCall className="h-4 w-4" /> {busy ? "Starting…" : willDial ? "Call" : "Calling"}
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
          <p className="text-xs text-slate-500">
            {willDial
              ? "Press Call to ring the customer — it dials and starts the call record together."
              : "Click Calling before editing or updating this order."}
          </p>
          <Button type="button" size="sm" disabled={busy} onClick={start}>
            <PhoneCall className="h-4 w-4" /> {busy ? "Starting…" : willDial ? "Call" : "Calling"}
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
