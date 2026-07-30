import { randomInt } from "crypto";

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*?";
// Ambiguous glyphs (I, l, O, 0, 1) are omitted so an Administrator can read a
// generated password aloud or over chat without transcription errors.
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

function pick(pool: string): string {
  return pool[randomInt(pool.length)];
}

/**
 * A unique, cryptographically random temporary password for one account.
 * Shown to the Administrator once at creation and never stored in plaintext;
 * the account must change it on first login. Deliberately not a shared
 * documented default, which anyone could try against every new account.
 */
export function randomTempPassword(length = 14): string {
  const required = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  const rest = Array.from({ length: Math.max(0, length - required.length) }, () => pick(ALL));
  const chars = [...required, ...rest];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export const USERNAME_PREFIX = "ROMA_";

/**
 * Builds the suggested username for a new account from its Call Name:
 * `ROMA_` + call name lowercased with everything but a-z0-9 stripped.
 * Collisions get an incrementing suffix (ROMA_juandelacruz2, ...3).
 * The Administrator may edit the suggestion before saving.
 */
export function suggestUsername(callName: string, takenUsernames: Iterable<string>): string {
  const slug = callName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const base = `${USERNAME_PREFIX}${slug}`;
  const taken = new Set([...takenUsernames].map((u) => u.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base}${n}`.toLowerCase())) n++;
  return `${base}${n}`;
}
