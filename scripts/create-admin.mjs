#!/usr/bin/env node
/**
 * Creates (or repairs) an Administrator account.
 *
 * The password is supplied through the environment and is never written to
 * source, never printed, and never stored in plaintext — only its bcrypt hash
 * reaches the database. The account is created with must_change_password set,
 * so whoever receives it has to replace it before they can use the system.
 *
 *   ADMIN_FULL_NAME="Jane Dela Cruz" \
 *   ADMIN_EMAIL="jane@company.com" \
 *   ADMIN_USERNAME="ROMA_jane" \
 *   ADMIN_PASSWORD="<choose a strong one>" \
 *   node scripts/create-admin.mjs
 *
 * Re-running with an existing username resets that account's password and
 * restores its Administrator role, which is the recovery path if the only admin
 * is ever locked out.
 */

import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* env may come from the shell instead */
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const fullName = process.env.ADMIN_FULL_NAME;
const email = process.env.ADMIN_EMAIL;
const username = process.env.ADMIN_USERNAME;
const password = process.env.ADMIN_PASSWORD;

function fail(message) {
  console.error(`\n  ABORTED: ${message}\n`);
  process.exit(1);
}

if (!SUPABASE_URL || !SERVICE_KEY) fail("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
if (!fullName || !email || !username || !password) {
  fail(
    "ADMIN_FULL_NAME, ADMIN_EMAIL, ADMIN_USERNAME and ADMIN_PASSWORD must all be provided.\n" +
      "  The password is read from the environment on purpose so it never lands in this file or in git."
  );
}
// Bootstrap escape hatch: a short password is allowed only when asked for
// explicitly, and only because must_change_password forces it to be replaced at
// first login — it is a one-use key to get back in, not a working credential.
if (password.length < 12 && process.env.ALLOW_WEAK_PASSWORD !== "1") {
  fail(
    "Choose a password of at least 12 characters for an administrator account.\n" +
      "  To bootstrap a locked-out account with a temporary one, re-run with ALLOW_WEAK_PASSWORD=1."
  );
}
if (password.length < 12) {
  console.warn("\n  WARNING: bootstrapping with a weak temporary password. It must be changed at first login.");
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function main() {
  const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];
  console.log(`\n  Supabase project : ${projectRef}`);
  console.log(`  Username         : ${username}`);
  console.log(`  Role             : administrator`);

  // Hashed with the same cost the application uses, so the login path verifies
  // it exactly as it would any other account.
  const password_hash = bcrypt.hashSync(password, 10);

  const { data: existing, error: readErr } = await db
    .from("profiles")
    .select("id, username")
    .ilike("username", username)
    .maybeSingle();
  if (readErr) fail(`reading profiles: ${readErr.message}`);

  if (existing) {
    const { error } = await db
      .from("profiles")
      .update({
        full_name: fullName,
        email,
        role: "administrator",
        is_active: true,
        is_deleted: false,
        deleted_at: null,
        password_hash,
        must_change_password: true,
      })
      .eq("id", existing.id);
    if (error) fail(`updating administrator: ${error.message}`);
    console.log(`\n  Existing account updated and password reset.`);
  } else {
    const { error } = await db.from("profiles").insert({
      id: randomUUID(),
      username,
      full_name: fullName,
      email,
      role: "administrator",
      team_lead_id: null,
      call_name: null,
      contact_number: null,
      is_active: true,
      password_hash,
      must_change_password: true,
      avatar_url: null,
      theme_preference: "light",
      permission_profile: null,
      last_login_at: null,
      is_deleted: false,
      deleted_at: null,
      created_at: new Date().toISOString(),
    });
    if (error) fail(`creating administrator: ${error.message}`);
    console.log(`\n  Administrator created.`);
  }

  console.log("  The password was not printed and is stored only as a bcrypt hash.");
  console.log("  This account must change its password at first login.\n");
}

main().catch((e) => fail(e.message));
