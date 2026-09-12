"use client";

import { useRouter } from "next/navigation";
import { PhoneCall } from "lucide-react";

import { CallingPanel } from "@/components/CallingPanel";
import { DialLink } from "@/components/DialLink";
import type { DialScheme } from "@/lib/dial";

/**
 * The call, kept on screen while a repeat order is written.
 *
 * The agent almost always arrives here mid-call: they pressed CALL on the
 * delivered order, the phone rang, the customer asked to order again, and Order
 * Again brought them to this form. The call is still running — but the timer
 * and End call live in the popup they just left, so until now the running call
 * became invisible exactly when the agent needed to see it, and the only way to
 * end it was to navigate back and find the row again.
 *
 * So this shows the same session, on the page where the work is. It is not a
 * second call and cannot become one: CallingPanel renders whatever the one
 * app-level session implies, and starting a call here starts it on the order
 * this one was copied from.
 *
 * That last part is worth saying out loud rather than leaving to be discovered,
 * which is why the note below says it: the call is recorded against the earlier
 * order until the new one exists. That is honest — the agent really did ring
 * that customer — and it is the alternative to a call nobody counted, which is
 * what the floor had before any of this.
 */
export function RepeatOrderCallPanel({
  orderId,
  fromOrderNumber,
  customerName,
  phone,
  dialScheme,
}: {
  /** The order the details were copied from; the call attaches to it. */
  orderId: string;
  fromOrderNumber: string;
  customerName: string;
  phone: string;
  /** Which URL scheme the number opens with. See lib/dial.ts. */
  dialScheme: DialScheme;
}) {
  const router = useRouter();

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
          <PhoneCall className="h-4 w-4 text-slate-400" aria-hidden />
          Call {customerName}
        </p>
        {phone ? (
          <DialLink phone={phone} scheme={dialScheme} className="text-sm" />
        ) : (
          <span className="text-sm text-slate-400">No number saved</span>
        )}
        <p className="mt-0.5 text-xs text-slate-400">
          If you are already on this call, the timer here is that same call — end it from either screen. A call started
          here is recorded against order {fromOrderNumber} until this new order is saved.
        </p>
      </div>
      <CallingPanel
        compact
        orderId={orderId}
        dialPhone={phone}
        dialScheme={dialScheme}
        onOpenActive={(id) => router.push(`/leads?open_id=${id}`)}
      />
    </div>
  );
}
