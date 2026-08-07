import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/** Password reset tokens.
 *
 * Lives outside DbShape and talks to Supabase directly, the same way
 * lib/call-sessions.ts does: readDb() pulls every row of every table it covers
 * on every request, and short-lived single-use tokens have no business being
 * in that payload.
 *
 * Only the SHA-256 hash of a token is stored. The raw value exists in exactly
 * one place -- the email that carried it -- so a leaked database dump yields
 * no working reset links. That is also why a lookup hashes the incoming token
 * and matches on the hash rather than scanning and comparing.
 *
 * A token is spent by `used_at`, not by deletion, so a second click on the
 * same link is a clean "already used" rather than an indistinguishable
 * "unknown token", and the audit trail keeps its shape. */

export const RESET_TOKEN_TTL_MINUTES = 60;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export interface IssuedToken {
  raw: string;
  expiresAt: string;
}

/** Issues a token for one account, invalidating any still-live token it
 * already had -- asking for a second link must retire the first, or an old
 * email left in an inbox stays as good as the new one. */
export async function issueResetToken(userId: string): Promise<IssuedToken> {
  await invalidateTokensFor(userId);

  // 32 bytes from the CSPRNG. base64url so the value survives a URL without
  // encoding, and so a mail client cannot break it across a line.
  const raw = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000).toISOString();

  const { error } = await supabaseAdmin.from("password_reset_tokens").insert({
    user_id: userId,
    token_hash: hashToken(raw),
    expires_at: expiresAt,
  });
  if (error) throw new Error(`password_reset_tokens insert failed: ${error.message}`);

  return { raw, expiresAt };
}

export type TokenCheck =
  | { ok: true; tokenId: string; userId: string }
  | { ok: false; reason: "unknown" | "used" | "expired" };

/** Resolves a raw token from a reset link. Every failure is reported as a
 * reason rather than a thrown error, because all three end at the same screen
 * -- the distinction only changes the wording. */
export async function checkResetToken(raw: string): Promise<TokenCheck> {
  if (!raw) return { ok: false, reason: "unknown" };

  const { data, error } = await supabaseAdmin
    .from("password_reset_tokens")
    .select("id, user_id, expires_at, used_at, token_hash")
    .eq("token_hash", hashToken(raw))
    .maybeSingle();
  if (error) throw new Error(`password_reset_tokens read failed: ${error.message}`);
  if (!data) return { ok: false, reason: "unknown" };

  // The hash was already the lookup key, so this compares equal by
  // construction; doing it in constant time anyway keeps the comparison from
  // becoming a timing oracle if this ever grows into a scan.
  const expected = Buffer.from(String(data.token_hash), "hex");
  const actual = Buffer.from(hashToken(raw), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: "unknown" };
  }

  if (data.used_at) return { ok: false, reason: "used" };
  if (new Date(String(data.expires_at)).getTime() <= Date.now()) return { ok: false, reason: "expired" };

  return { ok: true, tokenId: String(data.id), userId: String(data.user_id) };
}

/** Marks a token spent. Conditional on `used_at` still being null, so two
 * submissions racing each other cannot both come back as the winner -- the
 * second updates zero rows and is refused. */
export async function consumeResetToken(tokenId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("password_reset_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", tokenId)
    .is("used_at", null)
    .select("id");
  if (error) throw new Error(`password_reset_tokens update failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** Retires every live token for an account. Called when a new one is issued
 * and again once a reset completes, so a successful change cannot leave a
 * spare link working. */
export async function invalidateTokensFor(userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("password_reset_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("used_at", null);
  if (error) throw new Error(`password_reset_tokens invalidate failed: ${error.message}`);
}
