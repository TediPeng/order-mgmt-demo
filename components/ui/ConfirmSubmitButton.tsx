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
      <button {...props} ref={ref} type="button" className={className} onClick={() => setAsking(true)}>
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
