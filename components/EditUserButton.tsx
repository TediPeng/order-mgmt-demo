"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";

/**
 * Edits the details an account is identified by, from its own row.
 *
 * Role, Team Lead and Status each already have a control in this table, and the
 * password has Reset — these six fields had none, so a wrong email or Call Name
 * could only be fixed by deleting the account and creating another one. Nobody
 * does that to a live agent, so it stayed wrong, and both fields are matched
 * against Pancake POS on every order that forwards.
 *
 * Deliberately not in this form: Role and Team Lead. They are edited by the
 * selects two columns to the left, and a second control for the same value is
 * one more place for the two to disagree.
 */
export interface EditableUser {
  id: string;
  full_name: string;
  username: string;
  email: string;
  call_name: string | null;
  contact_number: string | null;
  permission_profile: string | null;
  /** Only agents must carry a Call Name — the server checks the same rule. */
  role: string;
}

export function EditUserButton({ user, action }: { user: EditableUser; action: (formData: FormData) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Edit
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !saving && setOpen(false)}
        >
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900">Edit {user.username}</h3>
            <p className="mt-1 text-xs text-slate-500">
              Call Name is matched to a Pancake Order Source and Email to a Pancake staff member. An order will not
              forward while either is wrong.
            </p>
            <form
              action={action}
              onSubmit={() => setSaving(true)}
              className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2"
            >
              <div>
                <Label htmlFor="edit_full_name">Full name</Label>
                <Input id="edit_full_name" name="full_name" defaultValue={user.full_name} required />
              </div>
              <div>
                <Label htmlFor="edit_username">Username</Label>
                <Input id="edit_username" name="username" defaultValue={user.username} required minLength={3} />
                <p className="mt-1 text-xs text-slate-400">This is what they sign in with.</p>
              </div>
              <div>
                <Label htmlFor="edit_email">Email</Label>
                <Input id="edit_email" name="email" type="email" defaultValue={user.email} required />
              </div>
              <div>
                <Label htmlFor="edit_call_name">Call Name{user.role === "agent" ? " (required)" : ""}</Label>
                <Input
                  id="edit_call_name"
                  name="call_name"
                  defaultValue={user.call_name || ""}
                  required={user.role === "agent"}
                />
              </div>
              <div>
                <Label htmlFor="edit_contact_number">Contact number</Label>
                <Input
                  id="edit_contact_number"
                  name="contact_number"
                  inputMode="tel"
                  defaultValue={user.contact_number || ""}
                />
              </div>
              <div>
                <Label htmlFor="edit_permission_profile">Permission profile</Label>
                <Input
                  id="edit_permission_profile"
                  name="permission_profile"
                  defaultValue={user.permission_profile || ""}
                  placeholder="e.g. Senior Agent"
                />
              </div>
              <div className="flex justify-end gap-2 sm:col-span-2">
                <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
