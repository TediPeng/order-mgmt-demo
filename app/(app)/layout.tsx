import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { readDb, writeDb } from "@/lib/db";
import { can } from "@/lib/permissions";
import { sweepAutoAbsences } from "@/lib/attendance-sweep";
import { MODULES } from "@/lib/types";
import type { ModuleKey } from "@/lib/types";
import { AppShell } from "@/components/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const db = await readDb();
  if (sweepAutoAbsences(db)) await writeDb(db);
  const access = {} as Record<ModuleKey, boolean>;
  for (const m of MODULES) {
    access[m] = can(user.role, m, "view", db.role_permissions);
  }
  const roleName = db.roles.find((r) => r.key === user.role)?.name || user.role;
  const notifications = db.notifications
    .filter((n) => n.recipient_id === user.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <AppShell user={user} roleName={roleName} access={access} notifications={notifications}>
      {children}
    </AppShell>
  );
}
