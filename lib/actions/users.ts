"use server";

import { redirect } from "next/navigation";
import { writeDb, uuid, nowIso } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { requireUser, requirePermission } from "./guards";
import { hashPassword } from "@/lib/auth";
import { randomTempPassword } from "@/lib/passwords";
import { userFormSchema } from "@/lib/validation";
import type { Profile } from "@/lib/types";
import { describeParseFailure } from "@/lib/zod-error";

export async function createUserAction(formData: FormData) {
  const { user, db } = await requireUser();
  requirePermission(user, "users", "create", db, "/users");

  const parsed = userFormSchema.safeParse({
    username: formData.get("username"),
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    role: formData.get("role"),
    team_lead_id: formData.get("team_lead_id"),
    call_name: formData.get("call_name"),
    contact_number: formData.get("contact_number"),
    permission_profile: formData.get("permission_profile"),
  });

  if (!parsed.success) {
    redirect(`/users?error=${encodeURIComponent(describeParseFailure(parsed.error))}`);
  }

  const data = parsed.data;
  if (db.profiles.some((p) => p.username.toLowerCase() === data.username.toLowerCase())) {
    redirect(`/users?error=${encodeURIComponent("That username is already taken.")}`);
  }
  if (!db.roles.some((r) => r.key === data.role)) {
    redirect(`/users?error=${encodeURIComponent("Unknown role selected.")}`);
  }

  // Each account gets its own random temporary password, shown to the
  // Administrator once here and never again. It must be changed on first login.
  const tempPassword = randomTempPassword();

  const newUser: Profile = {
    id: uuid(),
    username: data.username,
    full_name: data.full_name,
    email: data.email,
    role: data.role,
    team_lead_id: data.role === "agent" && data.team_lead_id ? data.team_lead_id : null,
    call_name: data.call_name || null,
    contact_number: data.contact_number || null,
    is_active: true,
    password_hash: hashPassword(tempPassword),
    must_change_password: true,
    avatar_url: null,
    theme_preference: "light" as const,
    permission_profile: data.permission_profile || null,
    last_login_at: null,
    is_deleted: false,
    deleted_at: null,
    created_at: nowIso(),
  };
  db.profiles.push(newUser);
  const info = await getRequestInfo();
  logActivity(db, user.id, "USER_CREATED", "user", newUser.id, { username: newUser.username, role: newUser.role }, {
    module: "users",
    // The hash is not a secret worth keeping out of the log, but there is no
    // reason to retain it either.
    updated_value: { ...newUser, password_hash: undefined },
    ...info,
  });
  await writeDb(db);
  redirect(
    `/users?created=1&temp_pw=${encodeURIComponent(tempPassword)}&temp_for=${encodeURIComponent(newUser.username)}`
  );
}

export async function updateUserRoleAction(userId: string, role: string) {
  "use server";
  const { user, db } = await requireUser();
  requirePermission(user, "users", "edit", db, "/users");

  const target = db.profiles.find((p) => p.id === userId);
  if (!target) redirect("/users");
  if (!db.roles.some((r) => r.key === role)) redirect("/users");

  const before = target!.role;
  target!.role = role;
  if (role !== "agent") target!.team_lead_id = null;
  const info = await getRequestInfo();
  logActivity(db, user.id, "USER_UPDATED", "user", userId, { field: "role", before, after: role }, {
    module: "users",
    previous_value: { role: before },
    updated_value: { role },
    ...info,
  });
  await writeDb(db);
  redirect("/users?updated=1");
}

export async function assignTeamLeadAction(userId: string, teamLeadId: string) {
  "use server";
  const { user, db } = await requireUser();
  requirePermission(user, "users", "assign", db, "/users");

  const target = db.profiles.find((p) => p.id === userId);
  if (!target) redirect("/users");

  const before = target!.team_lead_id;
  target!.team_lead_id = teamLeadId || null;
  const info = await getRequestInfo();
  logActivity(
    db,
    user.id,
    "USER_UPDATED",
    "user",
    userId,
    { field: "team_lead_id", before, after: target!.team_lead_id },
    { module: "users", previous_value: { team_lead_id: before }, updated_value: { team_lead_id: target!.team_lead_id }, ...info }
  );
  await writeDb(db);
  redirect("/users?updated=1");
}

export async function toggleActiveAction(userId: string) {
  "use server";
  const { user, db } = await requireUser();
  requirePermission(user, "users", "delete", db, "/users");

  if (userId === user.id) {
    redirect(`/users?error=${encodeURIComponent("You cannot deactivate your own account.")}`);
  }

  const target = db.profiles.find((p) => p.id === userId);
  if (!target) redirect("/users");
  target!.is_active = !target!.is_active;
  const info = await getRequestInfo();
  logActivity(db, user.id, "USER_DEACTIVATED", "user", userId, { is_active: target!.is_active }, {
    module: "users",
    updated_value: { is_active: target!.is_active },
    ...info,
  });
  await writeDb(db);
  redirect("/users?updated=1");
}

export async function adminResetPasswordAction(userId: string) {
  "use server";
  const { user, db } = await requireUser();
  requirePermission(user, "users", "edit", db, "/users");

  const target = db.profiles.find((p) => p.id === userId);
  if (!target) redirect("/users");

  const tempPassword = randomTempPassword();
  target!.password_hash = hashPassword(tempPassword);
  target!.must_change_password = true;
  const info = await getRequestInfo();
  logActivity(db, user.id, "PASSWORD_CHANGED", "user", userId, { reset_by_administrator: true }, {
    module: "users",
    ...info,
  });
  await writeDb(db);
  redirect(`/users?reset_pw=${encodeURIComponent(tempPassword)}&reset_for=${encodeURIComponent(target!.username)}`);
}
