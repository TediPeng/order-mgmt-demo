import { cn } from "@/lib/utils";
import type { ReturnStats } from "@/lib/orders-lookup";

/**
 * How this customer's parcels have ended, as a bar the width of a word.
 *
 * Modelled on the indicator Pancake shows against a customer, and using its
 * arithmetic: returns as a share of the deliveries that finished, not of the
 * ones that succeeded. A customer whose only parcel came back reads 100%, which
 * is the honest answer and the one `returned / delivered` cannot give — that
 * divides by zero on precisely the customer worth flagging.
 *
 * Green then red, in proportion, because the question an agent has before
 * dialling is not really a percentage: it is whether this number has form. Two
 * segments answer that before the number is read.
 */
export function ReturnRateBar({ stats, className }: { stats: ReturnStats; className?: string }) {
  const finished = stats.delivered + stats.returned;
  // Nothing has completed yet — and a bar of one colour would imply it had.
  // Most numbers are here: Pancake has only been reporting since 2026-08-10.
  if (finished === 0) return null;

  const ratePct = Math.round((stats.returned / finished) * 100);
  const deliveredPct = 100 - (stats.returned / finished) * 100;

  // One finished parcel is a fact, not a rate. Saying "100%" of it invites a
  // decision the evidence does not carry, so the figure is withheld and the
  // counts are left to speak.
  const tooThin = finished < 3;

  const title = tooThin
    ? `Successful orders: ${stats.delivered} / Returned orders: ${stats.returned}\nToo few finished orders to read as a rate`
    : `Successful orders: ${stats.delivered} / Returned orders: ${stats.returned}\nReturn rate: ${ratePct}%`;

  return (
    <span className={cn("inline-flex items-center gap-1.5 align-middle", className)} title={title}>
      <span
        aria-hidden
        className="inline-flex h-1.5 w-14 overflow-hidden rounded-full bg-slate-200"
      >
        <span className="h-full bg-green-600" style={{ width: `${deliveredPct}%` }} />
        <span className="h-full bg-red-500" style={{ width: `${100 - deliveredPct}%` }} />
      </span>
      <span className={cn("text-[11px] font-medium", stats.returned > 0 ? "text-red-700" : "text-slate-500")}>
        {tooThin ? `${stats.delivered}/${stats.returned}` : `${ratePct}%`}
      </span>
      {/* The bar is decorative; this is what a screen reader is given. */}
      <span className="sr-only">
        {stats.delivered} successful, {stats.returned} returned
        {tooThin ? "" : `, return rate ${ratePct}%`}
      </span>
    </span>
  );
}
