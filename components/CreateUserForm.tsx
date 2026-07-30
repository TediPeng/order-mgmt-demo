"use client";

import { useState } from "react";
import { Input, Label, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { suggestUsername } from "@/lib/passwords";
import { createUserAction } from "@/lib/actions/users";

/**
 * Section 8: the username is generated from the Call Name as `ROMA_<callname>`,
 * with a number appended on collision. It stays editable — the suggestion only
 * follows the Call Name until an Administrator types their own, at which point
 * it is left alone. Uniqueness is enforced by the database regardless.
 */
export function CreateUserForm({
  roles,
  teamLeads,
  takenUsernames,
}: {
  roles: { key: string; name: string }[];
  teamLeads: { id: string; full_name: string }[];
  takenUsernames: string[];
}) {
  const [callName, setCallName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [role, setRole] = useState("agent");

  function onCallNameChange(value: string) {
    setCallName(value);
    if (!usernameEdited) {
      setUsername(value.trim() ? suggestUsername(value, takenUsernames) : "");
    }
  }

  return (
    <form action={createUserAction} className="grid grid-cols-1 gap-4 sm:grid-cols-6">
      <div className="sm:col-span-2">
        <Label htmlFor="full_name">Full name</Label>
        <Input id="full_name" name="full_name" required />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="contact_number">Contact number</Label>
        <Input id="contact_number" name="contact_number" inputMode="tel" />
      </div>

      <div className="sm:col-span-2">
        <Label htmlFor="call_name">Call Name{role === "agent" ? " (required)" : ""}</Label>
        <Input
          id="call_name"
          name="call_name"
          value={callName}
          onChange={(e) => onCallNameChange(e.target.value)}
          placeholder="e.g. Juan Dela Cruz"
          required={role === "agent"}
        />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          name="username"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setUsernameEdited(true);
          }}
          required
          minLength={3}
        />
        <p className="mt-1 text-xs text-slate-400">
          {usernameEdited ? "Edited manually." : "Generated from the Call Name — edit if you need something else."}
        </p>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="role">Role</Label>
        <Select id="role" name="role" value={role} onChange={(e) => setRole(e.target.value)}>
          {roles.map((r) => (
            <option key={r.key} value={r.key}>
              {r.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="sm:col-span-3">
        <Label htmlFor="team_lead_id">Team lead (if Agent)</Label>
        <Select id="team_lead_id" name="team_lead_id" defaultValue="" disabled={role !== "agent"}>
          <option value="">— Unassigned —</option>
          {teamLeads.map((tl) => (
            <option key={tl.id} value={tl.id}>
              {tl.full_name}
            </option>
          ))}
        </Select>
      </div>
      <div className="sm:col-span-3">
        <Label htmlFor="permission_profile">Permission profile (optional)</Label>
        <Input id="permission_profile" name="permission_profile" placeholder="e.g. Senior Agent" />
      </div>

      <div className="sm:col-span-6">
        <p className="mb-3 text-xs text-slate-500">
          A unique random temporary password is generated on save and shown to you once. The account must change it
          before it can use the system.
        </p>
        <Button type="submit">Create User</Button>
      </div>
    </form>
  );
}
