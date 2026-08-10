import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { readDb, readDbLite } from "@/lib/db";
import type { ActionKey, DbShape, ModuleKey, Profile } from "@/lib/types";

export async function requireUser(): Promise<{ user: Profile; db: DbShape }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const db = await readDb();
  return { user: user!, db };
}

/**
 * The same, with `orders` left empty — for an action that asks the database
 * about orders directly instead of scanning them in memory.
 *
 * Use it ONLY where the whole call graph is known not to read db.orders: an
 * empty array reads as "no orders exist", which is silently wrong rather than
 * loudly broken. Writing is safe either way — writeDb() upserts only the
 * orders an action marks dirty and deletes only what it queues.
 */
export async function requireUserLite(): Promise<{ user: Profile; db: DbShape }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const db = await readDbLite();
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
