"use client";

import { useState } from "react";
import { PhoneCall } from "lucide-react";
import { useCallSession } from "@/components/CallSessionProvider";
import { StatusBadge } from "@/components/ui/Badge";
import { shortOrderId } from "@/lib/types";
import type { Order } from "@/lib/types";

/**
 * Where a lead stands, and the call that changes it.
 *
 * The status was briefly a dropdown here. It is set in the order itself now —
 * the popup opens straight into the form, so the status sits beside the fields
 * whose validity it depends on, and a lead cannot be moved to Packaging from a
 * table cell that knows nothing about whether it has a price on it.
 *
 * What the row keeps is the reading: the status it is on, and the one it came
 * from. Changing it is one press away.
 */
export function LeadStatusCell({
  order,
  previousStatus,
  onOpen,
}: {
  order: Order;
  /** The status this lead moved away from, for the line above the badge. */
  previousStatus?: string | null;
  /** Opens the order — what CALL does once the call is running. */
  onOpen: () => void;
}) {
  const { session, startCall } = useCallSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The order already holding this agent's call, when that is what stopped us. */
  const [blockedBy, setBlockedBy] = useState<{ id: string; order_number: string } | null>(null);

  const callActive = Boolean(session && session.order_id === order.id);
  /** A call open on some OTHER order — one per agent is enforced server-side. */
  const otherCall = session && session.order_id !== order.id ? session : null;

  async function beginCall() {
    setBusy(true);
    setError(null);
    setBlockedBy(null);
    const result = await startCall(order.id);
    setBusy(false);

    if (result.ok) {
      onOpen();
      return;
    }

    // One call at a time is the rule, and being told so is not enough: the way
    // out is to finish the call already running, which is on a different row —
    // possibly a different page. Name it and offer to go there, rather than
    // leaving a red sentence with nothing to press.
    if (result.activeOrder) {
      setBlockedBy(result.activeOrder);
      return;
    }

    // Anything else — not timed in, most often — is explained properly by the
    // panel inside the order, which carries the Go to Time In link.
    onOpen();
    setError(result.error || "Could not start the call.");
  }

  return (
    <div className="space-y-1">
      {/* Where it came from, above where it is. "CBR" alone does not say
          whether a lead has just been picked up or given up on. */}
      {previousStatus && previousStatus !== order.status && (
        <span className="block text-[10px] uppercase leading-none text-slate-400">
          from {previousStatus.replace(/_/g, " ")}
        </span>
      )}

      <div className="flex items-center gap-1.5">
        <StatusBadge status={order.status} />

        {/* A call is already running somewhere else, so CALL here can only
            fail. Offering the way back instead of the button that refuses is
            the difference between a control and a trap. */}
        {otherCall && (
          <a
            href={`/leads?open_id=${otherCall.order_id}`}
            title="Finish the call you have open before starting another"
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50"
          >
            <PhoneCall className="h-3 w-3" /> Return to call
          </a>
        )}

        {/* Everyone, not only the roles the call rule applies to. A supervisor
            rings a customer too, and this is also the shortest way from the
            list into the order. */}
        {!callActive && !otherCall && (
          <button
            type="button"
            onClick={beginCall}
            disabled={busy}
            title="Start the call and open this order"
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[var(--brand-primary)] px-2 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <PhoneCall className="h-3 w-3" /> CALL
          </button>
        )}
        {callActive && (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-green-100 px-2 py-1 text-xs font-medium text-green-800"
            title="This call is in progress"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-600" />
            </span>
            On call
          </span>
        )}
      </div>

      {/* The way out of "one call at a time" is the call itself. open_id is how
          the page pins an order that may be on another page or behind a filter,
          which is the same route "Return to active call" takes in the popup. */}
      {blockedBy && (
        <span className="block max-w-[13rem] text-[10px] leading-tight text-slate-500">
          On a call with{" "}
          <a
            href={`/leads?open_id=${blockedBy.id}`}
            className="font-medium text-[var(--brand-primary)] hover:underline"
          >
            {shortOrderId({ order_number: blockedBy.order_number, pancake_order_id: null })}
          </a>{" "}
          — finish it first.
        </span>
      )}

      {error && <span className="block max-w-[13rem] text-[10px] leading-tight text-red-600">{error}</span>}
    </div>
  );
}
