import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { todayInTz } from "@/lib/utils";
import { fetchPortalAttendance } from "@/lib/portal-attendance";
import { mirrorToPortal } from "@/lib/portal-mirror";

export const dynamic = "force-dynamic";

/**
 * Carrying to the portal anything the clock could not send at the time.
 *
 * The clock is back on ROMA and the portal is still what pays, so every time in
 * has to cross. lib/portal-mirror.ts sends it at the moment it happens and
 * waits for the answer — but a request can time out, a deploy can land
 * mid-click, and the other application can be briefly down. None of those may
 * cost somebody a day's pay.
 *
 * So this asks the only question that settles it: what does ROMA have for today
 * that the portal does not? Compared rather than queued. A queue can be wrong —
 * an entry written and never cleared, or cleared and never sent — and the
 * comparison cannot: both sides are read fresh, and if they already agree there
 * is nothing to do.
 *
 * Idempotent by construction. The portal answers `already_timed_in` to anything
 * it holds, so a run that overlaps the live mirror costs one HTTP round trip
 * and changes nothing.
 */

/** A floor of nineteen people. This is a ceiling against a fault, not a workload. */
const MAX_PER_RUN = 60;

export async function GET(req: NextRequest) {
  // The same check as every other cron here: one secret, one way of testing it.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const today = todayInTz();

  const { data: rows, error } = await supabaseAdmin
    .from("attendance")
    .select("user_id, time_in, time_out")
    .eq("work_date", today)
    .not("time_in", "is", null)
    .limit(MAX_PER_RUN);

  if (error) {
    console.error("[portal-sync] attendance read failed: %s", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const portal = await fetchPortalAttendance(today);

  // Null is "no answer", which is not "nobody has timed in". Sending every
  // time-in again on the strength of a failed read would be the one way this
  // could do harm, so it does nothing and waits for the next run.
  if (!portal) {
    return NextResponse.json({ ok: false, error: "portal unavailable", date: today }, { status: 503 });
  }

  let sentIn = 0;
  let sentOut = 0;
  let refused = 0;
  let failed = 0;

  for (const row of rows || []) {
    const profileId = String(row.user_id);

    // Absent from the portal's answer means nobody there is linked to this
    // account. Not something to retry every ten minutes for ever: an
    // administrator has to link them before their hours can ever land.
    if (!portal.has(profileId)) continue;

    const theirs = portal.get(profileId) ?? null;

    if (!theirs?.timeIn) {
      const result = await mirrorToPortal(profileId, "time_in");
      if (result.status === "ok") sentIn += 1;
      else if (result.status === "refused") refused += 1;
      else if (result.status === "unsent") failed += 1;

      // A day the portal will not open cannot be closed either, and asking
      // would only produce a second confusing refusal in the log.
      if (result.status === "refused" || result.status === "unsent") continue;
    }

    // Only after the time-in is known to be there. The portal closes the row it
    // has; if it never opened one, this would fail for a reason that says
    // nothing about the real problem.
    if (row.time_out && !theirs?.timeOut) {
      const result = await mirrorToPortal(profileId, "time_out");
      if (result.status === "ok") sentOut += 1;
      else if (result.status === "refused") refused += 1;
      else if (result.status === "unsent") failed += 1;
    }
  }

  if (sentIn || sentOut || refused || failed) {
    console.log(
      "[portal-sync] %s: sent %d time-in, %d time-out, %d refused, %d failed",
      today, sentIn, sentOut, refused, failed
    );
  }

  return NextResponse.json({ ok: true, date: today, sentIn, sentOut, refused, failed });
}
