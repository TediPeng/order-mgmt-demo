import { cn } from "@/lib/utils";
import type { LeaveStatus, OrderStatus, PancakeSyncStatus } from "@/lib/types";
import { PANCAKE_SYNC_STATUS_LABELS } from "@/lib/types";
import { LEAD_STATUS_LABELS } from "@/lib/validation";

interface LeadStatusStyle {
  badge: string;
  row: string;
  rowHover: string;
  header: string;
}

// Centralized status → color map for the lead pipeline. Badge keeps the
// existing *-100/*-700 (light bg / dark text) pairing, which is already
// WCAG-readable; row/rowHover use progressively stronger tints of the same
// hue so the badge still stands out against the tinted row.
export const LEAD_STATUS_STYLES: Record<OrderStatus, LeadStatusStyle> = {
  new: { badge: "bg-blue-100 text-blue-700", row: "bg-blue-50", rowHover: "hover:bg-blue-100", header: "bg-blue-500" },
  ringing: {
    badge: "bg-yellow-100 text-yellow-800",
    row: "bg-yellow-50",
    rowHover: "hover:bg-yellow-100",
    header: "bg-yellow-500",
  },
  hung_up: { badge: "bg-red-100 text-red-700", row: "bg-red-50", rowHover: "hover:bg-red-100", header: "bg-red-500" },
  cbr: { badge: "bg-orange-100 text-orange-700", row: "bg-orange-50", rowHover: "hover:bg-orange-100", header: "bg-orange-500" },
  rsrv: { badge: "bg-purple-100 text-purple-700", row: "bg-purple-50", rowHover: "hover:bg-purple-100", header: "bg-purple-500" },
  // The four call outcomes added 2026-08-10. INC # is amber — the lead is
  // missing something and can be finished — while the three that end the call
  // sit in cooler, flatter tones, so a list of dead leads does not read as
  // urgent. `cancel` is the CALL's outcome and is deliberately not the same
  // red as `cancelled`, which is Pancake's fulfillment cancellation.
  inc: { badge: "bg-amber-100 text-amber-800", row: "bg-amber-50", rowHover: "hover:bg-amber-100", header: "bg-amber-500" },
  call_back: { badge: "bg-teal-100 text-teal-700", row: "bg-teal-50", rowHover: "hover:bg-teal-100", header: "bg-teal-500" },
  reject_offer: { badge: "bg-stone-200 text-stone-700", row: "bg-stone-50", rowHover: "hover:bg-stone-100", header: "bg-stone-500" },
  cancel: { badge: "bg-rose-100 text-rose-700", row: "bg-rose-50", rowHover: "hover:bg-rose-100", header: "bg-rose-500" },
  // Fulfillment (Pancake-driven), in Pancake's own pipeline order. The hues
  // walk warm → cool → green as an order progresses, then to red/grey for the
  // return and cancellation paths, so a glance down a tinted list reads as
  // progress. Confirmed keeps cyan per the integration spec.
  waiting_confirmation: {
    badge: "bg-amber-100 text-amber-800",
    row: "bg-amber-50",
    rowHover: "hover:bg-amber-100",
    header: "bg-amber-500",
  },
  confirmed: { badge: "bg-cyan-100 text-cyan-700", row: "bg-cyan-50", rowHover: "hover:bg-cyan-100", header: "bg-cyan-500" },
  restocking: { badge: "bg-lime-100 text-lime-800", row: "bg-lime-50", rowHover: "hover:bg-lime-100", header: "bg-lime-600" },
  purchased: {
    badge: "bg-violet-100 text-violet-700",
    row: "bg-violet-50",
    rowHover: "hover:bg-violet-100",
    header: "bg-violet-500",
  },
  wait_for_printing: {
    badge: "bg-zinc-200 text-zinc-800",
    row: "bg-zinc-100",
    rowHover: "hover:bg-zinc-200",
    header: "bg-zinc-500",
  },
  printed: { badge: "bg-sky-100 text-sky-700", row: "bg-sky-50", rowHover: "hover:bg-sky-100", header: "bg-sky-500" },
  // Packaging is the agent's "order is ready" action and inherits the green
  // that Ready to Ship used to carry — it is the milestone on the leads list.
  packaging: {
    badge: "bg-green-100 text-green-700",
    row: "bg-green-50",
    rowHover: "hover:bg-green-100",
    header: "bg-green-500",
  },
  waiting_pickup: { badge: "bg-pink-100 text-pink-700", row: "bg-pink-50", rowHover: "hover:bg-pink-100", header: "bg-pink-500" },
  shipped: {
    badge: "bg-indigo-100 text-indigo-700",
    row: "bg-indigo-50",
    rowHover: "hover:bg-indigo-100",
    header: "bg-indigo-500",
  },
  delivered: { badge: "bg-teal-100 text-teal-700", row: "bg-teal-50", rowHover: "hover:bg-teal-100", header: "bg-teal-500" },
  collected_money: {
    badge: "bg-emerald-100 text-emerald-800",
    row: "bg-emerald-50",
    rowHover: "hover:bg-emerald-100",
    header: "bg-emerald-600",
  },
  // Return path: rose then a heavier orange, both distinct from the orange on
  // Cannot Be Reached.
  returning: { badge: "bg-rose-100 text-rose-700", row: "bg-rose-50", rowHover: "hover:bg-rose-100", header: "bg-rose-500" },
  partial_return: {
    badge: "bg-orange-200 text-orange-950",
    row: "bg-orange-100",
    rowHover: "hover:bg-orange-200",
    header: "bg-orange-800",
  },
  returned: { badge: "bg-red-900/10 text-red-900", row: "bg-red-50/70", rowHover: "hover:bg-red-100", header: "bg-red-900" },
  cancelled: {
    badge: "bg-slate-300 text-slate-800",
    row: "bg-slate-100",
    rowHover: "hover:bg-slate-200",
    header: "bg-slate-600",
  },
  deleted: { badge: "bg-gray-200 text-gray-600", row: "bg-gray-100", rowHover: "hover:bg-gray-200", header: "bg-gray-500" },
  // Out of delivery zone: a solid dark blue-gray, deliberately the only filled
  // badge in the set so it never reads as Cancelled's light slate.
  odz: {
    badge: "bg-slate-700 text-white",
    row: "bg-slate-200/60",
    rowHover: "hover:bg-slate-300/70",
    header: "bg-slate-700",
  },
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    // A badge is a label, not a paragraph. "CANNOT BE REACHED" and "REJECT
    // OFFER" were breaking across two lines in a table cell, which made those
    // rows taller than the ones around them and left the whole column ragged.
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium",
        LEAD_STATUS_STYLES[status].badge
      )}
    >
      {LEAD_STATUS_LABELS[status]}
    </span>
  );
}

// Small colored indicator chip used everywhere a Pancake sync status appears
// (leads table column, Order Details popup, sync logs page).
const PANCAKE_SYNC_STATUS_STYLES: Record<PancakeSyncStatus, { chip: string; dot: string }> = {
  not_synced: { chip: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
  syncing: { chip: "bg-blue-100 text-blue-700", dot: "bg-blue-500" },
  synced: { chip: "bg-green-100 text-green-700", dot: "bg-green-500" },
  sync_failed: { chip: "bg-red-100 text-red-700", dot: "bg-red-500" },
};

/** `needsReview` renders the exhausted-retry case as "Sync Failed — needs
 * review"; it is a qualifier on sync_failed, not a status of its own. */
export function SyncStatusChip({
  status,
  needsReview = false,
  className,
}: {
  status: PancakeSyncStatus | null;
  needsReview?: boolean;
  className?: string;
}) {
  if (!status) return <span className={cn("text-xs text-slate-400", className)}>—</span>;
  const style = PANCAKE_SYNC_STATUS_STYLES[status];
  const label =
    status === "sync_failed" && needsReview
      ? `${PANCAKE_SYNC_STATUS_LABELS.sync_failed} — needs review`
      : PANCAKE_SYNC_STATUS_LABELS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        style.chip,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", style.dot, status === "syncing" && "animate-pulse")} />
      {label}
    </span>
  );
}

const LEAVE_STATUS_STYLES: Record<LeaveStatus, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  cancelled: "bg-slate-200 text-slate-600",
  returned_for_revision: "bg-orange-100 text-orange-700",
};

const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  returned_for_revision: "Returned for Revision",
};

export function LeaveStatusBadge({ status }: { status: LeaveStatus }) {
  return (
    <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", LEAVE_STATUS_STYLES[status])}>
      {LEAVE_STATUS_LABELS[status]}
    </span>
  );
}

export function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700", className)}>
      {children}
    </span>
  );
}
