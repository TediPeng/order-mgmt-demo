"use client";

import { useState } from "react";
import { PhoneCall } from "lucide-react";
import { useCallSession } from "@/components/CallSessionProvider";
import { LEAD_STATUS_LABELS, selectableStatuses } from "@/lib/validation";
import { isOrderLocked } from "@/lib/lead-workflow";
import { buildRawFromOrder } from "@/lib/lead-payload";
import { shortOrderId } from "@/lib/types";
import type { Order } from "@/lib/types";

/**
 * The status of a lead, changeable where it is read, with the call that has to
 * come first sitting beside it.
 *
 * Setting a status used to mean: open the popup, press Calling, press Edit,
 * walk two steps of a wizard, save. The status is the whole point of the call
 * and it was the furthest thing from the row.
 *
 * The dropdown obeys the same rule the server does — an agent may not move a
 * lead without a call open on it (applyLeadUpdate refuses otherwise), so the
 * control is disabled until Calling has been pressed rather than offering an
 * action that would come back as an error. Management has no such rule and the
 * dropdown is simply live for them.
 *
 * Calling shows for everyone regardless: a supervisor rings a customer too, and
 * starting a call is the fastest way to open an order from the list. The route
 * that opens a session does not care about the role — only that the person has
 * timed in — so the button is never offered to somebody who cannot use it for a
 * reason the popup will not explain.
 */
export function LeadStatusCell({
  order,
  canEdit,
  requiresCallSession,
  userIsFullAccess,
  previousStatus,
  onOpen,
  onSaved,
}: {
  order: Order;
  canEdit: boolean;
  /** Agents must be on a call; Management must not. */
  requiresCallSession: boolean;
  userIsFullAccess: boolean;
  /** The status this lead moved away from, for the line above the control. */
  previousStatus?: string | null;
  /** Opens the full popup — what Calling does once the call is running. */
  onOpen: () => void;
  onSaved: (updated: Order) => void;
}) {
  const { session, startCall } = useCallSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The order already holding this agent's call, when that is what stopped us. */
  const [blockedBy, setBlockedBy] = useState<{ id: string; order_number: string } | null>(null);

  const callActive = Boolean(session && session.order_id === order.id);
  /** A call open on some OTHER order — one per agent is enforced server-side. */
  const otherCall = session && session.order_id !== order.id ? session : null;
  const syncedLocked = isOrderLocked(order);
  const canChange = canEdit && !syncedLocked && (!requiresCallSession || callActive);

  async function changeStatus(next: string) {
    if (next === order.status) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRawFromOrder(order, { status: next })),
      });
      const json = await res.json();
      if (!json.ok) {
        // Kept short: this sits in a table cell. The popup gives the long
        // version, including which fields Packaging is still missing.
        setError(json.error || "Could not save.");
        return;
      }
      onSaved(json.order as Order);
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

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
        <select
          value={order.status}
          disabled={!canChange || busy}
          onChange={(e) => changeStatus(e.target.value)}
          title={
            syncedLocked
              ? "Synced to Pancake POS — locked"
              : !canChange
                ? "Start the call first"
                : "Change the status of this lead"
          }
          className="max-w-[11rem] rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
        >
          {selectableStatuses(userIsFullAccess, order.status).map((s) => (
            <option key={s} value={s}>
              {LEAD_STATUS_LABELS[s]}
            </option>
          ))}
        </select>

        {/* A call is already running somewhere else, so Calling here can only
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

        {/* Everyone, not only the roles the call rule applies to. A
            supervisor rings a customer too, and the button is also the fastest
            way to open the order from the list. */}
        {!callActive && !otherCall && (
          <button
            type="button"
            onClick={beginCall}
            disabled={busy}
            title="Start the call and open this order"
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[var(--brand-primary)] px-2 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <PhoneCall className="h-3 w-3" /> Calling
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
