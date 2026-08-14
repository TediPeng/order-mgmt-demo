#!/usr/bin/env node
/**
 * Creates (or repairs) an Agent account, for looking at the agent's side of the
 * app without borrowing somebody's real login.
 *
 * The password is supplied through the environment and is never written to
 * source, never printed, and never stored in plaintext — only its bcrypt hash
 * reaches the database.
 *
 *   AGENT_FULL_NAME="Test Agent" \
 *   AGENT_CALL_NAME="TESTER" \
 *   AGENT_EMAIL="test.agent@example.com" \
 *   AGENT_USERNAME="ROMA_test" \
 *   AGENT_PASSWORD="<choose one>" \
 *   node scripts/create-agent.mjs
 *
 * Optional:
 *   AGENT_TEAM_LEAD_USERNAME  put the agent under an existing team lead
 *   AGENT_CLAIM_LEADS=10      hand that many leads over, so the agent's list is
 *                             not empty — an agent sees only their own
 *   MUST_CHANGE_PASSWORD=1    force a password change at first login (off by
 *                             default here: this account exists to be logged
 *                             into and looked at)
 *
 * Re-running with an existing username resets that account's password and
 * restores its agent role.
 */

import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { loadEnvLocal } from "./load-env.mjs";

loadEnvLocal(new URL("../.env.local", import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** The live database. A test account belongs on dev; on production, agents are
 * created through the Users page, with a real person's name on them. This is a
 * guard against a mis-pointed .env.local, which has cost this project real data
 * before — override it deliberately if that is genuinely what you want. */
const PRODUCTION_REF = "lvqpvcpcbjujcqlntjjn";

const fullName = process.env.AGENT_FULL_NAME;
const callName = process.env.AGENT_CALL_NAME;
const email = process.env.AGENT_EMAIL;
const username = process.env.AGENT_USERNAME;
const password = process.env.AGENT_PASSWORD;
const teamLeadUsername = process.env.AGENT_TEAM_LEAD_USERNAME || null;
const claimLeads = Number(process.env.AGENT_CLAIM_LEADS || 0);

function fail(message) {
  console.error(`\n  ABORTED: ${message}\n`);
  process.exit(1);
}

if (!SUPABASE_URL || !SERVICE_KEY) fail("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
if (!fullName || !email || !username || !password) {
  fail(
    "AGENT_FULL_NAME, AGENT_EMAIL, AGENT_USERNAME and AGENT_PASSWORD must all be provided.\n" +
      "  The password is read from the environment on purpose so it never lands in this file or in git."
  );
}
if (password.length < 8) fail("Choose a password of at least 8 characters.");

const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];
if (projectRef === PRODUCTION_REF && process.env.ALLOW_PRODUCTION !== "1") {
  fail(
    `.env.local points at the LIVE database (${projectRef}).\n` +
      "  Create agents there through the app's Users page instead.\n" +
      "  To override, re-run with ALLOW_PRODUCTION=1."
  );
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function main() {
  console.log(`\n  Supabase project : ${projectRef}`);
  console.log(`  Username         : ${username}`);
  console.log(`  Call Name        : ${callName || "(none — the full name is used)"}`);
  console.log(`  Role             : agent`);

  let teamLeadId = null;
  if (teamLeadUsername) {
    const { data, error } = await db
      .from("profiles")
      .select("id")
      .ilike("username", teamLeadUsername)
      .maybeSingle();
    if (error) fail(`reading team lead: ${error.message}`);
    if (!data) fail(`no account named ${teamLeadUsername} to be the team lead.`);
    teamLeadId = data.id;
    console.log(`  Team lead        : ${teamLeadUsername}`);
  }

  // Hashed with the same cost the application uses, so the login path verifies
  // it exactly as it would any other account.
  const password_hash = bcrypt.hashSync(password, 10);
  const must_change_password = process.env.MUST_CHANGE_PASSWORD === "1";

  const { data: existing, error: readErr } = await db
    .from("profiles")
    .select("id, username")
    .ilike("username", username)
    .maybeSingle();
  if (readErr) fail(`reading profiles: ${readErr.message}`);

  let agentId;
  if (existing) {
    agentId = existing.id;
    const { error } = await db
      .from("profiles")
      .update({
        full_name: fullName,
        call_name: callName || null,
        email,
        role: "agent",
        team_lead_id: teamLeadId,
        is_active: true,
        is_deleted: false,
        deleted_at: null,
        password_hash,
        must_change_password,
      })
      .eq("id", existing.id);
    if (error) fail(`updating agent: ${error.message}`);
    console.log(`\n  Existing account updated and password reset.`);
  } else {
    agentId = randomUUID();
    const { error } = await db.from("profiles").insert({
      id: agentId,
      username,
      full_name: fullName,
      email,
      role: "agent",
      team_lead_id: teamLeadId,
      call_name: callName || null,
      contact_number: null,
      is_active: true,
      password_hash,
      must_change_password,
      avatar_url: null,
      theme_preference: "light",
      permission_profile: null,
      last_login_at: null,
      is_deleted: false,
      deleted_at: null,
      created_at: new Date().toISOString(),
    });
    if (error) fail(`creating agent: ${error.message}`);
    console.log(`\n  Agent created.`);
  }

  // An agent's list shows only their own leads, so a brand new account opens on
  // an empty table — which looks like the page is broken rather than like the
  // account is new.
  if (claimLeads > 0) {
    const { data: leads, error: leadsErr } = await db
      .from("orders")
      .select("id")
      .neq("agent_id", agentId)
      .order("created_at", { ascending: false })
      .limit(claimLeads);
    if (leadsErr) fail(`reading leads: ${leadsErr.message}`);

    if (leads?.length) {
      // assigned_agent_email travels with agent_id: the two are read together
      // and an account whose email does not match its own leads loses access to
      // them.
      const { error } = await db
        .from("orders")
        .update({ agent_id: agentId, assigned_agent_email: email })
        .in(
          "id",
          leads.map((l) => l.id)
        );
      if (error) fail(`assigning leads: ${error.message}`);
      console.log(`  ${leads.length} lead(s) handed over to this agent.`);
    } else {
      console.log(`  No leads available to hand over.`);
    }
  }

  console.log("  The password was not printed and is stored only as a bcrypt hash.");
  console.log("  Note: an agent must Time In before a call can be started.\n");
}

main().catch((e) => fail(e.message));
