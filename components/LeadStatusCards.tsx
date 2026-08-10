import Link from "next/link";
import { cn } from "@/lib/utils";
import { LEAD_STATUS_LABELS, LEAD_STATUSES } from "@/lib/validation";
import { LEAD_STATUS_STYLES } from "@/components/ui/Badge";
import type { OrderStatus } from "@/lib/types";

/**
 * Every status, in pipeline order: the call outcomes first, then fulfillment
 * as Pancake runs it.
 *
 * This was a hand-picked eight, which meant a lead that had moved into any
 * other status was counted in All Leads and nowhere else — the number was
 * there but nothing said where it had gone. Derived from LEAD_STATUSES now, so
 * a status added there appears here without a second edit.
 */
/** Stages this floor never works in. They exist in the enum because Pancake
 * has them and an inbound sync may still set one, and an Administrator can
 * still pick them in the Status dropdown to correct a record — they simply do
 * not earn a card of their own. */
const UNUSED_ON_THIS_FLOOR: readonly OrderStatus[] = [
  "waiting_confirmation",
  "confirmed",
  "restocking",
  "purchased",
  "wait_for_printing",
  "deleted",
];

export const QUICK_FILTER_STATUSES = LEAD_STATUSES.filter((s) => !UNUSED_ON_THIS_FLOOR.includes(s));

export interface StatusCount {
  status: OrderStatus;
  count: number;
}

export function LeadStatusCards({
  counts,
  total,
  selected,
  hrefFor,
}: {
  counts: StatusCount[];
  total: number;
  selected?: string;
  /** Builds the link for a card, so the caller keeps any other active filters. */
  hrefFor: (status?: string) => string;
}) {
  const byStatus = new Map(counts.map((c) => [c.status, c.count]));

  return (
    <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
      <Link
        href={hrefFor(undefined)}
        className={cn(
          "rounded-lg border bg-white px-3 py-2 transition-colors hover:border-slate-300",
          !selected ? "border-[var(--brand-primary)] ring-1 ring-[var(--brand-primary)]" : "border-slate-200"
        )}
      >
        <span className="block text-xs font-medium text-slate-500">All Leads</span>
        <span className="text-lg font-semibold text-slate-900">{total}</span>
      </Link>

      {QUICK_FILTER_STATUSES.map((status) => {
        const active = selected === status;
        const style = LEAD_STATUS_STYLES[status];
        return (
          <Link
            key={status}
            href={hrefFor(status)}
            className={cn(
              "rounded-lg border bg-white px-3 py-2 transition-colors hover:border-slate-300",
              active ? "border-[var(--brand-primary)] ring-1 ring-[var(--brand-primary)]" : "border-slate-200"
            )}
          >
            <span className="flex items-center gap-1.5">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", style.header)} aria-hidden />
              <span className="truncate text-xs font-medium text-slate-500">{LEAD_STATUS_LABELS[status]}</span>
            </span>
            <span className="text-lg font-semibold text-slate-900">{byStatus.get(status) ?? 0}</span>
          </Link>
        );
      })}
    </div>
  );
}
