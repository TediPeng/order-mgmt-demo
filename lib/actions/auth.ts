"use server";

import { redirect } from "next/navigation";
import { readDbLite, writeDb } from "@/lib/db";
import { createSession, destroySession, getCurrentUser, hashPassword, setThemeCookie, verifyPassword } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { passwordChangeSchema, passwordResetSchema } from "@/lib/validation";
import { describeParseFailure } from "@/lib/zod-error";
import {
  RESET_TOKEN_TTL_MINUTES,
  checkResetToken,
  consumeResetToken,
  invalidateTokensFor,
  issueResetToken,
} from "@/lib/password-reset";
import { sendMail } from "@/lib/mail/transport";
import { passwordResetEmail } from "@/lib/mail/templates";
import { appBaseUrl } from "@/lib/app-url";

export async function loginAction(formData: FormData) {
  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");
  const info = await getRequestInfo();

  if (!username || !password) {
    redirect(`/login?error=${encodeURIComponent("Please enter your username and password.")}`);
  }

  const db = await readDbLite();
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

  /**
   * The floor signs in through the company portal, not here.
   *
   * Refused in the action rather than by hiding the form, because hiding a form
   * closes nothing: the POST still exists and can still be called. This is the
   * check that actually holds.
   *
   * Agents only. An Administrator keeps the password form deliberately — it is
   * the way back in when the portal or the hand-off is the thing that broke,
   * and two of the three administrator accounts have no employee record in the
   * portal at all, so SSO could not admit them even when it is working. A Team
   * Lead is left alone for the same reason: they are who an agent is sent to.
   *
   * The password is checked BEFORE this, on purpose. Refusing an unknown
   * username here would answer "is this a real agent account" to anyone who
   * asked, and the message below names the portal, which is a thing worth
   * knowing only if the account is yours.
   */
  if (user.role === "agent" && db.operations.agent_login_via_portal_only) {
    logActivity(db, user.id, "LOGIN_FAILED", "auth", null, { reason: "portal_only" }, { module: "settings", ...info });
    await writeDb(db);
    redirect(
      `/login?error=${encodeURIComponent("Please log in using your 4S Portal account.")}`
    );
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
    const db = await readDbLite();
    const info = await getRequestInfo();
    logActivity(db, user.id, "LOGOUT", "auth", user.id, { username: user.username }, { module: "settings", ...info });
    await writeDb(db);
  }
  await destroySession();
  redirect("/login");
}

export async function requestPasswordResetAction(formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  const db = await readDbLite();
  const user = db.profiles.find((p) => p.email.toLowerCase() === email.toLowerCase());

  // Deactivated and deleted accounts are treated as absent. A reset link is a
  // way back in, and an account that was switched off must not have one.
  if (user && user.is_active && !user.is_deleted) {
    const token = await issueResetToken(user.id);
    const result = await sendMail(
      passwordResetEmail({
        to: user.email,
        fullName: user.full_name,
        resetUrl: `${appBaseUrl()}/reset-password?token=${encodeURIComponent(token.raw)}`,
        expiresInMinutes: RESET_TOKEN_TTL_MINUTES,
      })
    );
    // A token that could not be delivered is retired immediately rather than
    // left live for its full hour with nobody holding it.
    if (!result.ok) await invalidateTokensFor(user.id);
    // The reason a send failed is recorded alongside the fact of it. Knowing
    // only that mail_sent was false means reaching for the platform's runtime
    // logs, which is a different system with different access -- and the
    // person who needs the answer is usually looking at the audit trail
    // already. The message is the SMTP server's own; it names hosts and
    // status codes, never the credentials, which are not in scope here.
    logActivity(db, user.id, "PASSWORD_RESET_REQUESTED", "auth", user.id, {
      email,
      mail_sent: result.ok,
      ...(result.ok ? {} : { mail_error: result.error }),
    });
    await writeDb(db);
  }

  // Always the same answer, whether or not the address matched an account --
  // a differing response is how an attacker enumerates who has a login here.
  redirect(`/forgot-password?sent=1`);
}

/** Sets a new password from an emailed reset link. The token is the only
 * credential: whoever holds it proves control of the mailbox on file, which is
 * the same bar `adminResetPasswordAction` clears by handing over a temporary
 * password in person. */
export async function resetPasswordWithTokenAction(formData: FormData) {
  const token = String(formData.get("token") || "");
  const back = (msg: string) => `/reset-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent(msg)}`;

  const parsed = passwordResetSchema.safeParse({
    new_password: formData.get("new_password"),
    confirm_password: formData.get("confirm_password"),
  });
  if (!parsed.success) redirect(back(describeParseFailure(parsed.error)));

  // Re-checked here rather than trusted from the page that rendered the form:
  // the token may have expired, or been spent in another tab, in between.
  const check = await checkResetToken(token);
  if (!check.ok) redirect(`/reset-password?invalid=${check.reason}`);

  const db = await readDbLite();
  const profile = db.profiles.find((p) => p.id === check.userId);
  if (!profile || !profile.is_active || profile.is_deleted) {
    redirect(`/reset-password?invalid=unknown`);
  }

  // Spend the token before writing the password. If this loses the race with
  // another submission it updates no rows, and the loser must not also get to
  // set a password.
  if (!(await consumeResetToken(check.tokenId))) {
    redirect(`/reset-password?invalid=used`);
  }

  profile!.password_hash = hashPassword(parsed.data.new_password);
  // The reset satisfies the forced-change requirement, so an account created
  // minutes ago does not land on the change-password screen holding a password
  // it just chose.
  profile!.must_change_password = false;
  const info = await getRequestInfo();
  logActivity(db, profile!.id, "PASSWORD_CHANGED", "user", profile!.id, { via: "reset_link" }, {
    module: "settings",
    ...info,
  });
  await writeDb(db);
  await invalidateTokensFor(profile!.id);

  redirect(`/login?reset=1`);
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
    const msg = describeParseFailure(parsed.error);
    redirect(`/settings/password?error=${encodeURIComponent(msg)}`);
  }

  const db = await readDbLite();
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
