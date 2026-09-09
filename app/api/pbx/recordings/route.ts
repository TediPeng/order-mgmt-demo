import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * Where the PBX hands over the audio of a call.
 *
 * The recording cannot be fetched: the PBX is reachable only over the tailnet
 * and this app runs on Vercel, so the only direction that works is the PBX
 * pushing — the same shape as /api/pbx/calls, and for the same reason.
 *
 * It could have uploaded to Supabase directly, and deliberately does not. That
 * would put a storage key on a machine in an office, alongside the one it
 * already holds, and it would tie the connector to where the audio happens to
 * live today. One secret on the PBX, one destination it knows about: this app.
 *
 * The bucket is private. Nothing here ever returns a URL — playback asks for a
 * short-lived signed one at the moment somebody presses play, so a link cannot
 * be forwarded, bookmarked, or left working in an old page.
 */

const BUCKET = "call-recordings";

// An hour of speech in mp3 is a few megabytes; fifty is a wide margin that
// still refuses anything that could only be a mistake or an attack.
const MAX_BYTES = 50 * 1024 * 1024;

const ALLOWED = new Map<string, string>([
  ["mp3", "audio/mpeg"],
  ["wav", "audio/wav"],
]);

function authorised(header: string | null): boolean {
  const expected = process.env.PBX_API_SECRET;
  if (!expected || expected.length < 32) {
    console.error("[pbx-recordings] PBX_API_SECRET missing or shorter than 32 characters; refusing every request.");
    return false;
  }
  if (!header?.startsWith("Bearer ")) return false;
  const provided = header.slice("Bearer ".length);
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"));
}

export async function POST(req: NextRequest) {
  if (!authorised(req.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const uniqueId = (req.nextUrl.searchParams.get("unique_id") || "").trim();
  const ext = (req.nextUrl.searchParams.get("ext") || "mp3").trim().toLowerCase();
  if (!uniqueId) {
    return NextResponse.json({ ok: false, error: "unique_id is required" }, { status: 400 });
  }
  const contentType = ALLOWED.get(ext);
  if (!contentType) {
    return NextResponse.json(
      { ok: false, error: `ext must be one of ${[...ALLOWED.keys()].join(", ")}` },
      { status: 400 }
    );
  }

  // The row must already exist. The connector sends the CDR first and the audio
  // afterwards, so a recording with no call is a bug on that side or a call
  // this app rejected — either way, storing the audio would leave a file that
  // nothing points at and nothing will ever delete.
  const { data: call, error: findError } = await supabaseAdmin
    .from("pbx_calls")
    .select("id, started_at, recording_path")
    .eq("pbx_unique_id", uniqueId)
    .maybeSingle();

  if (findError) {
    return NextResponse.json({ ok: false, error: findError.message }, { status: 500 });
  }
  if (!call) {
    return NextResponse.json({ ok: false, error: "No call with that unique_id" }, { status: 404 });
  }
  if (call.recording_path) {
    // Already have it. Answered as success so the connector marks it done and
    // stops offering it, rather than retrying the same file for ever.
    return NextResponse.json({ ok: true, already: true, path: call.recording_path });
  }

  const body = Buffer.from(await req.arrayBuffer());
  if (body.length === 0) {
    return NextResponse.json({ ok: false, error: "Empty body" }, { status: 400 });
  }
  if (body.length > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "Recording too large" }, { status: 413 });
  }

  // Foldered by date so the bucket stays navigable by hand and a retention
  // sweep can work on whole days rather than walking every object.
  const day = String(call.started_at).slice(0, 10).replace(/-/g, "/");
  const path = `${day}/${uniqueId}.${ext}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, body, { contentType, upsert: true });

  if (uploadError) {
    console.error("[pbx-recordings] upload failed for %s: %s", uniqueId, uploadError.message);
    return NextResponse.json({ ok: false, error: uploadError.message }, { status: 500 });
  }

  const { error: updateError } = await supabaseAdmin
    .from("pbx_calls")
    .update({
      recording_path: path,
      recording_bytes: body.length,
      recording_uploaded_at: new Date().toISOString(),
    })
    .eq("id", call.id);

  if (updateError) {
    // The object is stored but the row does not know. Say so rather than
    // reporting success: the connector will send it again, upsert will replace
    // the identical object, and the row gets its second chance.
    console.error("[pbx-recordings] stored %s but could not record it: %s", path, updateError.message);
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, path, bytes: body.length });
}
