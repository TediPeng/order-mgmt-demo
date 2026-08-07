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
import { isMailConfigured, sendMail } from "@/lib/mail/transport";
import { accountCreatedEmail } from "@/lib/mail/templates";
import { appBaseUrl } from "@/lib/app-url";

export async function createUserAction(formData: FormData) {
  const { user, db } = await requireUser();
  requirePermission(user, "users", "create", db, "/users");

  // A disabled control is not submitted at all, so FormData.get() answers null
  // rather than "" — and Zod's .optional()/.default() only substitute for
  // undefined, so a null fails z.string() outright. The Team Lead select is
  // disabled unless the role is Agent, which made every attempt to create a
  // Team Lead or an Administrator fail on a field the form had deliberately
  // switched off. Mapping absent fields to undefined lets the schema's own
  // defaults apply, as buildLeadFieldErrors() does for the lead form.
  const field = (name: string): unknown => formData.get(name) ?? undefined;

  const parsed = userFormSchema.safeParse({
    username: field("username"),
    full_name: field("full_name"),
    email: field("email"),
    role: field("role"),
    team_lead_id: field("team_lead_id"),
    call_name: field("call_name"),
    contact_number: field("contact_number"),
    permission_profile: field("permission_profile"),
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

  // The account exists by this point whatever the mail server decides, so a
  // failed send downgrades the banner rather than unwinding the creation. The
  // password stays on screen either way: that hand-over is what worked before
  // this email existed and is the fallback when it does not arrive.
  let mail: "sent" | "failed" | "off" = "off";
  if (isMailConfigured()) {
    const result = await sendMail(
      accountCreatedEmail({
        to: newUser.email,
        fullName: newUser.full_name,
        username: newUser.username,
        tempPassword,
        loginUrl: `${appBaseUrl()}/login`,
      })
    );
    mail = result.ok ? "sent" : "failed";
  }

  redirect(
    `/users?created=1&temp_pw=${encodeURIComponent(tempPassword)}&temp_for=${encodeURIComponent(newUser.username)}&mail=${mail}`
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
