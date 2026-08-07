"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";
import { clearCompanyDataAction } from "@/lib/actions/clear-data";
import { CLEAR_DATA_PHRASE, CLEARED_SUMMARY, PRESERVED_SUMMARY } from "@/lib/clear-data";

/**
 * Administrator-only reset of the company's transactional data.
 *
 * The typed phrase and the password are checked again on the server — this
 * dialog is a speed bump for the person clicking, not the control. Nothing here
 * decides whether the reset is allowed.
 */
export function ClearDataButton({ syncedOrderCount }: { syncedOrderCount: number }) {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  // Plain state rather than useFormStatus: the installed react-dom does not
  // export that hook, and a disabled-while-working label is not worth depending
  // on which React the bundler resolves.
  const [submitting, setSubmitting] = useState(false);

  function close() {
    setOpen(false);
    setPhrase("");
  }

  return (
    <>
      <Button type="button" variant="danger" size="sm" onClick={() => setOpen(true)}>
        Clear company data
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden />
              <div>
                <h3 className="text-base font-semibold text-slate-900">Clear company data</h3>
                <p className="mt-1 text-sm text-slate-600">
                  This permanently deletes the records below. It cannot be undone, and there is no backup to restore
                  from.
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Will be deleted</p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm text-red-800">
                {CLEARED_SUMMARY.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>

            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Will be kept</p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm text-slate-600">
                {PRESERVED_SUMMARY.map((line) => (
                  <li key={line}>{line}</li>
                ))}
                <li>
                  {syncedOrderCount === 0
                    ? "No orders have been sent to Pancake yet"
                    : `${syncedOrderCount} order${syncedOrderCount === 1 ? "" : "s"} already sent to Pancake — deleting ${
                        syncedOrderCount === 1 ? "it" : "them"
                      } here would not cancel the parcel`}
                </li>
              </ul>
            </div>

            <form action={clearCompanyDataAction} onSubmit={() => setSubmitting(true)} className="mt-4 space-y-3">
              <div>
                <Label htmlFor="confirm_phrase">
                  Type <span className="font-mono font-semibold text-slate-900">{CLEAR_DATA_PHRASE}</span> to confirm
                </Label>
                <Input
                  id="confirm_phrase"
                  name="confirm_phrase"
                  autoComplete="off"
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  placeholder={CLEAR_DATA_PHRASE}
                />
              </div>
              <div>
                <Label htmlFor="clear_password">Confirm with your password</Label>
                <Input id="clear_password" name="password" type="password" autoComplete="current-password" required />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" size="sm" onClick={close} disabled={submitting}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="danger"
                  size="sm"
                  disabled={phrase !== CLEAR_DATA_PHRASE || submitting}
                >
                  {submitting ? "Clearing…" : "Clear company data"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
