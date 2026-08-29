"use client";

import { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";

/**
 * The three endings a person can give a sync failure, behind one control.
 *
 * Retry is the only one that asks Pancake again, and for a duplicate hold that
 * is the one thing that must not happen — so the other three live here rather
 * than as three more buttons on every row, which would put "Resolve without
 * syncing" a mis-click away from "Retry" on a queue somebody is working
 * quickly.
 *
 * A dialog, not a dropdown. It was a panel positioned under the button, and the
 * button sits inside a table that scrolls in both directions: the panel was
 * clipped by the scroll container and never fully visible, which is the ordinary
 * fate of an absolutely-positioned menu inside `overflow-auto`. Centred on the
 * page it escapes the table entirely, and three forms with three explanations
 * were always more than a 20rem popover wanted to hold.
 *
 * Each carries what it needs before it will run: a Pancake order number, or a
 * reason. Neither is optional, because both are the only record of why an order
 * left the queue by hand.
 */
export function SyncResolveMenu({
  orderNumber,
  linkAction,
  clearAction,
  resolveAction,
  sendAnywayAction,
  sendCaution,
}: {
  orderNumber: string;
  linkAction: (formData: FormData) => void;
  clearAction: () => void;
  resolveAction: (formData: FormData) => void;
  /** Absent unless this row is held by the repeat-buyer rule, so the option
   * only appears where it means anything. */
  sendAnywayAction?: (formData: FormData) => void;
  /** What is actually known about THIS customer's last parcel, in place of the
   * generic explanation. The generic one describes every held order equally,
   * which is no use at the moment somebody is deciding about one of them. */
  sendCaution?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Resolve <ChevronDown className="h-3.5 w-3.5" />
      </Button>

      {open && (
        // `whitespace-normal` is load-bearing. This dialog is opened from a
        // cell in the failed-syncs table, whose row carries `whitespace-nowrap`
        // to keep the columns on one line. `position: fixed` moves the overlay
        // to the viewport but does not move it in the DOM, so it still inherits
        // that nowrap — every paragraph inside rendered as one long line, the
        // panel grew to 756px inside a 371px box, and the help text was clipped
        // mid-word behind a horizontal scrollbar.
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center whitespace-normal bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h3 className="text-base font-semibold text-slate-900">Resolve {orderNumber}</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <p className="text-sm text-slate-500">
                Ways to close this order without sending it again. None of them delete it — the sale stays exactly as
                it is.
              </p>

              <form action={linkAction} className="space-y-1.5 rounded-lg border border-slate-200 p-3">
                <Label htmlFor={`pk-${orderNumber}`}>It is already in Pancake</Label>
                <Input
                  id={`pk-${orderNumber}`}
                  name="pancake_order_id"
                  required
                  placeholder="Pancake order number"
                  autoComplete="off"
                />
                <p className="text-xs text-slate-400">
                  Links the two and marks it synced. Find the number in Pancake first. A number already linked to
                  another order is refused.
                </p>
                <Button type="submit" size="sm" className="w-full justify-center">
                  Link and mark synced
                </Button>
              </form>

              <form action={clearAction} className="space-y-1.5 rounded-lg border border-slate-200 p-3">
                <Label>I cancelled the duplicate</Label>
                <p className="text-xs text-slate-400">
                  Resets the attempts and clears the hold, so Retry runs as a first attempt would. It does not send —
                  press Retry when you are ready.
                </p>
                <Button type="submit" size="sm" variant="secondary" className="w-full justify-center">
                  Clear the hold
                </Button>
              </form>

              {/* Above "not going to Pancake", because it is the opposite
                  answer to the same question and it is the one more often
                  right: a held order is usually a real order somebody wants
                  sent, not one to be written off. */}
              {sendAnywayAction && (
                <form action={sendAnywayAction} className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
                  <Label htmlFor={`send-${orderNumber}`}>It is a real second order — send it</Label>
                  <Input
                    id={`send-${orderNumber}`}
                    name="reason"
                    required
                    minLength={5}
                    placeholder="Reason — e.g. delivered already, Pancake not updated; or two parcels on purpose"
                    autoComplete="off"
                  />
                  {sendCaution && <p className="text-xs font-medium text-slate-700">{sendCaution}</p>}
                  <p className="text-xs text-slate-400">
                    For a hold that is wrong: the last parcel really did arrive and Pancake has not caught up, or the
                    customer asked for two parcels. Retry cannot get past it — it asks Pancake the same question and
                    gets the same answer. This sends once, against the hold, and the reason is kept in the activity log.
                  </p>
                  <Button type="submit" size="sm" variant="secondary" className="w-full justify-center">
                    Send anyway
                  </Button>
                </form>
              )}

              <form action={resolveAction} className="space-y-1.5 rounded-lg border border-red-200 bg-red-50/40 p-3">
                <Label htmlFor={`why-${orderNumber}`}>It is not going to Pancake</Label>
                <Input
                  id={`why-${orderNumber}`}
                  name="reason"
                  required
                  minLength={5}
                  placeholder="Reason — e.g. duplicate of ORD-…, cancelled in Pancake"
                  autoComplete="off"
                />
                <p className="text-xs text-slate-400">
                  Takes it out of this queue without pretending it synced. The reason is kept on the order and in the
                  activity log.
                </p>
                <Button type="submit" size="sm" variant="danger" className="w-full justify-center">
                  Resolve without syncing
                </Button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
