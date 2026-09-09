import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCurrentUser } from "@/lib/auth";
import { readDbLite } from "@/lib/db";
import { can, isFullAccess } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const BUCKET = "call-recordings";

// Long enough to start playing and to scrub through a long call, short enough
// that a copied address is useless by the time it is pasted anywhere.
const URL_TTL_SECONDS = 300;

/**
 * Hands back a short-lived address for one call's audio, to whoever is allowed
 * to hear it.
 *
 * The bucket is private and stays private. Nothing in the app renders a storage
 * URL; the page renders a link to this route, and the address is minted here,
 * per listener, per press of play. A recording is a customer's voice — the link
 * to it should not outlive the click that asked for it.
 *
 * Scoped the way the Calls page is: an agent hears their own calls, a Team Lead
 * their team's, an Administrator everyone's. Checked here rather than trusted
 * from the page, because a route is reachable without the page.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await readDbLite();
  if (!can(user.role, "orders", "view", db.role_permissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: call, error } = await supabaseAdmin
    .from("pbx_calls")
    .select("id, agent_id, recording_path")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!call?.recording_path) {
    return NextResponse.json({ error: "No recording for that call" }, { status: 404 });
  }

  // Who may hear it. A call with no agent — a line that never matched an
  // extension — is administrators only: there is nobody it belongs to, so
  // nobody but a full-access account has a claim on it.
  const owner = call.agent_id ? String(call.agent_id) : null;
  let allowed = isFullAccess(user.role);
  if (!allowed && owner) {
    if (owner === user.id) allowed = true;
    else if (user.role === "team_lead") {
      allowed = db.profiles.some((p) => p.id === owner && p.team_lead_id === user.id);
    }
  }
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: signed, error: signError } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(call.recording_path, URL_TTL_SECONDS);

  if (signError || !signed?.signedUrl) {
    console.error("[recordings] could not sign %s: %s", call.recording_path, signError?.message);
    return NextResponse.json({ error: "Could not open that recording" }, { status: 500 });
  }

  // A redirect rather than proxying the bytes: the audio goes straight from
  // storage to the browser, which keeps a twenty-minute call off a serverless
  // function that is measured in seconds.
  return NextResponse.redirect(signed.signedUrl, { status: 307 });
}
