"use client";

/** A plain submit button (participates in its enclosing <form>, including
 * name/value) that asks for confirmation before the browser submits it --
 * for critical in-place actions like leave rejection (Section 6) where a
 * full modal would be overkill. */
export function ConfirmSubmitButton({
  confirmMessage,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { confirmMessage: string }) {
  return (
    <button
      {...props}
      type="submit"
      className={className}
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
