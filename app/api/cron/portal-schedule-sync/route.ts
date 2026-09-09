import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { todayInTz } from "@/lib/utils";
import { statusOf } from "@/lib/duty-status";
import {
  fetchPortalRoster,
  pushPortalRoster,
  portalOwnsRosterSync,
  shiftCodeFor,
  type RosterDay,
} from "@/lib/portal-schedule";

export const dynamic = "force-dynamic";

/**
 * Carrying the roster built here to the company portal.
 *
 * The portal's scheduled_window prices the day, and since the clock moved back
 * to ROMA it also decides whether the clock opens: a day its roster calls a
 * rest day is a day clock_in_for refuses. So a Saturday given off on ROMA's
 * grid and unknown there is not a counting error — it is somebody standing at a
 * screen that will not let them start work.
 *
 * A comparison, not a queue. The roster is written from six places here — the
 * grid, the roster builder, the spreadsheet import, bulk assign, copy week, and
 * the suspension form — and hooking each of them would be six chances to forget
 * one. Asking the portal what it currently holds and sending only what differs
 * cannot miss a door, and it repairs whatever an earlier failure left behind.
 */

/**
 * How far ahead to keep the two in step.
 *
 * A fortnight is longer than any roster is published in advance here and short
 * enough that the comparison stays small — about 250 days across seventeen
 * people. The past is deliberately left alone: a day that has already happened
 * is answered by the attendance record, and rewriting its roster now would
 * re-price a day that has already been worked.
 */
const DAYS_AHEAD = 14;

/** A ceiling against a fault, matching what the portal will accept in one request. */
const MAX_DAYS = 400;

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!portalOwnsRosterSync()) {
    return NextResponse.json({ ok: true, skipped: "roster sync is off" });
  }

  const from = todayInTz();
  const to = addDays(from, DAYS_AHEAD);

  const { data: rows, error } = await supabaseAdmin
    .from("schedules")
    .select("agent_id, schedule_date, is_rest_day, status, remarks, suspension_id")
    .gte("schedule_date", from)
    .lte("schedule_date", to)
    // Nearest days first. If the ceiling below ever truncates, what it drops is
    // the far end of the fortnight rather than tomorrow morning.
    .order("schedule_date", { ascending: true })
    .limit(MAX_DAYS);

  if (error) {
    console.error("[portal-schedule-sync] read failed: %s", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const theirs = await fetchPortalRoster(from, to);

  // No answer is not an empty roster. Sending every day in the window on the
  // strength of a failed read is the one way this could do harm.
  if (!theirs) {
    return NextResponse.json({ ok: false, error: "portal unavailable", from, to }, { status: 503 });
  }

  const changes: RosterDay[] = [];
  let skipped = 0;

  for (const row of rows || []) {
    // statusOf is the one place ROMA's five duty statuses are read off a row,
    // shared with the grid and the spreadsheet import. Reading the columns
    // again here is how a status set in a spreadsheet and one set in the grid
    // would start to mean different things.
    const code = shiftCodeFor(statusOf(row));
    if (!code) {
      // On leave and suspended, both deliberately not ours to send — see
      // lib/portal-schedule.ts.
      skipped += 1;
      continue;
    }

    const key = `${row.agent_id}|${row.schedule_date}`;
    if (theirs.get(key) === code) continue; // already agrees

    changes.push({ romaProfileId: String(row.agent_id), date: String(row.schedule_date), shiftCode: code });
  }

  if (changes.length === 0) {
    return NextResponse.json({ ok: true, from, to, checked: (rows || []).length, sent: 0, skipped });
  }

  const results = await pushPortalRoster(changes);
  if (!results) {
    return NextResponse.json({ ok: false, error: "portal unavailable", from, to }, { status: 503 });
  }

  const applied = results.filter((r) => r.status === "ok").length;
  const refused = results.filter((r) => r.status === "refused");
  const notLinked = results.filter((r) => r.status === "not_linked").length;

  // Refusals are the portal's own answers — approved leave that may not be
  // written over, or a shift the department does not offer. Logged in its
  // words rather than retried: nothing here can make them succeed.
  for (const refusal of refused.slice(0, 10)) {
    console.warn("[portal-schedule-sync] %s refused for %s: %s", refusal.date, refusal.romaProfileId, refusal.reason);
  }

  console.log(
    "[portal-schedule-sync] %s..%s sent %d, applied %d, refused %d, unlinked %d",
    from, to, changes.length, applied, refused.length, notLinked
  );

  return NextResponse.json({
    ok: true,
    from,
    to,
    checked: (rows || []).length,
    sent: changes.length,
    applied,
    refused: refused.length,
    notLinked,
    skipped,
  });
}
