"use client";

import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

/** A submit button that asks the app's own confirmation before submitting.
 *
 * It used to be a plain submit that called window.confirm and cancelled the
 * event on a No. The behaviour is the same; what changed is that the question
 * now arrives in the app rather than in a browser dialog headed
 * "localhost:3100 says".
 *
 * The button is type="button" now and submits its form itself on a Yes —
 * requestSubmit(), not submit(), so the form's own validation and its React
 * action still run exactly as they would have.
 */
/** What it looks like when the caller says nothing.
 *
 * Several call sites passed no class at all — Return to Leads, and both delete
 * buttons on the Duplicates page — so the one control on the row that actually
 * changes something rendered as bare text beside properly drawn buttons. A
 * default is the fix, not a class string copied into each of them: it matches
 * Button's outline/sm, and any caller that passes its own still wins. */
const DEFAULT_CLASS =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-control font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40";

export function ConfirmSubmitButton({
  confirmMessage,
  confirmTitle = "Please confirm",
  confirmLabel = "Confirm",
  danger = true,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  confirmMessage: string;
  confirmTitle?: string;
  confirmLabel?: string;
  danger?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button {...props} ref={ref} type="button" className={className ?? DEFAULT_CLASS} onClick={() => setAsking(true)}>
        {children}
      </button>

      {asking && (
        <ConfirmDialog
          title={confirmTitle}
          message={confirmMessage}
          confirmLabel={confirmLabel}
          danger={danger}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            ref.current?.form?.requestSubmit();
          }}
        />
      )}
    </>
  );
}
