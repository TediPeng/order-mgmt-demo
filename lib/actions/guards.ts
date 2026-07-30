import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { readDb } from "@/lib/db";
import type { ActionKey, DbShape, ModuleKey, Profile } from "@/lib/types";

export async function requireUser(): Promise<{ user: Profile; db: DbShape }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const db = await readDb();
  return { user: user!, db };
}

export function requirePermission(
  user: Profile,
  moduleKey: ModuleKey,
  action: ActionKey,
  db: DbShape,
  redirectTo: string
) {
  if (!can(user.role, moduleKey, action, db.role_permissions)) {
    redirect(`${redirectTo}?error=${encodeURIComponent("You do not have permission to perform this action.")}`);
  }
}

export function requireAdministrator(user: Profile, redirectTo: string) {
  if (!isFullAccess(user.role)) {
    redirect(`${redirectTo}?error=${encodeURIComponent("Administrator access required.")}`);
  }
}
