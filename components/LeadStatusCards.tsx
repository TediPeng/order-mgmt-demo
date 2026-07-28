import Link from "next/link";
import { cn } from "@/lib/utils";
import { LEAD_STATUS_LABELS } from "@/lib/validation";
import { LEAD_STATUS_STYLES } from "@/components/ui/Badge";
import type { OrderStatus } from "@/lib/types";

/** The statuses an agent works with day to day, in call-then-outcome order.
 * Deliberately a short list rather than all 21 — these are the buckets an
 * agent actually triages, and the counts come from one grouped query. */
export const QUICK_FILTER_STATUSES = [
  "new",
  "ringing",
  "hung_up",
  "cbr",
  "rsrv",
  "delivered",
  "returned",
  "returning",
] as const;

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
