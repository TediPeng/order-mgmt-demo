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
  ready_to_ship: {
    badge: "bg-green-100 text-green-700",
    row: "bg-green-50",
    rowHover: "hover:bg-green-100",
    header: "bg-green-500",
  },
  // Fulfillment (Pancake-driven). Confirmed takes cyan per the integration
  // spec; legacy Printed moved to sky to stay distinguishable.
  confirmed: { badge: "bg-cyan-100 text-cyan-700", row: "bg-cyan-50", rowHover: "hover:bg-cyan-100", header: "bg-cyan-500" },
  printed: { badge: "bg-sky-100 text-sky-700", row: "bg-sky-50", rowHover: "hover:bg-sky-100", header: "bg-sky-500" },
  shipped: {
    badge: "bg-indigo-100 text-indigo-700",
    row: "bg-indigo-50",
    rowHover: "hover:bg-indigo-100",
    header: "bg-indigo-500",
  },
  // Amber, a deliberately different shade family from Ringing's yellow.
  in_transit: {
    badge: "bg-amber-200 text-amber-900",
    row: "bg-amber-100/70",
    rowHover: "hover:bg-amber-200",
    header: "bg-amber-600",
  },
  // Brown/dark orange, darker than CBR's orange.
  failed_delivery: {
    badge: "bg-orange-200 text-orange-950",
    row: "bg-orange-100",
    rowHover: "hover:bg-orange-200",
    header: "bg-orange-800",
  },
  delivered: { badge: "bg-teal-100 text-teal-700", row: "bg-teal-50", rowHover: "hover:bg-teal-100", header: "bg-teal-500" },
  returned: { badge: "bg-red-900/10 text-red-900", row: "bg-red-50/70", rowHover: "hover:bg-red-100", header: "bg-red-900" },
  cancelled: {
    badge: "bg-slate-300 text-slate-800",
    row: "bg-slate-100",
    rowHover: "hover:bg-slate-200",
    header: "bg-slate-600",
  },
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", LEAD_STATUS_STYLES[status].badge)}>
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
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", style.chip, className)}>
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
