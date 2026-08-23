"use client";

import { useEffect, useState } from "react";
import { ReturnRateBar, type ReturnStats } from "@/components/ReturnRateBar";
import { PancakeHistoryDialog, type PancakeHistoryOrder } from "@/components/PancakeHistoryDialog";

/**
 * The return-rate bar and its history panel, wherever a phone number is shown.
 *
 * The order popup grew this inline, and then Regular Customers wanted it too —
 * which is the moment to lift it out rather than write the fetch, the state and
 * the dialog a second time. Two copies of a Pancake lookup would drift, and the
 * one that drifted would still look right.
 *
 * Client-side on purpose. It is one outbound call per number, and a server
 * component would make the page wait on Pancake before rendering anything: the
 * customer's own record is worth showing immediately, and this arrives when it
 * arrives. Nothing renders if the call fails or the number has no finished
 * parcels — a blank is honest, a zero would read as "never sent anything back".
 */
export function CustomerReturnRate({ phone, className }: { phone: string; className?: string }) {
  const [stats, setStats] = useState<ReturnStats | null>(null);
  const [orders, setOrders] = useState<PancakeHistoryOrder[]>([]);
  /** Rows Pancake holds for this number at any status — tells "nothing finished
   * yet" apart from "Pancake has never seen them". */
  const [totalOrders, setTotalOrders] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const value = (phone || "").trim();
    if (!value) return;
    let cancelled = false;
    setFailed(null);
    fetch(`/api/pancake/customer-history?phone=${encodeURIComponent(value)}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (!j?.ok || !j.history) return setFailed("Pancake POS did not answer.");
        if (j.history.error) return setFailed(String(j.history.error));
        setStats({ delivered: j.history.delivered, returned: j.history.returned });
        setTotalOrders(Number(j.history.totalOrders) || 0);
        setOrders(Array.isArray(j.history.orders) ? j.history.orders : []);
      })
      .catch((e) => {
        if (!cancelled) setFailed(e instanceof Error ? e.message : "Could not reach Pancake POS.");
      });
    return () => {
      cancelled = true;
    };
  }, [phone]);

  /**
   * A blank used to mean three different things.
   *
   * "No finished parcels", "Pancake has never seen this number" and "the lookup
   * failed" all rendered as nothing at all, so an agent who expected a rate and
   * saw none had no way to tell which — and neither did anyone asked to check.
   * Only the middle one is genuinely nothing to say.
   */
  if (failed) {
    return (
      <span
        className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800"
        title={`Return rate unavailable — ${failed}`}
      >
        RTS unavailable
      </span>
    );
  }
  if (stats && stats.delivered + stats.returned === 0 && totalOrders > 0) {
    return (
      <span
        className="text-[11px] text-slate-400"
        title={`Pancake holds ${totalOrders} order${totalOrders === 1 ? "" : "s"} for this number, none of them finished yet.`}
      >
        No finished parcels yet
      </span>
    );
  }
  if (!stats) return null;

  return (
    <>
      <ReturnRateBar stats={stats} onClick={() => setOpen(true)} className={className} />
      {open && (
        <PancakeHistoryDialog
          phone={phone}
          delivered={stats.delivered}
          returned={stats.returned}
          orders={orders}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
