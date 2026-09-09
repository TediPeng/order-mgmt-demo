import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * What the PBX is doing right now.
 *
 * A whole snapshot every few seconds, not a stream of events. Events are
 * cheaper on the wire and far more expensive to be wrong about: one missed
 * hangup and an agent is on a call for ever, and nothing in the picture ever
 * corrects it. A snapshot cannot drift — the next one is simply the truth
 * again, and a sender that dies leaves a picture that visibly ages instead of
 * one that quietly lies.
 *
 * The CDR is still what gets recorded; this row is never counted. It exists so
 * the monitor can say who is on the phone this second, which the CDR cannot:
 * Asterisk writes that at hangup, when the answer no longer matters.
 */

interface LiveChannel {
  /** The extension the channel belongs to, matched against profiles.sip_extension. */
  extension: string;
  /** ringing | up — what the channel is doing, in Asterisk's own words. */
  state: string;
  /** The number being called, when the channel is an outbound one. */
  dialed: string | null;
  /** Seconds since the channel began. */
  seconds: number;
}

// A floor of seventeen agents and sixteen SIM lines cannot legitimately produce
// hundreds of channels; a payload that size is a fault or an attack.
const MAX_CHANNELS = 200;

function authorised(header: string | null): boolean {
  const expected = process.env.PBX_API_SECRET;
  if (!expected || expected.length < 32) {
    console.error("[pbx-channels] PBX_API_SECRET missing or shorter than 32 characters; refusing every request.");
    return false;
  }
  if (!header?.startsWith("Bearer ")) return false;
  const provided = header.slice("Bearer ".length);
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"));
}

function clean(raw: unknown): LiveChannel[] {
  if (!Array.isArray(raw)) return [];
  const out: LiveChannel[] = [];
  for (const item of raw.slice(0, MAX_CHANNELS)) {
    const r = (item || {}) as Record<string, unknown>;
    const extension = String(r.extension ?? "").trim();
    // A channel with no extension belongs to nobody this app knows about — a
    // trunk leg, or a line that never matched. Kept out rather than stored as
    // an empty key nothing can ever join to.
    if (!extension) continue;
    out.push({
      extension,
      state: String(r.state ?? "").trim().toLowerCase() || "unknown",
      dialed: r.dialed ? String(r.dialed).trim() : null,
      seconds: Math.max(0, Math.round(Number(r.seconds ?? 0)) || 0),
    });
  }
  return out;
}

export async function POST(req: NextRequest) {
  if (!authorised(req.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }

  const channels = clean((body as { channels?: unknown })?.channels ?? body);

  // Replaced wholesale, always — including with an empty list. "Nobody is on a
  // call" is an answer and has to be able to arrive; if only non-empty
  // snapshots were stored, the last busy moment of the day would stay on the
  // board until the next morning.
  const { error } = await supabaseAdmin
    .from("pbx_live_state")
    .update({ channels, updated_at: new Date().toISOString() })
    .eq("id", 1);

  if (error) {
    console.error("[pbx-channels] write failed: %s", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, channels: channels.length });
}
