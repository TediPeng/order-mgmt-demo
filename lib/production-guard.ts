/**
 * Refuses a company-wide wipe started from a developer's machine while the app
 * is pointed at the production database.
 *
 * On 7 August 2026 a Clear Company Data run on localhost erased live records.
 * The answer at the time was a second Supabase project for development, and
 * `.env.local` was pointed at it — but that only works while somebody remembers
 * to keep it pointed there, and the dev project was deleted on 12 September
 * 2026. A file that has to be correct is not a safeguard; this is.
 *
 * The rule is one sentence: **a destructive company-wide operation may not run
 * from outside Vercel against the production project.**
 *
 * Two questions, and both have to be answered wrong for anything to be blocked:
 *
 *   Which database?  The project ref in SUPABASE_URL. Production is a constant
 *                    below rather than a flag, because a flag can be set wrong
 *                    in exactly the situation this exists to catch.
 *
 *   Which machine?   `process.env.VERCEL`, which the platform sets on every
 *                    deployment and nothing sets locally. NODE_ENV cannot
 *                    answer this — `next start` on a laptop is "production" too.
 *
 * So production-on-Vercel proceeds untouched, a laptop pointed at any other
 * database proceeds untouched, and only the combination that caused the loss is
 * refused. ROMA is deployed on Vercel and nowhere else; if it is ever hosted
 * somewhere that does not set VERCEL, this will refuse there too, and the fix is
 * to teach runningOnDeployedHost() about that host — not to delete the check.
 *
 * The escape hatch is deliberately a sentence rather than a flag. Somebody who
 * really does mean to wipe production from their own machine can, and will have
 * typed out what they are doing to get there.
 */

/** 4S RETENTION — the live database, with 17 agents working in it. */
export const PRODUCTION_PROJECT_REF = "lvqpvcpcbjujcqlntjjn";

export const OVERRIDE_ENV = "ALLOW_DESTRUCTIVE_PRODUCTION_RUN";
export const OVERRIDE_PHRASE = "YES I AM WIPING PRODUCTION";

/** Whether this process is talking to the live database. */
export function targetsProduction(): boolean {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  return url.includes(PRODUCTION_PROJECT_REF);
}

/** Whether this process is a deployment rather than somebody's machine. */
export function runningOnDeployedHost(): boolean {
  return Boolean(process.env.VERCEL);
}

/** Whether the override sentence has been typed out in the environment. */
export function overrideGiven(): boolean {
  return (process.env[OVERRIDE_ENV] || "").trim().toUpperCase() === OVERRIDE_PHRASE;
}

/**
 * Non-null reason when a destructive company-wide operation must be refused.
 *
 * `what` names the operation, so the message says which thing was stopped rather
 * than leaving the reader to guess.
 */
export function destructiveRunBlockReason(what: string): string | null {
  if (!targetsProduction()) return null;
  if (runningOnDeployedHost()) return null;
  if (overrideGiven()) return null;

  return (
    `${what} was refused.\n\n` +
    `This is not running on Vercel, which means it is running on somebody's own ` +
    `machine — and SUPABASE_URL points at the PRODUCTION database ` +
    `(${PRODUCTION_PROJECT_REF}), where 17 agents are working right now.\n\n` +
    `This exact combination erased live company records on 7 August 2026.\n\n` +
    `If you meant to do this against a copy, point .env.local at that copy. ` +
    `If you really do mean production, set ${OVERRIDE_ENV}="${OVERRIDE_PHRASE}" ` +
    `and run it again.`
  );
}
