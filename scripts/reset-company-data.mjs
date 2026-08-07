#!/usr/bin/env node
/**
 * ONE-TIME COMPANY DATA RESET — DESTRUCTIVE.
 *
 * Clears transactional and user-generated records so the company can start on a
 * clean system, while preserving schema, reference data, configuration and
 * integrations.
 *
 * This script never runs by itself. It requires RESET_COMPANY_DATA=CONFIRM and
 * prints the project it is about to touch first, because local development and
 * production share ONE Supabase project on this deployment — there is no second
 * database to fall back on if it is pointed at the wrong place.
 *
 *   RESET_COMPANY_DATA=CONFIRM node scripts/reset-company-data.mjs
 *   RESET_COMPANY_DATA=CONFIRM node scripts/reset-company-data.mjs --dry-run
 *
 * PRESERVED: roles, role_permissions, products, psgc_* address data,
 * pancake_accounts, pancake_status_map, app_settings, update_logs, storage
 * buckets, and every table/column/index/policy.
 *
 * KEEP_ORDER_IDS lets a live order survive the wipe — an order already forwarded
 * to Pancake with a courier waybill must stay reconcilable, since deleting it
 * here would not cancel the parcel.
 */

import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env.mjs";

// --- Load .env.local without printing anything from it ----------------------
loadEnvLocal(new URL("../.env.local", import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DRY_RUN = process.argv.includes("--dry-run");

/** Orders to preserve. Anything already shipping must not be erased locally. */
const KEEP_ORDER_IDS = (process.env.KEEP_ORDER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
/** Profiles to keep as usable accounts. */
const KEEP_PROFILE_IDS = (process.env.KEEP_PROFILE_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);

function fail(message) {
  console.error(`\n  ABORTED: ${message}\n`);
  process.exit(1);
}

if (process.env.RESET_COMPANY_DATA !== "CONFIRM") {
  fail(
    "This script deletes company data and refuses to run without an explicit confirmation.\n" +
      "  Re-run with: RESET_COMPANY_DATA=CONFIRM node scripts/reset-company-data.mjs"
  );
}
if (!SUPABASE_URL || !SERVICE_KEY) {
  fail("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (in .env.local or the shell).");
}

// Project ref only — the key itself is never printed or logged.
const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/**
 * Child-before-parent. Every table here holds transactional or user-generated
 * data; reference and configuration tables are deliberately absent.
 */
const PLAN = [
  { table: "customer_duplicate_matches", scope: "all" },
  { table: "call_log_images", scope: "all" },
  { table: "agent_call_log_records", scope: "all" },
  { table: "agent_call_log_uploads", scope: "all" },
  { table: "call_log_records", scope: "all" },
  { table: "call_logs", scope: "all" },
  { table: "notifications", scope: "all" },
  { table: "activity_log", scope: "all" },
  { table: "pancake_sync_logs", scope: "except_kept_orders", column: "order_id" },
  { table: "call_sessions", scope: "except_kept_orders", column: "order_id" },
  { table: "product_uploads", scope: "all" },
  { table: "account_deletions", scope: "all" },
  { table: "leave_requests", scope: "all" },
  { table: "schedules", scope: "all" },
  { table: "suspensions", scope: "all" },
  { table: "attendance", scope: "all" },
  { table: "orders", scope: "except_kept_orders", column: "id" },
  { table: "customers", scope: "all" },
  // Keyed by seq_date, not id — resetting it restarts the internal
  // ORD-YYYYMMDD-#### counter for the company's first real day.
  { table: "order_sequences", scope: "all", idColumn: "seq_date" },
];

async function countRows(table) {
  const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return count ?? 0;
}

async function main() {
  console.log("\n──────────────────────────────────────────────────────────────");
  console.log("  4S ROMA — COMPANY DATA RESET");
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`  Supabase project : ${projectRef}`);
  console.log(`  Mode             : ${DRY_RUN ? "DRY RUN (nothing will be deleted)" : "LIVE — RECORDS WILL BE DELETED"}`);
  console.log(`  Orders preserved : ${KEEP_ORDER_IDS.length ? KEEP_ORDER_IDS.join(", ") : "(none)"}`);
  console.log(`  Accounts kept    : ${KEEP_PROFILE_IDS.length ? KEEP_PROFILE_IDS.length : 0}`);
  console.log("──────────────────────────────────────────────────────────────\n");

  if (KEEP_PROFILE_IDS.length === 0) {
    fail("KEEP_PROFILE_IDS is empty — refusing to leave the system with no administrator.");
  }

  console.log("  Record counts BEFORE:");
  const before = {};
  for (const step of PLAN) {
    before[step.table] = await countRows(step.table);
    console.log(`    ${step.table.padEnd(28)} ${String(before[step.table]).padStart(6)}`);
  }
  before.profiles = await countRows("profiles");
  console.log(`    ${"profiles".padEnd(28)} ${String(before.profiles).padStart(6)}`);

  if (DRY_RUN) {
    console.log("\n  Dry run complete — nothing was deleted.\n");
    return;
  }

  console.log("\n  Deleting (child tables first):");
  for (const step of PLAN) {
    let q = db.from(step.table).delete();
    if (step.scope === "except_kept_orders" && KEEP_ORDER_IDS.length > 0) {
      // Rows whose order is preserved stay; rows with a null order are cleared.
      q = q.or(`${step.column}.is.null,${step.column}.not.in.(${KEEP_ORDER_IDS.join(",")})`);
    } else {
      q = q.not(step.idColumn || "id", "is", null);
    }
    const { error } = await q;
    if (error) fail(`deleting ${step.table}: ${error.message} — stopping before any further tables are touched.`);
    const after = await countRows(step.table);
    console.log(`    ${step.table.padEnd(28)} ${String(before[step.table]).padStart(6)} → ${String(after).padStart(6)}`);
  }

  // --- Profiles -------------------------------------------------------------
  // A profile still referenced by a preserved order cannot be deleted (the FK is
  // RESTRICT) and must not be, or the order loses its owner. Those become
  // anonymized tombstones: PII cleared, login impossible, history intact.
  const { data: profiles, error: pErr } = await db.from("profiles").select("id, username");
  if (pErr) fail(`reading profiles: ${pErr.message}`);

  const { data: referenced } = await db.from("orders").select("agent_id, created_by, updated_by");
  const stillReferenced = new Set(
    (referenced || []).flatMap((o) => [o.agent_id, o.created_by, o.updated_by]).filter(Boolean)
  );

  let deleted = 0;
  let tombstoned = 0;
  for (const p of profiles || []) {
    if (KEEP_PROFILE_IDS.includes(p.id)) continue;

    if (stillReferenced.has(p.id)) {
      const { error } = await db
        .from("profiles")
        .update({
          is_deleted: true,
          deleted_at: new Date().toISOString(),
          is_active: false,
          full_name: "Deleted User",
          email: `deleted+${p.id}@invalid.local`,
          username: `deleted_${p.id.slice(0, 8)}`,
          call_name: null,
          contact_number: null,
          avatar_url: null,
          team_lead_id: null,
          password_hash: `deleted:${p.id}`,
          must_change_password: false,
        })
        .eq("id", p.id);
      if (error) fail(`anonymizing profile: ${error.message}`);
      tombstoned++;
      continue;
    }

    const { error } = await db.from("profiles").delete().eq("id", p.id);
    if (error) fail(`deleting profile: ${error.message}`);
    deleted++;
  }
  console.log(`\n    profiles                     deleted ${deleted}, anonymized ${tombstoned}, kept ${KEEP_PROFILE_IDS.length}`);

  console.log("\n  Preserved (untouched): roles, role_permissions, products, psgc_provinces/cities/barangays,");
  console.log("  pancake_accounts, pancake_status_map, app_settings, update_logs, storage buckets.\n");
  console.log("  Reset complete.\n");
}

main().catch((e) => fail(e.message));
