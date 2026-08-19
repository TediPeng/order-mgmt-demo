import { cache } from "react";
import { cookies } from "next/headers";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "./supabaseAdmin";
import type { Profile } from "./types";

const COOKIE_NAME = "session";
const MAX_AGE = 60 * 60 * 8; // 8 hours

const DEV_SECRET = "dev-only-session-secret-not-for-production";

/** Every value this file has ever carried as a built-in fallback. All of them
 * are in the public repository, so they are refused as a SESSION_SECRET rather
 * than merely discouraged -- pasting one into the environment would look like
 * configuring the secret while leaving it exactly as guessable. */
const PUBLISHED_SECRETS = new Set(["demo-secret-do-not-use-in-prod", DEV_SECRET]);

/**
 * The key the session cookie is signed with.
 *
 * The cookie is a bare user id plus an HMAC of it, so this secret is the only
 * thing standing between knowing somebody's id and being signed in as them --
 * and every user id is visible to any signed-in account through rankings, the
 * user list and audit rows. It used to default to a constant published in this
 * repository, which meant an unset SESSION_SECRET turned the whole permission
 * system into an honour system: any agent could mint an Administrator cookie.
 *
 * So production has no fallback. A missing, short, or published secret throws
 * here rather than at import, matching lib/pancake/crypto.ts -- lazily, so a
 * build never depends on it, and on the first sign or verify rather than the
 * first request to any page. That takes the site down when it is misconfigured,
 * which is the intended trade: down is recoverable by setting one variable, and
 * forgeable sessions on live customer data are not.
 *
 * Outside production the dev value stands in, where the cookie is not `secure`
 * and the database is meant to be the dev project anyway.
 */
function sessionSecret(): string {
  const raw = process.env.SESSION_SECRET;

  if (raw && raw.length >= 16 && !PUBLISHED_SECRETS.has(raw)) return raw;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET is missing, shorter than 16 characters, or set to a value published in this repository. " +
        "It signs the session cookie, so a guessable one lets anybody mint a session for any user id. " +
        "Generate one with `openssl rand -hex 32` and set it in the Vercel environment. " +
        "Changing it signs everyone out; it does not touch any stored data."
    );
  }

  return DEV_SECRET;
}

function sign(value: string): string {
  const hmac = crypto.createHmac("sha256", sessionSecret()).update(value).digest("hex");
  return `${value}.${hmac}`;
}

function unsign(signed: string): string | null {
  const idx = signed.lastIndexOf(".");
  if (idx === -1) return null;
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = crypto.createHmac("sha256", sessionSecret()).update(value).digest("hex");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  return value;
}

export async function createSession(userId: string) {
  const store = await cookies();
  store.set(COOKIE_NAME, sign(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE,
    path: "/",
  });
}

const THEME_COOKIE = "theme";

/** Mirrors the account's theme into a plain cookie.
 *
 * profiles.theme_preference stays the source of truth — that is what makes the
 * choice follow the user to another device — but the root layout has to set
 * the class on <html> before anything renders, and reading the profile there
 * would mean a database round-trip on every request, including the login page.
 * The cookie is written at login and whenever the toggle is used, so the first
 * paint is already correct and there is no flash. */
export async function setThemeCookie(theme: string) {
  const store = await cookies();
  store.set(THEME_COOKIE, theme, {
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
}

export async function getThemeCookie(): Promise<string> {
  const store = await cookies();
  return store.get(THEME_COOKIE)?.value || "light";
}

export async function destroySession() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
  // The theme cookie deliberately survives logout: the login page should look
  // the way this browser last had it, and the account's stored preference
  // reasserts itself on the next sign-in anyway.
}

export async function getSessionUserId(): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  return unsign(raw);
}

/**
 * The signed-in user, from one row.
 *
 * This used to read the WHOLE database to find a single profile — and it runs
 * on every page render and every action, so after a large import each request
 * was fetching tens of thousands of orders before it could even say who was
 * asking. One row by primary key instead.
 *
 * The returned object is deliberately NOT the one inside a DbShape: callers
 * that change a profile (login stamping last_login_at, a password change, an
 * avatar) already re-find it in db.profiles before mutating, because that is
 * the copy writeDb() persists. Nothing may mutate this object and expect it to
 * be saved.
 */
export const getCurrentUser = cache(async (): Promise<Profile | null> => {
  const userId = await getSessionUserId();
  if (!userId) return null;
  const { data, error } = await supabaseAdmin.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw new Error(`Could not load the signed-in user: ${error.message}`);
  const profile = data as Profile | null;
  if (!profile || !profile.is_active) return null;
  return profile;
});

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}
