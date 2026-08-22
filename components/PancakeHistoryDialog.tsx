"use client";

import { Button } from "@/components/ui/Button";
import { LEAD_STATUS_STYLES } from "@/components/ui/Badge";
import { LEAD_STATUS_LABELS } from "@/lib/validation";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import type { OrderStatus } from "@/lib/types";

/** One parcel as the panel lists it — mirrors PancakeOrderRow on the server. */
export interface PancakeHistoryOrder {
  id: string;
  date: string | null;
  status: string;
  statusName: string | null;
  total: number | null;
}

/**
 * A customer's parcels, as Pancake POS holds them.
 *
 * Opened from the return-rate bar, because the bar answers "how often" and the
 * next question is always "when, and what". A rate of 42% built on returns from
 * a year ago is a different conversation from the same rate built on last week,
 * and the bar alone cannot tell them apart.
 *
 * Four statuses only: delivered and returned, which the rate counts, plus
 * shipped and returning, which are still moving. A customer's carts,
 * confirmations and cancellations are noise against the question being asked.
 * The note at the foot says so outright — without it the list and the
 * percentage look like they disagree.
 */
export function PancakeHistoryDialog({
  phone,
  delivered,
  returned,
  orders,
  onClose,
}: {
  phone: string;
  delivered: number;
  returned: number;
  orders: PancakeHistoryOrder[];
  onClose: () => void;
}) {
  const finished = delivered + returned;
  const ratePct = finished > 0 ? Math.round((returned / finished) * 100) : 0;
  const tooThin = finished < 3;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 whitespace-normal" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pancake-history-title"
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 border-b border-slate-100 bg-white px-5 py-3">
          <h3 id="pancake-history-title" className="text-base font-semibold text-slate-900">
            Order history in Pancake
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">{phone} · last 24 months</p>
        </div>

        <div className="grid grid-cols-3 gap-3 border-b border-slate-100 px-5 py-4">
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs text-slate-500">Delivered</p>
            <p className="mt-0.5 text-2xl font-semibold text-green-700">{delivered}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs text-slate-500">Returned</p>
            <p className="mt-0.5 text-2xl font-semibold text-red-700">{returned}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs text-slate-500">Return rate</p>
            {/* Under three finished parcels the figure is withheld here too, so
                the panel and the bar never disagree about what the evidence
                carries. */}
            <p className="mt-0.5 text-2xl font-semibold text-slate-900">{tooThin ? "—" : `${ratePct}%`}</p>
          </div>
        </div>

        {orders.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-400">
            Pancake has no delivered, returned, shipped or returning parcel on this number.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="px-5 py-2 font-medium">Date</th>
                <th className="py-2 font-medium">Order</th>
                <th className="py-2 font-medium">Status</th>
                <th className="px-5 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o, i) => {
                const known = (LEAD_STATUS_STYLES as Record<string, { badge: string }>)[o.status];
                return (
                  <tr key={`${o.id}|${i}`} className="border-t border-slate-100">
                    <td className="whitespace-nowrap px-5 py-2 text-slate-500">{o.date ? formatDate(o.date) : "—"}</td>
                    <td className="py-2 font-mono text-xs text-slate-600">{o.id ? `#${o.id}` : "—"}</td>
                    <td className="py-2">
                      <span
                        className={cn(
                          "inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                          known ? known.badge : "bg-slate-100 text-slate-700"
                        )}
                      >
                        {/* Our own label where the status is one we know, so the
                            panel reads like the rest of the app; Pancake's own
                            wording only where it is not. */}
                        {LEAD_STATUS_LABELS[o.status as OrderStatus] || o.statusName || o.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-2 text-right text-slate-700">
                      {o.total != null ? formatCurrency(o.total) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* A named button rather than the bare × it replaced. At 16px in a
            corner that icon is a small target and says nothing about what it
            does; the rest of this app closes its dialogs with a labelled
            button, and this one should read the same. */}
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-5 py-3">
          <p className="max-w-xs text-xs text-slate-400">
            Live from Pancake POS. Only delivered and returned count toward the rate — shipped and returning are still
            moving.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
