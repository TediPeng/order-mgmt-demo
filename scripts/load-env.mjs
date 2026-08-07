import { readFileSync } from "node:fs";

/**
 * Loads .env.local for the maintenance scripts, the same way Next.js does.
 *
 * Each script used to inline its own loader built on `if (!process.env[key])`,
 * which took the FIRST definition of a duplicated key. Next.js (dotenv) takes
 * the LAST. So a .env.local carrying both a production and a development
 * SUPABASE_URL pointed the running app at one database and every script at the
 * other, silently — which is exactly how an administrator account meant for
 * development was created in production instead.
 *
 * Rather than pick a winner, this refuses to run on a duplicated key. These
 * scripts create administrators and delete company data; guessing which of two
 * databases was meant is not a decision worth making automatically.
 *
 * A real environment variable still beats the file, matching dotenv.
 */
export function loadEnvLocal(url) {
  let text;
  try {
    text = readFileSync(url, "utf8");
  } catch {
    return; // May legitimately come from the shell instead.
  }

  const values = new Map();
  const duplicates = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    if (values.has(key)) duplicates.add(key);
    values.set(key, m[2].trim().replace(/^["']|["']$/g, ""));
  }

  if (duplicates.size > 0) {
    console.error(
      `\n  ABORTED: .env.local defines ${[...duplicates].join(", ")} more than once.\n` +
        "  Next.js would use the last definition and older versions of this script the\n" +
        "  first, so the app and this script could target different databases. Delete\n" +
        "  the stale line before re-running.\n"
    );
    process.exit(1);
  }

  for (const [key, value] of values) {
    if (!process.env[key]) process.env[key] = value;
  }
}

/** The Supabase project a script is about to act on, for printing before it
 * does. Never returns anything derived from the service-role key. */
export function projectRef(supabaseUrl) {
  try {
    return new URL(supabaseUrl).hostname.split(".")[0];
  } catch {
    return "(unparseable SUPABASE_URL)";
  }
}
