import { NextRequest, NextResponse } from "next/server";
import { createSession, setThemeCookie } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getRequestInfo } from "@/lib/request-info";
import { verifyHandoffToken } from "@/lib/portal-sso";
// Straight from the uuid package rather than through lib/db, which re-exports
// it: importing lib/db here would pull bcrypt, the permission tables and the
// whole read/write cycle into a route that needs a random id and a timestamp.
import { v4 as uuid } from "uuid";

const nowIso = () => new Date().toISOString();

export const dynamic = "force-dynamic";

/**
 * Signing somebody in from the company portal.
 *
 * The portal has already established who this is — it is their own signed-in
 * session — and an administrator has already recorded which ROMA account they
 * are. This endpoint checks that the portal really said it, that it said it in
 * the last minute, and that the account it names may sign in at all. Then it
 * starts an ordinary ROMA session, exactly as loginAction does.
 *
 * POST, not GET, and the token is read from the body. A token in a query string
 * lives on in browser history, in the Referer header of whatever loads next,
 * and in the access log of every proxy in between — and this one is enough to
 * be somebody. Being POST-only also means a bare link cannot trigger it.
 *
 * The three refusals below are deliberately the same three loginAction makes,
 * in the same order. A door that skips a check the front door makes is not a
 * side entrance, it is a hole: an account deactivated this morning must not
 * still be reachable this afternoon because it came in this way.
 */
export async function POST(req: NextRequest) {
  let token = "";
  try {
    const form = await req.formData();
    token = String(form.get("token") || "");
  } catch {
    return NextResponse.redirect(new URL("/login?error=" + encodeURIComponent("That sign-in link could not be read."), req.url), 303);
  }

  const payload = token ? verifyHandoffToken(token) : null;

  if (!payload) {
    // Forged, tampered with, or simply older than a minute — a stale one is by
    // far the likeliest, so the message is about time rather than blame.
    return NextResponse.redirect(
      new URL("/login?error=" + encodeURIComponent("That sign-in link has expired. Open ROMA from the portal again."), req.url),
      303
    );
  }

  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select("id, username, full_name, theme_preference, is_active, is_deleted")
    .eq("id", payload.sub)
    .maybeSingle();

  if (error) {
    console.error("[sso] profile read failed: %s", error.message);
    return NextResponse.redirect(
      new URL("/login?error=" + encodeURIComponent("Could not sign you in just now. Try again."), req.url),
      303
    );
  }

  // Said the same way the password path says it: a deleted account is a
  // tombstone kept so old records still resolve, and it can never sign in again
  // however it is asked.
  if (!profile || profile.is_deleted || !profile.is_active) {
    return NextResponse.redirect(
      new URL("/login?error=" + encodeURIComponent("That account cannot sign in. Contact your administrator."), req.url),
      303
    );
  }

  const info = await getRequestInfo();

  // Written as two targeted statements rather than through readDb/writeDb.
  // writeDb rewrites whole tables, and signing in should not cost a rewrite of
  // a hundred thousand orders.
  const [{ error: stampError }, { error: logError }] = await Promise.all([
    supabaseAdmin.from("profiles").update({ last_login_at: nowIso() }).eq("id", profile.id),
    supabaseAdmin.from("activity_log").insert({
      id: uuid(),
      user_id: profile.id,
      user_email: null,
      // Distinct from LOGIN on purpose. "They came in from the portal without
      // typing a password" is exactly the thing an audit reader wants to be
      // able to tell apart, and a shared action name would hide it.
      action: "LOGIN_VIA_PORTAL",
      entity_type: "auth",
      entity_id: profile.id,
      details: { username: profile.username, jti: payload.jti },
      module: "settings",
      previous_value: null,
      updated_value: null,
      ip_address: info.ip_address ?? null,
      device_info: info.device_info ?? null,
      created_at: nowIso(),
    }),
  ]);

  // Neither is worth refusing the sign-in over — the person is who they are
  // either way — but a silent failure here means an audit trail with a hole in
  // it, so it goes to the server log rather than nowhere.
  if (stampError) console.error("[sso] last_login_at stamp failed: %s", stampError.message);
  if (logError) console.error("[sso] activity log failed: %s", logError.message);

  await createSession(profile.id);
  await setThemeCookie(profile.theme_preference || "light");

  // 303 so the browser turns the POST into a GET. Without it the redirect is
  // followed as another POST and /dashboard answers 405.
  return NextResponse.redirect(new URL("/dashboard", req.url), 303);
}
