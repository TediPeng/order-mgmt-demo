"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

/**
 * Hands a regular customer to a different agent.
 *
 * Ownership, not sharing. `owner_agent_id` is what decides whose Regular
 * Customers list the record appears in, so this is the control that actually
 * moves a customer between agents — Transfer Leads does not, because a regular
 * customer's orders are kept out of the Leads list entirely and moving one
 * leaves the record where it was.
 *
 * A reason is required and kept, the same bargain the Pancake hold override
 * takes: the act is allowed, and it is written down.
 *
 * The orders tick is off by default on purpose. Handing over a customer and
 * re-assigning their order history are different decisions, and only the first
 * is usually meant. The sale credit is not on this form at all and cannot be
 * moved by it — it is stamped when the order is made and rewriting it would
 * change closed months and the commission already paid on them.
 */
export interface OwnerTarget {
  id: string;
  name: string;
  /** Shown under the name so two Marias can be told apart. */
  callName: string | null;
}

export function ChangeOwnerButton({
  customerId,
  customerName,
  currentOwnerName,
  orderCount,
  targets,
  action,
}: {
  customerId: string;
  customerName: string;
  currentOwnerName: string;
  /** How many orders the tick would move, so the number is on the decision. */
  orderCount: number;
  targets: OwnerTarget[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  /**
   * Submitted by hand, and the `finally` is the point — the action ends in
   * redirect(), which Next serves as a client-side navigation, so this
   * component is never unmounted and a `saving` flag cleared by nothing would
   * sit on "Saving…" for ever. ShareCustomerButton documents the same trap.
   *
   * useFormStatus is deliberately not used: react-dom 18.3.1 here does not
   * export it, and it is undefined at runtime without any error to see.
   */
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSaving(true);
    try {
      await action(data);
    } finally {
      setSaving(false);
      setOpen(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Change owner
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 whitespace-normal"
          onClick={() => setOpen(false)}
        >
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900">Change owner of {customerName}</h3>
            <p className="mt-1 text-xs text-slate-500">
              Currently {currentOwnerName}. The new owner gets the customer in their Regular Customers list and
              can raise orders for them.
            </p>

            {targets.length === 0 ? (
              <>
                <p className="mt-3 text-sm text-slate-600">
                  There is nobody to hand this customer to.
                </p>
                <div className="mt-4 flex justify-end">
                  <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                    Close
                  </Button>
                </div>
              </>
            ) : (
              <form onSubmit={submit} className="mt-4 space-y-4">
                <input type="hidden" name="customer_id" value={customerId} />

                <div>
                  <label htmlFor="owner_agent_id" className="block text-sm font-medium text-slate-700">
                    New owner
                  </label>
                  <select
                    id="owner_agent_id"
                    name="owner_agent_id"
                    required
                    defaultValue=""
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="" disabled>
                      Pick an agent
                    </option>
                    {targets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.callName ? ` (${t.callName})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="owner_reason" className="block text-sm font-medium text-slate-700">
                    Why
                  </label>
                  <textarea
                    id="owner_reason"
                    name="reason"
                    rows={2}
                    minLength={5}
                    required
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Reassigned by management"
                  />
                  <p className="mt-1 text-xs text-slate-400">
                    Kept in the activity log with both names and your own.
                  </p>
                </div>

                <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3">
                  <input type="checkbox" name="move_orders" className="mt-0.5" />
                  <span className="text-sm text-slate-700">
                    Move their {orderCount} order{orderCount === 1 ? "" : "s"} to the new owner too
                    <span className="mt-0.5 block text-xs text-slate-500">
                      Off by default. The sale on each order never moves — it stays credited to whoever made it, and
                      every past sales figure keeps counting it for them. An order already synced to Pancake also
                      stays locked, whoever holds it.
                    </span>
                  </span>
                </label>

                <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                  <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)} disabled={saving}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={saving}>
                    {saving ? "Saving…" : "Change owner"}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
