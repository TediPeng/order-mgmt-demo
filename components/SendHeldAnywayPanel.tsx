"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import type { BulkSendResult } from "@/lib/actions/pancake";

/**
 * Overriding the repeat-buyer hold on several orders at once.
 *
 * Send anyway is per row, which is right for the one order somebody has just
 * looked into and wrong for a backlog. Fifty-seven orders were held on 10 Oct
 * and clearing them meant fifty-seven dialogs, so nobody cleared them.
 *
 * Deliberately a flat list of every held order rather than a control inside
 * each group. The groups are keyed by the customer's PREVIOUS Pancake order,
 * so one customer's four held orders are one group — and "send this group"
 * would be four parcels to one person, which is the exact thing the hold
 * exists to prevent. Ticking is the only shape that lets somebody send one of
 * the four.
 *
 * Nothing is ticked to begin with, and the reason is required. This is an
 * override: it should take as long as reading the list.
 */
export interface HeldRow {
  id: string;
  order_number: string;
  customer_name: string;
  amount: string;
  /** The previous parcel that is holding this one, already worded. */
  heldOn: string;
  /** Same phone as another row in the list — the one thing a person must see
   *  before ticking, because sending both is two parcels to one customer. */
  alsoOnThisNumber: number;
}

export function SendHeldAnywayPanel({
  rows,
  batchSize,
  action,
}: {
  rows: HeldRow[];
  /** How many one press can actually do. The button says this number. */
  batchSize: number;
  action: (ids: string[], reason: string) => Promise<BulkSendResult>;
}) {
  const [open, setOpen] = useState(false);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<BulkSendResult | null>(null);
  const [sending, startSending] = useTransition();

  if (rows.length === 0) return null;

  function toggle(id: string) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function send() {
    const ids = Array.from(ticked);
    startSending(async () => {
      const outcome = await action(ids, reason);
      setResult(outcome);
      // Only the ones that went are unticked, so what is left on screen is
      // what still needs doing rather than a cleared list and a number.
      if (outcome.sent > 0) {
        const failed = new Set(outcome.skipped.map((s) => s.order_number));
        setTicked((prev) => {
          const next = new Set<string>();
          for (const id of prev) {
            const row = rows.find((r) => r.id === id);
            if (row && failed.has(row.order_number)) next.add(id);
          }
          return next;
        });
      }
    });
  }

  const willSend = Math.min(ticked.size, batchSize);

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span>
          <span className="text-sm font-semibold text-amber-900">
            Send several held orders anyway
          </span>
          <span className="mt-0.5 block text-xs text-amber-800">
            {rows.length} order{rows.length === 1 ? "" : "s"} are held because the customer&apos;s last parcel has
            not settled. Tick the ones that should go out regardless.
          </span>
        </span>
        <span className="shrink-0 text-xs font-medium text-amber-900 underline">{open ? "Hide" : "Open"}</span>
      </button>

      {open && (
        <div className="border-t border-amber-200 p-4">
          {result && (
            <Alert
              kind={result.error ? "error" : result.skipped.length > 0 ? "warning" : "success"}
              className="mb-3"
            >
              {result.error ? (
                result.error
              ) : (
                <>
                  {result.sent} sent.
                  {result.remaining > 0 && ` ${result.remaining} still ticked — press again.`}
                  {result.skipped.length > 0 && (
                    <>
                      {" "}
                      {result.skipped.length} not sent:
                      <ul className="mt-1 space-y-0.5">
                        {result.skipped.map((sk) => (
                          <li key={sk.order_number} className="text-xs">
                            <span className="font-medium">{sk.order_number}</span> — {sk.reason}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
            </Alert>
          )}

          <ul className="max-h-80 divide-y divide-amber-100 overflow-y-auto rounded-md border border-amber-200 bg-white">
            {rows.map((r) => (
              <li key={r.id}>
                <label className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-amber-50">
                  <input
                    type="checkbox"
                    checked={ticked.has(r.id)}
                    onChange={() => toggle(r.id)}
                    className="mt-1 h-3.5 w-3.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-medium text-slate-800">{r.customer_name}</span>
                      <span className="text-xs text-slate-500">{r.order_number}</span>
                      <span className="text-xs font-medium text-slate-700">{r.amount}</span>
                      {r.alsoOnThisNumber > 1 && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
                          {r.alsoOnThisNumber} held on this number — sending both is two parcels
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">{r.heldOn}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex-1 min-w-[16rem]">
              <span className="block text-xs font-medium text-slate-700">Why</span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                minLength={5}
                placeholder="Why should these go out despite the hold?"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <Button
              type="button"
              size="sm"
              onClick={send}
              disabled={sending || ticked.size === 0 || reason.trim().length < 5}
            >
              {sending ? "Sending…" : `Send ${willSend} anyway`}
            </Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {batchSize} at a time — each one is several calls to Pancake. The reason is kept against every order in
            the activity log. Everything else that can refuse an order still can.
          </p>
        </div>
      )}
    </div>
  );
}
