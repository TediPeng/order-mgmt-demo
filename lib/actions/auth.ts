"use server";

import { redirect } from "next/navigation";
import { readDb, writeDb } from "@/lib/db";
import { createSession, destroySession, getCurrentUser, hashPassword, setThemeCookie, verifyPassword } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { passwordChangeSchema } from "@/lib/validation";

export async function loginAction(formData: FormData) {
  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");
  const info = await getRequestInfo();

  if (!username || !password) {
    redirect(`/login?error=${encodeURIComponent("Please enter your username and password.")}`);
  }

  const db = await readDb();
  const user = db.profiles.find((p) => p.username.toLowerCase() === username.toLowerCase());

  if (!user || !verifyPassword(password, user.password_hash)) {
    logActivity(db, user?.id ?? null, "LOGIN_FAILED", "auth", null, { username_attempted: username }, {
      module: "settings",
      ...info,
    });
    await writeDb(db);
    redirect(`/login?error=${encodeURIComponent("Incorrect username or password.")}`);
  }

  // A deleted account is a tombstone kept only so historical records still
  // resolve; it can never sign in again, whatever it is asked.
  if (user.is_deleted) {
    logActivity(db, user.id, "LOGIN_FAILED", "auth", null, { reason: "deleted" }, { module: "settings", ...info });
    await writeDb(db);
    redirect(`/login?error=${encodeURIComponent("Incorrect username or password.")}`);
  }

  if (!user.is_active) {
    logActivity(db, user.id, "LOGIN_FAILED", "auth", null, { reason: "deactivated" }, { module: "settings", ...info });
    await writeDb(db);
    redirect(`/login?error=${encodeURIComponent("This account has been deactivated. Contact your administrator.")}`);
  }

  // Surfaced in the Users list (Section 8), so it is stamped on every successful
  // sign-in rather than derived from the audit log.
  user.last_login_at = new Date().toISOString();

  logActivity(db, user.id, "LOGIN", "auth", user.id, { username: user.username }, { module: "settings", ...info });
  await writeDb(db);
  await createSession(user.id);
  await setThemeCookie(user.theme_preference || "light");
  redirect("/dashboard");
}

export async function logoutAction() {
  const user = await getCurrentUser();
  if (user) {
    const db = await readDb();
    const info = await getRequestInfo();
    logActivity(db, user.id, "LOGOUT", "auth", user.id, { username: user.username }, { module: "settings", ...info });
    await writeDb(db);
  }
  await destroySession();
  redirect("/login");
}

export async function requestPasswordResetAction(formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  const db = await readDb();
  const user = db.profiles.find((p) => p.email.toLowerCase() === email.toLowerCase());
  if (user) {
    logActivity(db, user.id, "PASSWORD_RESET_REQUESTED", "auth", user.id, { email });
    await writeDb(db);
  }
  redirect(`/forgot-password?sent=1`);
}

export async function changeOwnPasswordAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = passwordChangeSchema.safeParse({
    current_password: formData.get("current_password"),
    new_password: formData.get("new_password"),
    confirm_password: formData.get("confirm_password"),
  });

  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message || "Invalid input.";
    redirect(`/settings/password?error=${encodeURIComponent(msg)}`);
  }

  const db = await readDb();
  const profile = db.profiles.find((p) => p.id === user!.id)!;

  if (!verifyPassword(parsed.data.current_password, profile.password_hash)) {
    redirect(`/settings/password?error=${encodeURIComponent("Current password is incorrect.")}`);
  }

  // Setting the new password to the old one would defeat a forced reset, so the
  // temporary password an Administrator issued cannot simply be kept.
  if (verifyPassword(parsed.data.new_password, profile.password_hash)) {
    redirect(
      `/settings/password?error=${encodeURIComponent("Your new password must be different from your current one.")}`
    );
  }

  profile.password_hash = hashPassword(parsed.data.new_password);
  profile.must_change_password = false;
  const info = await getRequestInfo();
  logActivity(db, user!.id, "PASSWORD_CHANGED", "user", user!.id, { self: true }, { module: "settings", ...info });
  await writeDb(db);
  redirect(`/settings/password?success=1`);
}
