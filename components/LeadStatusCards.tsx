import Link from "next/link";
import { cn } from "@/lib/utils";
import { LEAD_STATUS_LABELS, LEAD_STATUSES } from "@/lib/validation";
import { LEAD_STATUS_STYLES } from "@/components/ui/Badge";
import { StatusFilterSelect, type StatusFilterOption } from "@/components/StatusFilterSelect";
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
 * not earn a card or a line in the filter.
 *
 * A lead sitting in one of these is still counted in All Leads and still opens
 * from its row; what it loses is a way to be filtered down to, which is the
 * trade for a filter short enough to read. */
const UNUSED_ON_THIS_FLOOR: readonly OrderStatus[] = [
  "waiting_confirmation",
  "confirmed",
  "restocking",
  "purchased",
  "wait_for_printing",
  "deleted",
  // Pancake's own bookkeeping, both of them. Money is collected after this
  // floor is done with the order, and a partial return is settled in Pancake
  // against the shipment — neither is an outcome anybody here calls a lead to
  // reach, so neither was ever filtered on.
  "collected_money",
  "partial_return",
];

export const QUICK_FILTER_STATUSES = LEAD_STATUSES.filter((s) => !UNUSED_ON_THIS_FLOOR.includes(s));

/**
 * The statuses that get a card. Everything else is in the dropdown beside them.
 *
 * Twenty-two cards wrapped into three rows and pushed the leads table off the
 * screen, so the page opened on a wall of mostly-zero counters instead of on the
 * work. These five are what the floor actually watches: what has just come in,
 * what is being packed, and the three ways an order ends.
 *
 * The dropdown still filters by any of them, so nothing became unreachable —
 * only less shouted about.
 */
const CARD_STATUSES: readonly OrderStatus[] = ["new", "packaging", "delivered", "returned", "odz"];

export interface StatusCount {
  status: OrderStatus;
  count: number;
}

export function LeadStatusCards({
  counts,
  total,
  selected,
  prevSelected,
  prevStatusCounts = [],
  hrefFor,
  prevHrefFor,
}: {
  counts: StatusCount[];
  total: number;
  selected?: string;
  /** The previous-order status being filtered on, if any. */
  prevSelected?: string;
  /** The PREV STATUS values actually present in the leads, with counts —
   * read from the column, not from the status enum. */
  prevStatusCounts?: { value: string; count: number }[];
  /** Builds the link for a card, so the caller keeps any other active filters. */
  hrefFor: (status?: string) => string;
  /** Same, for the Prev Status filter. Omit to leave that filter off the page. */
  prevHrefFor?: (status?: string) => string;
}) {
  const byStatus = new Map(counts.map((c) => [c.status, c.count]));

  // Every status is selectable from the dropdown, including the five that also
  // have a card — a filter that omitted whatever you were already looking at
  // would have nothing to show as its current value.
  const options: StatusFilterOption[] = [
    { value: "", label: "All Leads", href: hrefFor(undefined), count: total },
    ...QUICK_FILTER_STATUSES.map((status) => ({
      value: status,
      label: LEAD_STATUS_LABELS[status],
      href: hrefFor(status),
      count: byStatus.get(status) ?? 0,
    })),
  ];

  return (
    <div className="mb-4 flex flex-wrap items-stretch gap-2">
      <Link
        href={hrefFor(undefined)}
        className={cn(
          "min-w-[7rem] rounded-lg border bg-white px-3 py-2 transition-colors hover:border-slate-300",
          !selected ? "border-[var(--brand-primary)] ring-1 ring-[var(--brand-primary)]" : "border-slate-200"
        )}
      >
        <span className="block text-xs font-medium text-slate-500">All Leads</span>
        <span className="text-lg font-semibold text-slate-900">{total}</span>
      </Link>

      {CARD_STATUSES.map((status) => {
        const active = selected === status;
        const style = LEAD_STATUS_STYLES[status];
        return (
          <Link
            key={status}
            href={hrefFor(status)}
            className={cn(
              "min-w-[7rem] rounded-lg border bg-white px-3 py-2 transition-colors hover:border-slate-300",
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

      {/* Every other status, with its count, in the space the cards no longer
          fill. It sits in the same row so the two are read as one control: the
          five you watch, and the way to reach the rest. */}
      <div className="flex items-center gap-3">
        <StatusFilterSelect options={options} value={selected ?? ""} />
        {/* Where the lead came FROM, beside where it is. Its options are read
            from the PREV STATUS column itself rather than from the status enum:
            the column is free text, and its third largest value — REJECT
            UPSELL, on nearly five thousand leads — was never a status this
            system had. Built from the enum, the filter would have offered names
            matching nothing and hidden the ones that matter. */}
        {prevHrefFor && (
          <StatusFilterSelect
            label="Prev Status"
            placeholder="Search previous status"
            value={prevSelected ?? ""}
            options={[
              {
                value: "",
                label: "Any previous status",
                href: prevHrefFor(undefined),
                count: prevStatusCounts.reduce((n, p) => n + p.count, 0),
              },
              ...prevStatusCounts.map((p) => ({
                value: p.value,
                label: p.value,
                href: prevHrefFor(p.value),
                count: p.count,
              })),
            ]}
          />
        )}
      </div>
    </div>
  );
}
