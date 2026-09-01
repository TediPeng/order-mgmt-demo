import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

import { recordPbxCalls, type PbxCallInput } from "@/lib/pbx/ingest";

export const dynamic = "force-dynamic";

/**
 * Where the PBX tells ROMA what actually happened on a call.
 *
 * The connector on the Issabel box posts here after each hangup, or in a batch
 * when it is catching up after an outage. Nothing in ROMA reaches out to
 * Asterisk: this app runs on serverless functions that live for seconds and AMI
 * is a socket that has to stay open for days, so the push has to come from the
 * side that can hold it.
 *
 * Modelled on /api/portal/attendance, which solves the same problem between
 * ROMA and the company portal: a shared secret, a timing-safe comparison, and a
 * body that reports what it skipped instead of failing.
 */

const MAX_BATCH = 500;

function authorised(header: string | null): boolean {
  const expected = process.env.PBX_API_SECRET;

  // A short or missing secret refuses everything rather than defaulting open.
  // The connector runs unattended on a machine in an office; an endpoint that
  // accepted anything while nobody was looking would not announce itself.
  if (!expected || expected.length < 32) {
    console.error("[pbx-calls] PBX_API_SECRET missing or shorter than 32 characters; refusing every request.");
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }

  // One call or many. The connector sends one per hangup in normal running and
  // a batch when it has been offline, and having to know which shape to use is
  // a decision it should not have to make.
  const raw = Array.isArray(body) ? body : Array.isArray((body as { calls?: unknown }).calls)
    ? ((body as { calls: unknown[] }).calls)
    : [body];

  if (raw.length === 0) {
    return NextResponse.json({ ok: true, recorded: 0, results: [] });
  }
  if (raw.length > MAX_BATCH) {
    return NextResponse.json(
      { ok: false, error: `Too many calls in one request — ${MAX_BATCH} is the limit. Send the rest in another batch.` },
      { status: 413 }
    );
  }

  const results = await recordPbxCalls(raw as PbxCallInput[]);
  const recorded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  if (failed.length > 0) {
    console.error("[pbx-calls] %d of %d rejected: %s", failed.length, results.length,
      failed.map((f) => `${f.unique_id}:${f.error}`).join("; "));
  }

  // 200 even with rejections, and the per-call verdict in the body.
  //
  // The connector is retrying from a list it holds. A blanket failure would
  // make it resend the calls that worked, forever, alongside the one it can
  // never fix — so it is told exactly which uniqueids landed.
  return NextResponse.json({
    ok: true,
    recorded,
    rejected: failed.length,
    // Worth reporting: a call with no agent means an extension nobody has
    // claimed in Users, and unmatched means the agent dialled without pressing
    // Calling. Both are the point of collecting this.
    unmatched_agent: results.filter((r) => r.ok && r.agent_matched === false).length,
    unmatched_session: results.filter((r) => r.ok && r.session_matched === false).length,
    results,
  });
}
