import crypto from "crypto";

/**
 * Verifying a hand-off from the company portal.
 *
 * The portal signs a short statement — "this browser belongs to ROMA profile X,
 * and I vouch for that for the next minute" — and ROMA decides whether to act
 * on it. Nothing about ROMA's own sign-in changes and no password crosses
 * between the two; this only removes the second login for somebody an
 * administrator has already linked.
 *
 * The mirror of company-portal/src/lib/roma/sso.ts. The two have to agree byte
 * for byte on what is signed, which is why the signature covers the ENCODED
 * payload rather than a re-serialisation of the parsed object: JSON.stringify
 * is not required to order keys the same way in two runtimes, and a signature
 * over a re-serialisation would fail for reasons nobody could see.
 *
 * ROMA_SSO_SECRET is deliberately NOT SESSION_SECRET. That one signs ROMA's
 * session cookie, whose entire payload is a user id, so anybody holding it can
 * mint a session for any account in the system. The portal has no business
 * being able to do that; it may only ask, for one named profile, briefly.
 */

/** Matches HANDOFF_TTL_SECONDS in the portal. Only used to describe the window. */
export const HANDOFF_TTL_SECONDS = 60;

export interface HandoffPayload {
  /** The profiles.id this browser should be signed in as. */
  sub: string;
  /** Seconds since the epoch, after which this must be refused. */
  exp: number;
  iss: "company-portal";
  jti: string;
}

function secret(): string {
  const raw = process.env.ROMA_SSO_SECRET;

  if (!raw || raw.length < 32) {
    throw new Error(
      "ROMA_SSO_SECRET is missing or shorter than 32 characters. It verifies the " +
        "company portal's hand-off, so a guessable one lets anybody sign in as anybody. " +
        "Generate with `openssl rand -hex 32` and set the SAME value in both applications."
    );
  }

  return raw;
}

/**
 * Returns the payload, or null for anything that is not a currently valid
 * token. Never throws on malformed input: these arrive from the network, and a
 * 500 on a bad token is a way to learn about the endpoint.
 */
export function verifyHandoffToken(token: string): HandoffPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;

  const encoded = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", secret()).update(encoded).digest("hex");

  // Compared as equal-length buffers: timingSafeEqual throws on a length
  // mismatch, which would leak the length through the exception instead.
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"))) {
    return null;
  }

  let payload: HandoffPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (payload?.iss !== "company-portal") return null;
  if (typeof payload.sub !== "string" || !payload.sub) return null;
  if (typeof payload.exp !== "number") return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;

  return payload;
}
