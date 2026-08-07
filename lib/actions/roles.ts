"use server";

import { redirect } from "next/navigation";
import { writeDb, uuid, nowIso } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { requireUser, requireAdministrator } from "./guards";
import { buildDefaultRows, defaultAllowed, isFullAccess } from "@/lib/permissions";
import { roleFormSchema } from "@/lib/validation";
import type { ActionKey, ModuleKey } from "@/lib/types";
import { describeParseFailure } from "@/lib/zod-error";

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export async function createRoleAction(formData: FormData) {
  const { user, db } = await requireUser();
  requireAdministrator(user, "/settings/roles");

  const parsed = roleFormSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
  });
  if (!parsed.success) {
    redirect(`/settings/roles?error=${encodeURIComponent(describeParseFailure(parsed.error))}`);
  }

  const data = parsed.data;
  let key = slugify(data.name);
  if (!key) redirect(`/settings/roles?error=${encodeURIComponent("Role name must contain letters or numbers.")}`);
  let suffix = 1;
  const baseKey = key;
  while (db.roles.some((r) => r.key === key)) {
    key = `${baseKey}_${suffix}`;
    suffix++;
  }

  db.roles.push({
    id: uuid(),
    key,
    name: data.name,
    description: data.description || "",
    is_system: false,
    created_at: nowIso(),
  });

  const info = await getRequestInfo();
  logActivity(db, user.id, "ROLE_CREATED", "role", key, { name: data.name }, { module: "roles", ...info });
  await writeDb(db);
  redirect(`/settings/roles?role=${encodeURIComponent(key)}&created=1`);
}

export async function deleteRoleAction(roleKey: string) {
  "use server";
  const { user, db } = await requireUser();
  requireAdministrator(user, "/settings/roles");

  const role = db.roles.find((r) => r.key === roleKey);
  if (!role) redirect("/settings/roles");
  if (role!.is_system) {
    redirect(`/settings/roles?error=${encodeURIComponent("System roles cannot be deleted.")}`);
  }
  if (db.profiles.some((p) => p.role === roleKey)) {
    redirect(`/settings/roles?error=${encodeURIComponent("Reassign users away from this role before deleting it.")}`);
  }

  db.roles = db.roles.filter((r) => r.key !== roleKey);
  db.role_permissions = db.role_permissions.filter((rp) => rp.role !== roleKey);
  const info = await getRequestInfo();
  logActivity(db, user.id, "ROLE_DELETED", "role", roleKey, { name: role!.name }, {
    module: "roles",
    previous_value: role,
    ...info,
  });
  await writeDb(db);
  redirect("/settings/roles?deleted=1");
}

export async function updatePermissionAction(role: string, moduleKey: ModuleKey, action: ActionKey, allowed: boolean) {
  "use server";
  const { user, db } = await requireUser();
  requireAdministrator(user, "/settings/roles");

  if (isFullAccess(role)) {
    redirect(`/settings/roles?error=${encodeURIComponent("Management and Administrator permissions cannot be reduced.")}`);
  }

  let row = db.role_permissions.find((r) => r.role === role && r.module === moduleKey && r.action === action);
  const before = row?.allowed ?? defaultAllowed(role, moduleKey, action);

  if (!row) {
    row = { id: uuid(), role, module: moduleKey, action, allowed, updated_by: user.id, updated_at: nowIso() };
    db.role_permissions.push(row);
  } else {
    row.allowed = allowed;
    row.updated_by = user.id;
    row.updated_at = nowIso();
  }

  const info = await getRequestInfo();
  logActivity(
    db,
    user.id,
    "PERMISSIONS_UPDATED",
    "role_permission",
    `${role}:${moduleKey}:${action}`,
    { role, module: moduleKey, action, before, after: allowed },
    { module: "roles", previous_value: { allowed: before }, updated_value: { allowed }, ...info }
  );
  await writeDb(db);
  redirect(`/settings/roles?role=${encodeURIComponent(role)}&saved=1`);
}

export async function resetRolePermissionsAction(role: "team_lead" | "agent") {
  "use server";
  const { user, db } = await requireUser();
  requireAdministrator(user, "/settings/roles");

  db.role_permissions = db.role_permissions.filter((r) => r.role !== role);
  db.role_permissions.push(...buildDefaultRows(role, uuid, nowIso));

  const info = await getRequestInfo();
  logActivity(db, user.id, "PERMISSIONS_UPDATED", "role_permission", role, { reset_to_defaults: true, role }, {
    module: "roles",
    ...info,
  });
  await writeDb(db);
  redirect(`/settings/roles?role=${encodeURIComponent(role)}&reset=1`);
}
