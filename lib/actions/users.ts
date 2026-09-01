"use server";

import { redirect } from "next/navigation";
import { writeDb, uuid, nowIso } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { requireUserLite, requirePermission } from "./guards";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hashPassword } from "@/lib/auth";
import { randomTempPassword } from "@/lib/passwords";
import { userFormSchema } from "@/lib/validation";
import type { Profile } from "@/lib/types";
import { describeParseFailure } from "@/lib/zod-error";
import { isMailConfigured, sendMail } from "@/lib/mail/transport";
import { accountCreatedEmail } from "@/lib/mail/templates";
import { appBaseUrl } from "@/lib/app-url";
import { clearTempPasswordFlash, setTempPasswordFlash } from "@/lib/temp-password-flash";

/** Called by the banner once it has rendered, so a temporary password is shown
 * to one page view and not to every refresh until the cookie expires. */
export async function dismissTempPasswordAction(): Promise<void> {
  await clearTempPasswordFlash();
}

export async function createUserAction(formData: FormData) {
  const { user, db } = await requireUserLite();
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
    sip_extension: field("sip_extension"),
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
    // Set later, from Edit, once the PBX exists and extensions have been handed
    // out. The create form does not ask, because an account is made before
    // anybody knows which extension the person will sit on.
    sip_extension: null,
    contact_number: data.contact_number || null,
    is_active: true,
    password_hash: hashPassword(tempPassword),
    must_change_password: true,
    avatar_url: null,
    theme_preference: "light" as const,
    permission_profile: data.permission_profile || null,
    last_login_at: null,
    is_deleted: false,
    is_test_account: false,
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

    // A second write, only when the send failed. The account is already
    // committed above -- deliberately, since an email must never be the reason
    // an account does not exist -- so the outcome cannot ride along with
    // USER_CREATED. Without this the only trace of a failure is a banner the
    // Administrator has already navigated away from, and diagnosing it means
    // the hosting platform's runtime logs, which are a different system with
    // different access.
    if (!result.ok) {
      logActivity(db, user.id, "ACCOUNT_EMAIL_FAILED", "user", newUser.id, {
        username: newUser.username,
        to: newUser.email,
        mail_error: result.error,
      }, { module: "users", ...info });
      await writeDb(db);
    }
  }

  // The password rides in a short-lived httpOnly cookie, not the query string —
  // see lib/temp-password-flash.ts for why a URL is the wrong carrier for a
  // live credential. `created=1` stays in the URL because it is not a secret
  // and the page needs it when the flash has already been consumed.
  await setTempPasswordFlash({ username: newUser.username, password: tempPassword, kind: "created", mail });
  redirect("/users?created=1");
}

/**
 * The details an account is identified by: name, username, email, Call Name,
 * contact, permission profile.
 *
 * Everything else on the Users row already has its own control — Role and Team
 * Lead are inline selects, Status is a toggle, the password has Reset — and
 * these six had none at all. A typo in an email or a Call Name could only be
 * fixed by deleting the account and making another one, which is not something
 * anybody would do to a live agent, so it simply stayed wrong. It is not
 * cosmetic either: the Call Name is matched to a Pancake Order Source and the
 * email to a Pancake staff member, and an order will not forward without both.
 *
 * Role and team lead are deliberately absent from this form and read from the
 * database instead, so there is exactly one control for each of them and the
 * schema's "agents must have a Call Name" rule is still checked against the role
 * the account actually holds.
 */
export async function updateUserProfileAction(userId: string, formData: FormData) {
  // Lite: editing a profile has no business reading fifty thousand orders. The
  // one thing this action does touch on the orders table is written directly,
  // below, rather than through the in-memory copy.
  const { user, db } = await requireUserLite();
  requirePermission(user, "users", "edit", db, "/users");

  const target = db.profiles.find((p) => p.id === userId);
  if (!target) redirect("/users");
  // A deleted account is an anonymized tombstone kept so history still resolves.
  // Editing it would put the PII back that deletion existed to remove.
  if (target!.is_deleted) {
    redirect(`/users?error=${encodeURIComponent("A deleted account cannot be edited.")}`);
  }

  const field = (name: string): unknown => formData.get(name) ?? undefined;
  const parsed = userFormSchema.safeParse({
    username: field("username"),
    full_name: field("full_name"),
    email: field("email"),
    // From the database, not the form: this form does not offer them, and the
    // Call Name rule must be judged against the role the account really has.
    role: target!.role,
    team_lead_id: target!.team_lead_id ?? "",
    call_name: field("call_name"),
    contact_number: field("contact_number"),
    permission_profile: field("permission_profile"),
    sip_extension: field("sip_extension"),
  });
  if (!parsed.success) {
    redirect(`/users?error=${encodeURIComponent(describeParseFailure(parsed.error))}`);
  }

  const data = parsed.data;
  if (
    db.profiles.some((p) => p.id !== userId && p.username.toLowerCase() === data.username.toLowerCase())
  ) {
    redirect(`/users?error=${encodeURIComponent("That username is already taken.")}`);
  }

  const before = {
    username: target!.username,
    full_name: target!.full_name,
    email: target!.email,
    call_name: target!.call_name,
    contact_number: target!.contact_number,
    permission_profile: target!.permission_profile,
    sip_extension: target!.sip_extension,
  };
  const after = {
    username: data.username,
    full_name: data.full_name,
    email: data.email,
    call_name: data.call_name || null,
    contact_number: data.contact_number || null,
    permission_profile: data.permission_profile || null,
    sip_extension: data.sip_extension || null,
  };

  // Opening the form and closing it again is not a change, and an audit trail
  // that records it makes the entries that matter harder to find.
  const changed = (Object.keys(after) as (keyof typeof after)[]).filter((k) => before[k] !== after[k]);
  if (changed.length === 0) redirect("/users");

  Object.assign(target!, after);

  // An agent's email is denormalized onto every order they own, and
  // orderInScope() requires the two to agree — a mismatch is read as "not your
  // lead" and fails closed. So changing the email here, and nowhere else, took
  // 2,283 leads away from the agent who owned them on 2026-08-11: the Leads
  // list still showed them, because that query scopes by agent_id alone, but
  // Calling and every edit answered "You do not have access to that lead".
  //
  // One statement against the orders table rather than the in-memory copy:
  // the rows are not loaded here and there is no reason to load two thousand of
  // them to change one column.
  let ordersRestamped = 0;
  if (changed.includes("email")) {
    // The count rides on the update itself. Asking for the rows back instead
    // would cap the answer at PostgREST's thousand and under-report an agent
    // holding more than that — which is exactly the size this goes wrong at.
    const { count, error } = await supabaseAdmin
      .from("orders")
      .update({ assigned_agent_email: after.email }, { count: "exact" })
      .eq("agent_id", userId);
    if (error) {
      redirect(`/users?error=${encodeURIComponent(`Could not update this agent's leads: ${error.message}`)}`);
    }
    ordersRestamped = count ?? 0;
  }

  const info = await getRequestInfo();
  logActivity(
    db,
    user.id,
    "USER_UPDATED",
    "user",
    userId,
    { fields: changed, username: after.username, ...(ordersRestamped ? { orders_restamped: ordersRestamped } : {}) },
    {
      module: "users",
      previous_value: Object.fromEntries(changed.map((k) => [k, before[k]])),
      updated_value: Object.fromEntries(changed.map((k) => [k, after[k]])),
      ...info,
    }
  );
  await writeDb(db);
  redirect("/users?updated=1");
}

export async function updateUserRoleAction(userId: string, role: string) {
  "use server";
  const { user, db } = await requireUserLite();
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
  const { user, db } = await requireUserLite();
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
  const { user, db } = await requireUserLite();
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
  const { user, db } = await requireUserLite();
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
  await setTempPasswordFlash({ username: target!.username, password: tempPassword, kind: "reset" });
  redirect("/users");
}
