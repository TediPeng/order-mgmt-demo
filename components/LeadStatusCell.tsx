"use client";

import { useState } from "react";
import { PhoneCall } from "lucide-react";
import { useCallSession } from "@/components/CallSessionProvider";
import { LEAD_STATUS_LABELS, selectableStatuses } from "@/lib/validation";
import { isOrderLocked } from "@/lib/lead-workflow";
import { buildRawFromOrder } from "@/lib/lead-payload";
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

  const callActive = Boolean(session && session.order_id === order.id);
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
    const result = await startCall(order.id);
    setBusy(false);
    // Open the order either way: on success it is the panel the call is worked
    // from, and on failure it is where the reason — timed out, already on
    // another call — is explained in full.
    onOpen();
    if (!result.ok) setError(result.error || "Could not start the call.");
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

        {/* Only where a call is the rule. Management opens the order instead. */}
        {requiresCallSession && !callActive && (
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

      {error && <span className="block max-w-[12rem] text-[10px] leading-tight text-red-600">{error}</span>}
    </div>
  );
}
