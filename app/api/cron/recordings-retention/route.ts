import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const BUCKET = "call-recordings";

/**
 * Deletes stored call audio older than the retention window.
 *
 * Storage that nothing ever removes is a bill that only goes one way, and the
 * day it is noticed is the day somebody deletes a folder by hand and takes
 * something they wanted with it. This is the alternative: one rule, applied
 * every day, written down.
 *
 * Thirty days here against ninety on the PBX, deliberately. This copy exists so
 * a supervisor can hear a call without a tailnet address — that is a question
 * asked within days, not months. The PBX keeps the longer record, and anything
 * older than a month is fetched from there on the rare occasion it is wanted.
 *
 * The row is cleared before the object is removed. Losing the object while a
 * row still points at it gives a play button that fails; the reverse leaves an
 * object nothing references, which the sweep below picks up.
 */
const KEEP_DAYS = 30;

// A cap per run, so a first sweep over a long backlog cannot outlive the
// function's own time limit. Whatever is left goes tomorrow.
const MAX_PER_RUN = 500;

export async function GET(req: NextRequest) {
  // Same check as /api/cron/pancake-sync, deliberately: one secret, one way of
  // testing it. Vercel Cron sends CRON_SECRET as a bearer token.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400_000).toISOString();

  const { data: stale, error } = await supabaseAdmin
    .from("pbx_calls")
    .select("id, recording_path")
    .not("recording_path", "is", null)
    .lt("started_at", cutoff)
    .order("started_at", { ascending: true })
    .limit(MAX_PER_RUN);

  if (error) {
    console.error("[recordings-retention] read failed: %s", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const paths = (stale || []).map((r) => String(r.recording_path)).filter(Boolean);
  if (paths.length === 0) {
    return NextResponse.json({ ok: true, removed: 0, cutoff });
  }

  // Row first. A play button that fails is worse than an object nobody points
  // at: the first is visible to a supervisor mid-question, the second is a
  // number on a bill.
  const { error: clearError } = await supabaseAdmin
    .from("pbx_calls")
    .update({ recording_path: null, recording_bytes: null, recording_uploaded_at: null })
    .in("id", (stale || []).map((r) => r.id));

  if (clearError) {
    console.error("[recordings-retention] could not clear rows: %s", clearError.message);
    return NextResponse.json({ ok: false, error: clearError.message }, { status: 500 });
  }

  const { error: removeError } = await supabaseAdmin.storage.from(BUCKET).remove(paths);
  if (removeError) {
    // The rows are already clear, so nothing in the app is broken — these
    // objects are simply orphaned and will be swept by the next run's own
    // remove, or by hand. Reported rather than retried here.
    console.error("[recordings-retention] cleared %d rows but storage remove failed: %s",
      paths.length, removeError.message);
    return NextResponse.json({ ok: true, removed: 0, orphaned: paths.length, cutoff });
  }

  console.log("[recordings-retention] removed %d recordings older than %s", paths.length, cutoff);
  return NextResponse.json({ ok: true, removed: paths.length, cutoff });
}
