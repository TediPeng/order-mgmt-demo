"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { regCxAuditTargetsAction, regCxAuditBatchAction, type RegCxAuditRow } from "@/lib/actions/regular-customers";

/** Small, because every customer in a batch is a Pancake round trip and the
 * whole point is that no single request runs long enough to be killed. */
const BATCH = 10;

const LABELS: Record<string, string> = {
  QUALIFIED: "Would keep",
  INSUFFICIENT_DELIVERED_ORDERS: "Under 3 delivered",
  ORDER_SOURCE_CALLER_MISMATCH: "Source and caller both differ",
  NO_PANCAKE_HISTORY: "Nothing in Pancake",
  PANCAKE_UNAVAILABLE: "Could not check",
};

const TONES: Record<string, string> = {
  QUALIFIED: "bg-green-100 text-green-700",
  INSUFFICIENT_DELIVERED_ORDERS: "bg-amber-100 text-amber-800",
  ORDER_SOURCE_CALLER_MISMATCH: "bg-amber-100 text-amber-800",
  NO_PANCAKE_HISTORY: "bg-red-100 text-red-700",
  PANCAKE_UNAVAILABLE: "bg-slate-200 text-slate-600",
};

/**
 * Checks every existing regular customer against the REG CX rules, and changes
 * nothing.
 *
 * The rule went live before anybody had seen it pass. Applying it to 2,678
 * records that hold 1,231 orders between them, on that basis, would not be a
 * cleanup — so this answers the question first: how many would survive, and
 * which of the four reasons accounts for the rest.
 *
 * "Could not check" is kept as its own count and never folded into the
 * failures. A Pancake that did not answer is not evidence about a customer, and
 * a sweep that treated it as one would recommend deleting people for a timeout.
 */
export function RegCxAuditClient() {
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<RegCxAuditRow[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  function run() {
    setError(null);
    setRows([]);
    setFinished(false);
    startTransition(async () => {
      try {
        const ids = await regCxAuditTargetsAction();
        setProgress({ done: 0, total: ids.length });
        const collected: RegCxAuditRow[] = [];
        for (let i = 0; i < ids.length; i += BATCH) {
          const part = await regCxAuditBatchAction(ids.slice(i, i + BATCH));
          collected.push(...part);
          setRows([...collected]);
          setProgress({ done: Math.min(i + BATCH, ids.length), total: ids.length });
        }
        setFinished(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "The check stopped before it finished.");
      }
    });
  }

  const tally = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.result] = (acc[r.result] || 0) + 1;
    return acc;
  }, {});
  const ordersAtRisk = rows.filter((r) => r.result !== "QUALIFIED" && r.result !== "PANCAKE_UNAVAILABLE")
    .reduce((s, r) => s + r.ordersHeld, 0);

  return (
    <div className="space-y-4">
      <Alert kind="info">
        This reads Pancake and writes nothing. No customer is tagged, untagged or deleted by running it — it answers
        which of the existing regular customers would satisfy the rules, and why the rest would not.
      </Alert>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={run} disabled={pending}>
          {pending ? "Checking…" : "Check every regular customer"}
        </Button>
        {progress && (
          <span className="text-sm text-slate-500 tabular-nums">
            {progress.done} of {progress.total} checked
            {finished && " — finished"}
          </span>
        )}
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {rows.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {Object.keys(LABELS).map((key) => (
              <div key={key} className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-2xl font-semibold tabular-nums text-slate-800">{tally[key] || 0}</p>
                <p className="mt-0.5 text-xs text-slate-500">{LABELS[key]}</p>
              </div>
            ))}
          </div>

          {ordersAtRisk > 0 && (
            <Alert kind="warning">
              The customers that would fail hold <span className="font-semibold">{ordersAtRisk}</span> order
              {ordersAtRisk === 1 ? "" : "s"} between them. Deleting those records would unlink that history.
            </Alert>
          )}

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[760px] text-left text-table">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Agent</th>
                  <th className="px-3 py-2 text-right">Delivered</th>
                  <th className="px-3 py-2 text-right">In Pancake</th>
                  <th className="px-3 py-2 text-right">Orders held</th>
                  <th className="px-3 py-2">Verdict</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.customerId} className="hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <span className="font-medium text-slate-800">{r.name}</span>
                      <span className="ml-2 text-xs text-slate-400">{r.phone}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{r.agent}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{r.deliveredCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.totalOrders}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.ordersHeld}</td>
                    <td className="px-3 py-2">
                      <Badge className={TONES[r.result] || "bg-slate-100 text-slate-600"}>
                        {LABELS[r.result] || r.result}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
