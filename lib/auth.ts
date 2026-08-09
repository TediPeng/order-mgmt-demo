import { cache } from "react";
import { cookies } from "next/headers";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "./supabaseAdmin";
import type { Profile } from "./types";

const COOKIE_NAME = "session";
const SECRET = process.env.SESSION_SECRET || "demo-secret-do-not-use-in-prod";
const MAX_AGE = 60 * 60 * 8; // 8 hours

function sign(value: string): string {
  const hmac = crypto.createHmac("sha256", SECRET).update(value).digest("hex");
  return `${value}.${hmac}`;
}

function unsign(signed: string): string | null {
  const idx = signed.lastIndexOf(".");
  if (idx === -1) return null;
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = crypto.createHmac("sha256", SECRET).update(value).digest("hex");
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
