"use client";

import { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";

/**
 * The four endings a person can give a sync failure, behind one control.
 *
 * Retry is the only one that asks Pancake again, and for a duplicate hold that
 * is the one thing that must not happen — so these live here rather than as
 * four more buttons on every row, which would put "Stop syncing" a mis-click
 * away from "Retry" on a queue somebody is working quickly.
 *
 * A dialog, not a dropdown. It was a panel positioned under the button, and the
 * button sits inside a table that scrolls in both directions: the panel was
 * clipped by the scroll container and never fully visible, which is the ordinary
 * fate of an absolutely-positioned menu inside `overflow-auto`.
 *
 * One choice at a time.
 *
 * All four used to be on screen together, each with its input and its
 * paragraph: four headings, four explanations and three text boxes, most of
 * them about the option the reader had already ruled out. Somebody deciding
 * between them was reading roughly two hundred words to press one button.
 *
 * So the dialog opens as four buttons and nothing else, and the one that is
 * chosen asks for what it needs. The reading is now one short line per option
 * — enough to choose — and the explanation appears where it is acted on.
 *
 * The inputs did not go away and must not: a Pancake order number, or a
 * reason. Neither is optional, because both are the only record of why an
 * order left the queue by hand.
 */

type Step = "link" | "clear" | "send" | "stop";

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
  const [step, setStep] = useState<Step | null>(null);

  function close() {
    setOpen(false);
    setStep(null);
  }

  const choices: { key: Step; label: string; when: string; show: boolean }[] = [
    { key: "link", label: "Mark synced", when: "It is already in Pancake.", show: true },
    { key: "clear", label: "Clear the hold", when: "I cancelled the duplicate.", show: true },
    { key: "send", label: "Send anyway", when: "It is a real second order.", show: Boolean(sendAnywayAction) },
    { key: "stop", label: "Stop syncing", when: "It is not going to Pancake.", show: true },
  ];

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
          onClick={close}
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
                onClick={close}
                className="rounded p-1 text-slate-400 hover:bg-slate-100"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 p-5">
              {step === null && (
                <>
                  <p className="text-sm text-slate-500">
                    None of these delete the order — the sale stays exactly as it is.
                  </p>

                  {choices
                    .filter((c) => c.show)
                    .map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        // Clear the hold sends nothing and asks for nothing, so
                        // it is the one that simply happens.
                        onClick={() => (c.key === "clear" ? clearAction() : setStep(c.key))}
                        className="w-full rounded-lg border border-slate-200 px-4 py-3 text-left hover:border-slate-300 hover:bg-slate-50"
                      >
                        <span className="block text-sm font-medium text-slate-900">{c.label}</span>
                        <span className="mt-0.5 block text-xs text-slate-500">{c.when}</span>
                      </button>
                    ))}
                </>
              )}

              {step === "link" && (
                <form action={linkAction} className="space-y-2">
                  <Label htmlFor={`pk-${orderNumber}`}>Pancake order number</Label>
                  <Input
                    id={`pk-${orderNumber}`}
                    name="pancake_order_id"
                    required
                    autoFocus
                    placeholder="e.g. 24984"
                    autoComplete="off"
                  />
                  <p className="text-xs text-slate-500">
                    Find the number in Pancake first. One already linked to another order is refused.
                  </p>
                  <Actions onBack={() => setStep(null)} label="Mark synced" />
                </form>
              )}

              {step === "send" && sendAnywayAction && (
                <form action={sendAnywayAction} className="space-y-2">
                  <Label htmlFor={`send-${orderNumber}`}>Why this one goes anyway</Label>
                  <Input
                    id={`send-${orderNumber}`}
                    name="reason"
                    required
                    minLength={5}
                    autoFocus
                    placeholder="e.g. delivered already; or two parcels on purpose"
                    autoComplete="off"
                  />
                  {/* The one thing on this screen that is about THIS order.
                      Kept prominent: it is the difference between one parcel
                      and two. */}
                  {sendCaution && (
                    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-slate-800">
                      {sendCaution}
                    </p>
                  )}
                  <p className="text-xs text-slate-500">
                    Sends once, against the hold. Retry cannot — it asks Pancake the same question and gets the same
                    answer.
                  </p>
                  <Actions onBack={() => setStep(null)} label="Send anyway" variant="secondary" />
                </form>
              )}

              {step === "stop" && (
                <form action={resolveAction} className="space-y-2">
                  <Label htmlFor={`why-${orderNumber}`}>Why it is not going</Label>
                  <Input
                    id={`why-${orderNumber}`}
                    name="reason"
                    required
                    minLength={5}
                    autoFocus
                    placeholder="e.g. duplicate of ORD-…, cancelled in Pancake"
                    autoComplete="off"
                  />
                  <p className="text-xs text-slate-500">
                    Takes it out of this queue without pretending it synced. The reason is kept on the order.
                  </p>
                  <Actions onBack={() => setStep(null)} label="Stop syncing" variant="danger" />
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Back and confirm, so a wrong choice costs one click rather than the dialog. */
function Actions({
  onBack,
  label,
  variant = "primary",
}: {
  onBack: () => void;
  label: string;
  variant?: "primary" | "secondary" | "danger";
}) {
  return (
    <div className="flex gap-2 pt-1">
      <Button type="button" size="sm" variant="outline" onClick={onBack}>
        Back
      </Button>
      <Button type="submit" size="sm" variant={variant} className="flex-1 justify-center">
        {label}
      </Button>
    </div>
  );
}
