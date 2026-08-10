import { NextRequest, NextResponse } from "next/server";
import { runPancakeSync } from "@/lib/pancake/sweep";

export const dynamic = "force-dynamic";
// Pro allows 300s. A sweep that has a queue to work through should finish it
// rather than be cut off half way and leave orders mid-retry.
export const maxDuration = 300;

/** Scheduled runner for the Pancake retry queue + polling fallback (see
 * vercel.json). The same work also runs lazily from the authenticated layout,
 * so the integration does not depend on this cron's frequency — this is the
 * safety net that keeps things moving when nobody is using the app.
 * Protected by CRON_SECRET (Vercel Cron sends it as a Bearer token). */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const summary = await runPancakeSync();
  return NextResponse.json({ ok: true, ...summary });
}
