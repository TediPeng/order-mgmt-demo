"use client";

import { useTransition } from "react";
import { assignTeamLeadAction } from "@/lib/actions/users";
import type { Profile } from "@/lib/types";

export function TeamLeadSelect({
  userId,
  teamLeadId,
  teamLeads,
}: {
  userId: string;
  teamLeadId: string | null;
  teamLeads: Profile[];
}) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      defaultValue={teamLeadId || ""}
      disabled={pending}
      onChange={(e) => {
        const value = e.target.value;
        startTransition(() => {
          assignTeamLeadAction(userId, value);
        });
      }}
      className="rounded-md border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
    >
      <option value="">— Unassigned —</option>
      {teamLeads.map((tl) => (
        <option key={tl.id} value={tl.id}>
          {tl.full_name}
        </option>
      ))}
    </select>
  );
}
