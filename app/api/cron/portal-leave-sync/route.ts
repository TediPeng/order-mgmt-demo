import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { uuid, nowIso } from "@/lib/db";
import { fetchLeaveDecisions, fileLeaveInPortal, portalOwnsLeave } from "@/lib/portal-leave";
import { todayInTz } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Bringing back what the company portal decided about leave filed here.
 *
 * Leave is filed in ROMA and decided in the portal, because the daily limit,
 * the automatic refusal of everybody whose last free day was taken, and the
 * roster write that stops payroll counting the day as unworked all live there.
 * This is the return leg: without it an agent would file here, be granted
 * there, and see nothing but "pending" on the screen they actually use.
 *
 * Pulled, not pushed. A push would have to be remembered inside the portal's
 * decision path and would be lost whenever it could not reach us at that
 * moment; asking again costs one request and cannot miss anything.
 */

/** A ceiling against a fault, not a page size. Nineteen people cannot have more open. */
const MAX_PER_RUN = 200;

/** The portal's own words for a decision, in ROMA's. */
const STATUS: Record<string, "approved" | "rejected" | "cancelled"> = {
  approved: "approved",
  rejected: "rejected",
  cancelled: "cancelled",
};

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Nothing to bring back while ROMA is still deciding its own.
  if (!portalOwnsLeave()) {
    return NextResponse.json({ ok: true, skipped: "portal does not own leave" });
  }

  // First, anything that never got there. The filing screen promises an agent
  // that a request the portal could not accept at the time will be sent again
  // on its own -- this is the part that makes that true rather than reassuring.
  //
  // Bounded to leave that has not already ended: a request still pending here
  // from before the bridge existed is history, and opening it in the portal now
  // would ask a supervisor to decide a day that has already passed.
  const today = todayInTz();
  let filed = 0;
  const { data: unsent, error: unsentError } = await supabaseAdmin
    .from("leave_requests")
    .select("id, agent_id, leave_type, leave_start, leave_end, reason")
    .eq("status", "pending")
    .is("portal_request_id", null)
    .gte("leave_end", today)
    .limit(MAX_PER_RUN);

  if (unsentError) {
    console.error("[portal-leave-sync] unsent read failed: %s", unsentError.message);
  } else {
    // Logged every run, even when it is zero.
    //
    // Three filings sat unsent for an hour while this swept seven others past
    // them, and the logs could not settle whether they were being tried and
    // refused or never selected at all -- because the only thing recorded was
    // what happened AFTER the choice. The size of the list is the one fact that
    // separates a broken query from a broken request, and it was the one fact
    // missing.
    // Named, not counted.
    //
    // A count said seven while the database said three, and no amount of
    // re-reading either could settle which was lying. Numbers agree with too
    // many stories; identifiers agree with one. The window is at most a handful
    // of rows, so printing them costs nothing and ends the argument.
    console.log(
      "[portal-leave-sync] to carry (today=%s): %s",
      today,
      (unsent || []).map((r) => `${r.id.slice(0, 8)}:${r.leave_end}`).join(" ") || "none"
    );
    for (const row of unsent || []) {
      const result = await fileLeaveInPortal({
        romaProfileId: String(row.agent_id),
        leaveType: String(row.leave_type),
        startDate: String(row.leave_start),
        endDate: String(row.leave_end),
        reason: String(row.reason),
      });
      if (result.status !== "ok") {
        console.log("[portal-leave-sync] %s not carried: %s", row.id.slice(0, 8), result.status);
        continue;
      }

      const { error: linkError } = await supabaseAdmin
        .from("leave_requests")
        .update({ portal_request_id: result.requestId })
        .eq("id", row.id);
      if (linkError) {
        console.error("[portal-leave-sync] link not stored for %s: %s", row.id, linkError.message);
        continue;
      }
      filed += 1;
    }
  }

  const { data: open, error } = await supabaseAdmin
    .from("leave_requests")
    .select("id, agent_id, portal_request_id, leave_start, leave_end")
    .eq("status", "pending")
    .not("portal_request_id", "is", null)
    .limit(MAX_PER_RUN);

  if (error) {
    console.error("[portal-leave-sync] read failed: %s", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = open || [];
  if (rows.length === 0) return NextResponse.json({ ok: true, filed, checked: 0, applied: 0 });

  const decisions = await fetchLeaveDecisions(rows.map((r) => String(r.portal_request_id)));

  // Null is "no answer". An empty list would mean every request is still
  // pending, and writing that conclusion into the screen agents read would be
  // telling them nothing has been decided when it has.
  if (!decisions) {
    return NextResponse.json({ ok: false, error: "portal unavailable" }, { status: 503 });
  }

  const byId = new Map(decisions.map((d) => [d.id, d]));
  let applied = 0;

  for (const row of rows) {
    const decision = byId.get(String(row.portal_request_id));
    const status = decision ? STATUS[String(decision.status)] : undefined;
    if (!status) continue; // still pending there, or a status ROMA has no word for

    const at = decision!.decidedAt || nowIso();
    const { error: updateError } = await supabaseAdmin
      .from("leave_requests")
      .update({
        status,
        reviewed_at: at,
        // Whose hand it was stays in the portal: reviewed_by holds a ROMA
        // profile id and the decider may not have one. Naming the application
        // is honest; inventing an id would not be.
        management_remarks: decision!.note
          ? `Decided in the company portal: ${decision!.note}`
          : "Decided in the company portal.",
        updated_at: nowIso(),
      })
      .eq("id", row.id)
      .eq("status", "pending");

    if (updateError) {
      console.error("[portal-leave-sync] update failed for %s: %s", row.id, updateError.message);
      continue;
    }

    applied += 1;

    const { error: notifyError } = await supabaseAdmin.from("notifications").insert({
      id: uuid(),
      recipient_id: row.agent_id,
      type: "leave_status",
      title: status === "approved" ? "Leave Approved" : "Leave Request Decided",
      body: `Your leave for ${row.leave_start} to ${row.leave_end} was ${status}.`,
      link: "/leave",
      is_read: false,
      created_at: nowIso(),
    });
    if (notifyError) console.error("[portal-leave-sync] notify failed: %s", notifyError.message);
  }

  console.log("[portal-leave-sync] filed %d, applied %d decision(s) of %d open", filed, applied, rows.length);
  return NextResponse.json({ ok: true, filed, checked: rows.length, applied });
}
