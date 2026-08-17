"use client";

import { useRouter } from "next/navigation";
import { PhoneCall } from "lucide-react";
import { CallingPanel } from "@/components/CallingPanel";

/**
 * The calling control on the New Order form raised from a Regular Customer.
 *
 * Leads have had one since the beginning — the CALL button in the leads table
 * and the panel in the order popup — but a repeat order starts from the
 * customer's record, where there is no order yet and so was nothing to call
 * from. The agent rang the number off the screen and the call went unrecorded:
 * missing from Calls Made, missing from the day's talk time, and the monitor
 * showed them standing by while they were on the phone.
 *
 * The session is opened against the customer. createLeadAction attaches the
 * order to it the moment one is saved, so from then on it behaves exactly like
 * a lead call — order call history, the status-update gate, the monitor.
 */
export function RegularCustomerCallPanel({
  customerId,
  customerName,
  phone,
}: {
  customerId: string;
  customerName: string;
  phone: string;
}) {
  const router = useRouter();

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
          <PhoneCall className="h-4 w-4 text-slate-400" aria-hidden />
          Call {customerName}
        </p>
        {/* The number dials on a phone and copies on a desktop. It is the
            reason this row exists, so it is not left in the form below. */}
        {phone ? (
          <a href={`tel:${phone}`} className="text-sm text-[var(--brand-primary)] hover:underline">
            {phone}
          </a>
        ) : (
          <span className="text-sm text-slate-400">No number saved</span>
        )}
        <p className="mt-0.5 text-xs text-slate-400">
          Start the call before taking the order — it counts toward your calls today and shows on the monitor. The order
          you save below is attached to it.
        </p>
      </div>
      <CallingPanel
        compact
        customerId={customerId}
        onOpenActive={(id) => router.push(`/leads?open_id=${id}`)}
      />
    </div>
  );
}
