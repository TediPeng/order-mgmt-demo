import { cn } from "@/lib/utils";
import type { LeaveStatus, OrderStatus } from "@/lib/types";
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
  ready_to_ship: {
    badge: "bg-green-100 text-green-700",
    row: "bg-green-50",
    rowHover: "hover:bg-green-100",
    header: "bg-green-500",
  },
  printed: { badge: "bg-cyan-100 text-cyan-700", row: "bg-cyan-50", rowHover: "hover:bg-cyan-100", header: "bg-cyan-500" },
  shipped: {
    badge: "bg-indigo-100 text-indigo-700",
    row: "bg-indigo-50",
    rowHover: "hover:bg-indigo-100",
    header: "bg-indigo-500",
  },
  delivered: { badge: "bg-teal-100 text-teal-700", row: "bg-teal-50", rowHover: "hover:bg-teal-100", header: "bg-teal-500" },
  returned: { badge: "bg-red-900/10 text-red-900", row: "bg-red-50/70", rowHover: "hover:bg-red-100", header: "bg-red-900" },
  hung_up: { badge: "bg-red-100 text-red-700", row: "bg-red-50", rowHover: "hover:bg-red-100", header: "bg-red-500" },
  ringing: {
    badge: "bg-yellow-100 text-yellow-800",
    row: "bg-yellow-50",
    rowHover: "hover:bg-yellow-100",
    header: "bg-yellow-500",
  },
  cbr: { badge: "bg-orange-100 text-orange-700", row: "bg-orange-50", rowHover: "hover:bg-orange-100", header: "bg-orange-500" },
  rsrv: { badge: "bg-purple-100 text-purple-700", row: "bg-purple-50", rowHover: "hover:bg-purple-100", header: "bg-purple-500" },
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", LEAD_STATUS_STYLES[status].badge)}>
      {LEAD_STATUS_LABELS[status]}
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
