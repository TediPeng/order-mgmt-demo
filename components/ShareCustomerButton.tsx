"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

/**
 * Shares a regular customer with the owner's own teammates.
 *
 * Ownership is not on this form and cannot be changed by it. A share adds who
 * may see and work the customer; `owner_agent_id` stays where it is, so one
 * person remains accountable and un-sharing cannot leave the record ownerless.
 *
 * The list is the OWNER's team, resolved on the server — a customer's reach is
 * a property of whose customer it is, not of who happens to have the dialog
 * open. An Administrator opening this sees the same names the owner would.
 *
 * Checkboxes rather than a multi-select: the question is "who holds this", and
 * the answer should be readable without opening anything. Unticking is how a
 * share is withdrawn, so both directions live in one submit and the audit entry
 * records them together.
 */
export interface ShareTarget {
  id: string;
  name: string;
  /** Shown under the name so two Marias can be told apart. */
  callName: string | null;
}

export function ShareCustomerButton({
  customerId,
  customerName,
  targets,
  sharedWith,
  action,
}: {
  customerId: string;
  customerName: string;
  targets: ShareTarget[];
  /** Agent ids the customer is already shared with. */
  sharedWith: string[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  /**
   * Submitted by hand rather than left to the form's own action.
   *
   * The action ends in redirect(), which Next serves as a client-side
   * navigation: the page re-renders but this component is never unmounted. A
   * `saving` flag set on submit and cleared by nothing therefore stays true
   * forever, and the dialog sits on "Saving…" long after the save succeeded —
   * which is exactly what it did.
   *
   * The `finally` is the fix and the point: whether the action redirects,
   * returns or throws, the dialog closes and the flag resets. Closing also
   * unmounts the checkbox list, so the next open reflects what was saved rather
   * than what was last ticked.
   *
   * useFormStatus would be the idiomatic answer and is deliberately not used:
   * react-dom 18.3.1 does not export it. It type-checks and is undefined at
   * runtime, which took the whole dialog down without an error anyone could see.
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

  const count = sharedWith.length;

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Share{count > 0 ? ` (${count})` : ""}
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 whitespace-normal"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-slate-900">Share {customerName}</h3>

            {targets.length === 0 ? (
              <>
                <p className="mt-2 text-sm text-slate-600">
                  There is nobody to share with. Sharing is limited to the owner&apos;s own team, and this
                  owner has no other active agents under the same Team Lead.
                </p>
                <div className="mt-4 flex justify-end">
                  <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                    Close
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-1 text-xs text-slate-500">
                  They will see this customer&apos;s name, number and address, and can raise orders for
                  them. The customer stays yours. Every change here is recorded in the activity log.
                </p>

                <form onSubmit={submit} className="mt-4">
                  <input type="hidden" name="customer_id" value={customerId} />

                  <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                    {targets.map((target) => (
                      <li key={target.id}>
                        <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-slate-50">
                          <input
                            type="checkbox"
                            name="agent_ids"
                            value={target.id}
                            defaultChecked={sharedWith.includes(target.id)}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-slate-800">
                              {target.name}
                            </span>
                            {target.callName && (
                              <span className="block text-[11px] uppercase tracking-wide text-slate-400">
                                {target.callName}
                              </span>
                            )}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>

                  {/* Unticking is the only way to withdraw a share, so it is worth
                      saying plainly — a checkbox list reads as "add" to most people. */}
                  <p className="mt-2 text-xs text-slate-400">
                    Untick somebody to take their access away.
                  </p>

                  <div className="mt-4 flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={saving}
                      onClick={() => setOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" disabled={saving}>
                      {saving ? "Saving…" : "Save sharing"}
                    </Button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
