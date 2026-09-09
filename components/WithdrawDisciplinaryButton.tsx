"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Textarea, Label } from "@/components/ui/Field";

export function WithdrawDisciplinaryButton({
  action,
  id,
}: {
  action: (formData: FormData) => Promise<void>;
  id: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Withdraw
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 whitespace-normal"
          onClick={() => setOpen(false)}
        >
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900">Withdraw this disciplinary action?</h3>
            <p className="mt-2 text-sm text-slate-600">
              It stays on the list marked withdrawn, with your reason — a record that can be made to disappear is not a
              record. The employee is told.
            </p>
            <div className="mt-3">
              <Label htmlFor="withdraw_reason">Reason (required)</Label>
              <Textarea
                id="withdraw_reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={pending || !reason.trim()}
                onClick={() =>
                  startTransition(async () => {
                    const formData = new FormData();
                    formData.set("id", id);
                    formData.set("withdrawn_reason", reason);
                    await action(formData);
                    setOpen(false);
                  })
                }
              >
                {pending ? "Working…" : "Withdraw"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
