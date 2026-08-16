"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
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
 * Each carries what it needs before it will run: a Pancake order number, or a
 * reason. Neither is optional, because both are the only record of why an order
 * left the queue by hand.
 */
export function SyncResolveMenu({
  orderNumber,
  linkAction,
  clearAction,
  resolveAction,
}: {
  orderNumber: string;
  linkAction: (formData: FormData) => void;
  clearAction: () => void;
  resolveAction: (formData: FormData) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-block text-left">
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
        Resolve <ChevronDown className="h-3.5 w-3.5" />
      </Button>

      {open && (
        <>
          {/* Click anywhere else to close. A panel this destructive should not
              need a second visit to the same small button to dismiss. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-80 space-y-4 rounded-lg border border-slate-200 bg-white p-4 text-left shadow-lg">
            <p className="text-xs text-slate-500">
              Ways to close <span className="font-medium text-slate-700">{orderNumber}</span> without sending it again.
              None of these delete the order.
            </p>

            <form action={linkAction} className="space-y-1.5">
              <Label htmlFor={`pk-${orderNumber}`}>It is already in Pancake</Label>
              <Input
                id={`pk-${orderNumber}`}
                name="pancake_order_id"
                required
                placeholder="Pancake order number"
                autoComplete="off"
              />
              <p className="text-xs text-slate-400">
                Links the two and marks it synced. Find the number in Pancake first.
              </p>
              <Button type="submit" size="sm" className="w-full justify-center">
                Link and mark synced
              </Button>
            </form>

            <form action={clearAction} className="space-y-1.5 border-t border-slate-100 pt-3">
              <Label>I cancelled the duplicate</Label>
              <p className="text-xs text-slate-400">
                Resets the attempts and clears the hold, so Retry runs as a first attempt. It does not send — press
                Retry when you are ready.
              </p>
              <Button type="submit" size="sm" variant="secondary" className="w-full justify-center">
                Clear the hold
              </Button>
            </form>

            <form action={resolveAction} className="space-y-1.5 border-t border-slate-100 pt-3">
              <Label htmlFor={`why-${orderNumber}`}>It is not going to Pancake</Label>
              <Input id={`why-${orderNumber}`} name="reason" required minLength={5} placeholder="Reason" autoComplete="off" />
              <p className="text-xs text-slate-400">
                Takes it out of this queue without pretending it synced. The reason is kept on the order.
              </p>
              <Button type="submit" size="sm" variant="danger" className="w-full justify-center">
                Resolve without syncing
              </Button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
