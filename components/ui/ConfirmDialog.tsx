"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";

/**
 * The app's own confirmation, replacing window.confirm.
 *
 * A browser confirm() is the one dialog this app cannot style, cannot fit more
 * than a sentence into, and cannot be trusted to look like it belongs: it
 * arrives in the operating system's own colours, says "localhost:3100 says"
 * above the question, and puts OK where the app would put a verb. It also
 * freezes the whole tab, so a timer stops being read and a call cannot be
 * ended anywhere else while it is open.
 *
 * This one names the action on its button — "End call" rather than "OK" — so
 * the button says what pressing it does without the question having to be
 * re-read.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button, for anything that destroys or cannot be undone. */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
      // Clicking away cancels — the safe answer, and what confirm() does on
      // Escape. Stopped from reaching whatever is behind it.
      onClick={(e) => {
        e.stopPropagation();
        onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`flex items-center gap-2 px-5 py-3 text-white ${danger ? "bg-red-600" : "bg-slate-700"}`}
        >
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
          <h2 id="confirm-title" className="text-base font-semibold">
            {title}
          </h2>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-sm text-slate-700">{message}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </Button>
            <Button type="button" variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
              {busy ? "Working…" : confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
