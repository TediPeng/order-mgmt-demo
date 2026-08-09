import { loadEnvLocal, projectRef } from "./load-env.mjs";

/**
 * Deletes the storage files left behind by a company-data reset.
 *
 * The DB rows that pointed at these files are gone, so nothing in the app can
 * reach them any more — but Supabase refuses a direct DELETE on storage.objects
 * ("Direct deletion from storage tables is not allowed. Use the Storage API
 * instead."), so they cannot be cleared in SQL alongside the tables. This does
 * the same job through the Storage API.
 *
 * Only the folders below are touched. `avatars/` is deliberately absent: those
 * files belong to the accounts, which a reset keeps.
 *
 * Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from an env file passed as
 * ENV_FILE (default .env.local), the same loader the other maintenance scripts
 * use. Prints the project it is about to act on first, and lists every file
 * before deleting it, because this is not undoable.
 *
 *   ENV_FILE=.env.prod.local node scripts/delete-orphan-storage.mjs          # list only
 *   ENV_FILE=.env.prod.local DELETE_ORPHANS=CONFIRM node scripts/… # actually delete
 */

const BUCKET = "uploads";
const FOLDERS = ["call-logs", "call-log-images", "attendance", "leave"];

loadEnvLocal(new URL(`../${process.env.ENV_FILE || ".env.local"}`, import.meta.url));

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. Set ENV_FILE to the file holding them.");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" };

async function listFolder(prefix) {
  const res = await fetch(`${url}/storage/v1/object/list/${BUCKET}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
  });
  if (!res.ok) throw new Error(`list ${prefix} failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  // A folder placeholder has no id; only real objects are returned with one.
  return rows.filter((r) => r.id).map((r) => `${prefix}/${r.name}`);
}

console.log(`\n  Project: ${projectRef(url)}`);
console.log(`  Bucket:  ${BUCKET}\n`);

const targets = [];
for (const folder of FOLDERS) targets.push(...(await listFolder(folder)));

if (targets.length === 0) {
  console.log("  Nothing to delete — these folders are already empty.\n");
  process.exit(0);
}

for (const path of targets) console.log(`  - ${path}`);

if (process.env.DELETE_ORPHANS !== "CONFIRM") {
  console.log(`\n  ${targets.length} file(s) listed. Re-run with DELETE_ORPHANS=CONFIRM to delete them.\n`);
  process.exit(0);
}

const res = await fetch(`${url}/storage/v1/object/${BUCKET}`, {
  method: "DELETE",
  headers,
  body: JSON.stringify({ prefixes: targets }),
});
if (!res.ok) {
  console.error(`\n  Delete failed: ${res.status} ${await res.text()}\n`);
  process.exit(1);
}
console.log(`\n  Deleted ${targets.length} file(s).\n`);
