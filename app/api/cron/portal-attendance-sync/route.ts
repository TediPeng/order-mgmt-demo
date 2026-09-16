import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { todayInTz } from "@/lib/utils";
import { fetchPortalAttendance } from "@/lib/portal-attendance";
import { mirrorToPortal } from "@/lib/portal-mirror";
import { addDaysToYmd } from "@/lib/schedule-access";

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

/**
 * How far back to look.
 *
 * This used to be today and nothing else, and it had to be: the mirror sent no
 * instant, so the portal stamped the moment the message arrived, and asking it
 * about yesterday would have clocked the person in this morning. A day that
 * ended with something unsent was therefore lost for good -- eleven time-ins
 * were, between 1 and 16 September, one of them a whole shift for four people
 * on the 9th.
 *
 * Since the portal takes the instant (its migration 176) the day is decided by
 * the tap rather than by the clock on the wall, so a sweep can reach back. Three
 * days covers a weekend outage and a failure at midnight, and stays well inside
 * the fortnight the portal will accept -- which is itself shorter than a
 * settled cut-off, so this can never quietly rewrite a payroll already approved.
 */
const DAYS_BACK = 2;

export async function GET(req: NextRequest) {
  // The same check as every other cron here: one secret, one way of testing it.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const today = todayInTz();

  // Oldest first. A break has to reach the portal after the time in it sits
  // inside, and within a day the order below already guarantees that; across
  // days it costs nothing and keeps the log readable.
  const dates: string[] = [];
  for (let back = DAYS_BACK; back >= 0; back -= 1) dates.push(addDaysToYmd(today, -back));

  let sentIn = 0;
  let sentOut = 0;
  let sentBreakStart = 0;
  let sentBreakEnd = 0;
  let refused = 0;
  let failed = 0;

  // One ceiling across every day, not one per day. The point of the limit is
  // that a fault cannot turn this into thousands of requests, and three days
  // of it would be three times the fault.
  let budget = MAX_PER_RUN;
  const unreachable: string[] = [];

  for (const date of dates) {
    if (budget <= 0) break;

    const { data: rows, error } = await supabaseAdmin
      .from("attendance")
      .select("user_id, time_in, time_out, break_start, break_end")
      .eq("work_date", date)
      .not("time_in", "is", null)
      .limit(budget);

    if (error) {
      console.error("[portal-sync] attendance read failed for %s: %s", date, error.message);
      return NextResponse.json({ ok: false, error: error.message, date }, { status: 500 });
    }

    const portal = await fetchPortalAttendance(date);

    // Null is "no answer", which is not "nobody has timed in". Sending every
    // time-in again on the strength of a failed read would be the one way this
    // could do harm, so this day is left alone and the next run tries again.
    if (!portal) {
      unreachable.push(date);
      continue;
    }

    for (const row of rows || []) {
      const profileId = String(row.user_id);
      budget -= 1;

      // Absent from the portal's answer means nobody there is linked to this
      // account. Not something to retry every ten minutes for ever: an
      // administrator has to link them before their hours can ever land.
      if (!portal.has(profileId)) continue;

      const theirs = portal.get(profileId) ?? null;

      // Every call carries the instant this database recorded, so the portal
      // writes the time the tap happened and files it under the day it
      // belongs to -- rather than stamping the moment this request arrives,
      // which is what made a swept time-in look late and made yesterday
      // unreachable.
      if (!theirs?.timeIn) {
        const result = await mirrorToPortal(profileId, "time_in", row.time_in);
        if (result.status === "ok") sentIn += 1;
        else if (result.status === "refused") refused += 1;
        else if (result.status === "unsent") failed += 1;

        // A day the portal will not open cannot be closed either, and asking
        // would only produce a second confusing refusal in the log.
        if (result.status === "refused" || result.status === "unsent") continue;
      }

      // The break, before the time-out below. A break belongs inside the shift
      // and the portal refuses to start one on a row it has already closed, so
      // sweeping them in the order they happened is the only order that works.
      if (row.break_start && !theirs?.breakStart) {
        const result = await mirrorToPortal(profileId, "break_start", row.break_start);
        if (result.status === "ok") sentBreakStart += 1;
        else if (result.status === "refused") refused += 1;
        else if (result.status === "unsent") failed += 1;

        if (result.status === "refused" || result.status === "unsent") continue;
      }

      // Only once the portal has the start. It works out its own over break
      // from the two taps, so an end with no start would be measured from
      // nothing.
      if (row.break_end && !theirs?.breakEnd) {
        const result = await mirrorToPortal(profileId, "break_end", row.break_end);
        if (result.status === "ok") sentBreakEnd += 1;
        else if (result.status === "refused") refused += 1;
        else if (result.status === "unsent") failed += 1;
      }

      if (row.time_out && !theirs?.timeOut) {
        const result = await mirrorToPortal(profileId, "time_out", row.time_out);
        if (result.status === "ok") sentOut += 1;
        else if (result.status === "refused") refused += 1;
        else if (result.status === "unsent") failed += 1;
      }
    }
  }

  // Only when nothing could be read at all. One unreachable day out of three
  // is a retry; three out of three is the portal being down, and the caller
  // should hear about that as a failure rather than as a quiet success.
  if (unreachable.length === dates.length) {
    return NextResponse.json(
      { ok: false, error: "portal unavailable", dates: unreachable },
      { status: 503 }
    );
  }

  if (sentIn || sentOut || sentBreakStart || sentBreakEnd || refused || failed || unreachable.length) {
    console.log(
      "[portal-sync] %s..%s: sent %d time-in, %d time-out, %d break-start, %d break-end, %d refused, %d failed%s",
      dates[0], dates[dates.length - 1],
      sentIn, sentOut, sentBreakStart, sentBreakEnd, refused, failed,
      unreachable.length ? `, unreachable ${unreachable.join(",")}` : ""
    );
  }

  return NextResponse.json({
    ok: true,
    dates,
    sentIn,
    sentOut,
    sentBreakStart,
    sentBreakEnd,
    refused,
    failed,
    unreachable,
  });
}
