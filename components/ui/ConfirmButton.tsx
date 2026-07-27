"use client";

import { useState, useTransition } from "react";
import { Button } from "./Button";
import { cn } from "@/lib/utils";

export function ConfirmButton({
  action,
  confirmTitle,
  confirmBody,
  label,
  variant = "danger",
  size = "sm",
  className,
}: {
  action: () => Promise<void>;
  confirmTitle: string;
  confirmBody: string;
  label: string;
  variant?: "danger" | "primary" | "secondary" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">{confirmTitle}</h3>
            <p className="mt-2 text-sm text-slate-600">{confirmBody}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await action();
                    setOpen(false);
                  })
                }
              >
                {pending ? "Working…" : "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
