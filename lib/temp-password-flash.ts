import { cookies } from "next/headers";

/**
 * The temporary password an Administrator has just been shown, carried from
 * the action that minted it to the page that displays it.
 *
 * It used to travel in the query string — `/users?reset_pw=…` — which put a
 * live credential everywhere a URL goes: the server's access log, the browser's
 * history, the hosting platform's request log, and any proxy in between. None
 * of those are places a password can be taken back from, and the account it
 * belongs to cannot be signed in as until somebody uses it, so the window is
 * however long it takes an Administrator to hand it over.
 *
 * A cookie is not secret from the browser's owner — who is the Administrator
 * being shown the password anyway — but it is not written to any of those logs,
 * it is `httpOnly` so no script on the page can read it, and it expires by
 * itself. The banner clears it as soon as it has rendered, so "shown once only"
 * is true rather than aspirational.
 */
export const TEMP_PASSWORD_COOKIE = "roma_temp_pw";

export interface TempPasswordFlash {
  /** Whose password this is. */
  username: string;
  password: string;
  /** "created" came from a new account, "reset" from an Administrator reset —
   * the two say different things to the person reading the banner. */
  kind: "created" | "reset";
  /** Only meaningful for "created": whether the welcome email went out. */
  mail?: string;
}

/**
 * Ten minutes.
 *
 * It was two, on the reasoning that the banner deleted the cookie on sight so
 * this only had to cover a slow render. That clear-on-sight is what made the
 * password vanish before it could be copied, so the banner waits to be
 * dismissed now — and the common path still clears this immediately, because
 * pressing Done is the first thing anybody does.
 *
 * This is the backstop for the Administrator who walks away instead: long
 * enough to come back to, short enough that a browser left open on somebody's
 * desk is not still holding a live credential an hour later.
 */
const MAX_AGE_SECONDS = 600;

/**
 * Base64, because the value carries a generated password and those contain `%`.
 *
 * `randomTempPassword` draws from `!@#$%^&*?`, so roughly one password in three
 * holds a per cent sign, and a cookie value is run through
 * `decodeURIComponent` when it is read back. `%4S` is not a valid escape, so
 * the read threw `URIError: URI malformed` and the whole /users page answered
 * 500 — for some passwords and not others, which is the worst kind of bug to
 * meet in production. Base64 has no character the decoder treats as special.
 */
function encode(flash: TempPasswordFlash): string {
  return Buffer.from(JSON.stringify(flash), "utf8").toString("base64url");
}

function decode(raw: string): TempPasswordFlash {
  return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as TempPasswordFlash;
}

export async function setTempPasswordFlash(flash: TempPasswordFlash): Promise<void> {
  const store = await cookies();
  store.set(TEMP_PASSWORD_COOKIE, encode(flash), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_SECONDS,
    // Scoped to the one page that shows it, so it is not attached to every
    // other request the browser makes to this app.
    path: "/users",
  });
}

/** Reads it without consuming it — a Server Component may not write cookies,
 * so clearing is the banner's job once it has rendered. */
export async function readTempPasswordFlash(): Promise<TempPasswordFlash | null> {
  const store = await cookies();
  const raw = store.get(TEMP_PASSWORD_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = decode(raw);
    return parsed.username && parsed.password ? parsed : null;
  } catch {
    // A malformed cookie is not worth an error page; the Administrator can
    // reset again, and the next write replaces it.
    return null;
  }
}

export async function clearTempPasswordFlash(): Promise<void> {
  const store = await cookies();
  store.delete({ name: TEMP_PASSWORD_COOKIE, path: "/users" });
}
