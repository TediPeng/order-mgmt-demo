"use client";

import { useTransition } from "react";
import { updateUserRoleAction } from "@/lib/actions/users";
import type { RoleDef } from "@/lib/types";

export function RoleSelect({ userId, role, roles }: { userId: string; role: string; roles: RoleDef[] }) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      defaultValue={role}
      disabled={pending}
      onChange={(e) => {
        const newRole = e.target.value;
        startTransition(() => {
          updateUserRoleAction(userId, newRole);
        });
      }}
      className="rounded-md border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
    >
      {roles.map((r) => (
        <option key={r.key} value={r.key}>
          {r.name}
        </option>
      ))}
    </select>
  );
}
