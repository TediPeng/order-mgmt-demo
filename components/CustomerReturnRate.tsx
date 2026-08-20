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
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const value = (phone || "").trim();
    if (!value) return;
    let cancelled = false;
    fetch(`/api/pancake/customer-history?phone=${encodeURIComponent(value)}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !j?.ok || !j.history || j.history.error) return;
        setStats({ delivered: j.history.delivered, returned: j.history.returned });
        setOrders(Array.isArray(j.history.orders) ? j.history.orders : []);
      })
      .catch(() => {
        /* Silent: extra context, not something to interrupt the page over. */
      });
    return () => {
      cancelled = true;
    };
  }, [phone]);

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
