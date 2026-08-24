import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { v4 as uuid } from "uuid";

import { readDbLite } from "@/lib/db";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { todayInTz } from "@/lib/utils";
import { activeSuspensionOn } from "@/lib/schedule-access";
import { agentEventRecipients } from "@/lib/notifications";
import { computeMinutesLate, computeOvertimeHours } from "@/lib/attendance-logic";

export const dynamic = "force-dynamic";

const nowIso = () => new Date().toISOString();

/**
 * The company portal telling us somebody clocked on or off.
 *
 * Retention agents time in on the portal now, because that is what pays them.
 * ROMA still needs the same fact: the monitor board, the timesheet, the
 * activity report and every export read this database and would otherwise see
 * an empty floor.
 *
 * So the portal mirrors the event here and ROMA writes its own row, by its own
 * rules. That last part is the whole point of doing this over HTTP rather than
 * letting the portal write into this database directly: lateness depends on the
 * agent's duty schedule with a fallback to the global work schedule, a
 * suspension pre-creates a row, and a late arrival notifies the team lead.
 * Those rules live here. A copy of them in the portal would be a second copy to
 * keep in step, and it would drift the first time one was changed.
 *
 * Best-effort from the caller's side. The portal must never fail somebody's
 * time-in because this was unreachable -- the portal's record is the one that
 * pays them, and this is the mirror.
 *
 * Idempotent on purpose. A retry after a timeout must not produce a second row
 * or a second notification, so an event that has already happened answers ok
 * with what it skipped rather than an error.
 */

type Event = "time_in" | "time_out";

function authorised(header: string | null): boolean {
  const expected = process.env.PORTAL_API_SECRET;

  if (!expected || expected.length < 32) {
    console.error("[portal-attendance] PORTAL_API_SECRET missing or too short; refusing every request.");
    return false;
  }
  if (!header?.startsWith("Bearer ")) return false;

  const provided = header.slice("Bearer ".length);
  if (provided.length !== expected.length) return false;

  return crypto.timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"));
}

export async function POST(req: NextRequest) {
  if (!authorised(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { romaProfileId?: string; event?: Event };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const profileId = String(body.romaProfileId || "");
  const event = body.event;

  if (!profileId) return NextResponse.json({ error: "romaProfileId is required" }, { status: 400 });
  if (event !== "time_in" && event !== "time_out") {
    return NextResponse.json({ error: "event must be time_in or time_out" }, { status: 400 });
  }

  const db = await readDbLite();
  const agent = db.profiles.find((p) => p.id === profileId);

  // Not an error the portal can do anything about, and not something to retry:
  // whoever it is linked to is not somebody ROMA will accept.
  if (!agent || agent.is_deleted || !agent.is_active) {
    return NextResponse.json({ ok: true, skipped: "no_such_agent" });
  }

  const today = todayInTz();
  const existing = db.attendance.find((a) => a.user_id === profileId && a.work_date === today);
  const info = { ip_address: null as string | null, device_info: "company-portal" };

  /** Written straight in rather than through writeDb, which rewrites whole tables. */
  async function log(action: string, entityId: string | null, details: Record<string, unknown>) {
    const { error } = await supabaseAdmin.from("activity_log").insert({
      id: uuid(),
      user_id: profileId,
      user_email: agent!.email,
      action,
      entity_type: "attendance",
      entity_id: entityId,
      details,
      module: "attendance",
      previous_value: null,
      updated_value: null,
      ip_address: info.ip_address,
      device_info: info.device_info,
      created_at: nowIso(),
    });
    if (error) console.error("[portal-attendance] activity log failed: %s", error.message);
  }

  if (event === "time_in") {
    // A suspension pre-creates a row with status 'suspended' and no time_in, so
    // this is asked before the "already timed in" check below, exactly as
    // timeInAction does -- otherwise a suspended agent gets the wrong answer.
    if (activeSuspensionOn(db, profileId, today, today)) {
      return NextResponse.json({ ok: true, skipped: "suspended" });
    }

    if (existing?.time_in) {
      return NextResponse.json({ ok: true, skipped: "already_timed_in" });
    }

    const at = nowIso();
    const todaysSchedule = db.schedules.find(
      (s) => s.agent_id === profileId && s.schedule_date === today
    );
    const scheduledIn = todaysSchedule?.duty_start || db.work_schedule.work_start;
    const scheduledOut = todaysSchedule?.duty_end || db.work_schedule.work_end;
    const minutesLate = computeMinutesLate(at, today, scheduledIn, db.work_schedule.timezone);
    const status = minutesLate > 0 ? "late" : "on_time";

    // A suspension row may already exist for the day with no time_in; that is an
    // update, not a second row. onConflict keeps one row per agent per day
    // whichever way it got there.
    const row = {
      id: existing?.id ?? uuid(),
      user_id: profileId,
      work_date: today,
      time_in: at,
      scheduled_time_in: scheduledIn,
      scheduled_time_out: scheduledOut,
      minutes_late: minutesLate,
      status,
      updated_at: at,
    };

    const { error } = await supabaseAdmin
      .from("attendance")
      .upsert(row, { onConflict: "user_id,work_date" });

    if (error) {
      console.error("[portal-attendance] time_in write failed: %s", error.message);
      return NextResponse.json({ error: "Could not record the time in" }, { status: 503 });
    }

    await log("TIME_IN", row.id, { work_date: today, minutes_late: minutesLate, source: "company-portal" });

    if (minutesLate > 0) {
      await log("LATE_FLAGGED", row.id, { minutes_late: minutesLate, source: "company-portal" });

      // The team lead is told the same way they would be if the agent had timed
      // in here. Leaving this out would make lateness invisible to exactly the
      // people whose job it is to see it.
      const recipients = agentEventRecipients(db, profileId);
      const { error: notifyError } = await supabaseAdmin.from("notifications").insert(
        recipients.map((recipient_id) => ({
          id: uuid(),
          recipient_id,
          type: "late_time_in",
          title: "Late Time-In",
          body: `${agent.full_name} timed in ${minutesLate} minute(s) late.`,
          link: "/attendance/clock",
          is_read: false,
          created_at: nowIso(),
        }))
      );
      if (notifyError) console.error("[portal-attendance] notify failed: %s", notifyError.message);
    }

    return NextResponse.json({ ok: true, event, minutesLate, status });
  }

  // time_out
  if (!existing?.time_in) return NextResponse.json({ ok: true, skipped: "not_timed_in" });
  if (existing.time_out) return NextResponse.json({ ok: true, skipped: "already_timed_out" });

  const at = new Date();
  const timeIn = new Date(existing.time_in);
  if (at.getTime() < timeIn.getTime()) {
    return NextResponse.json({ ok: true, skipped: "time_out_before_time_in" });
  }

  const totalHours = Math.round(((at.getTime() - timeIn.getTime()) / 3600000) * 100) / 100;
  const timeOutIso = at.toISOString();

  const { error } = await supabaseAdmin
    .from("attendance")
    .update({
      time_out: timeOutIso,
      total_hours: totalHours,
      overtime_hours: computeOvertimeHours(
        timeOutIso,
        today,
        existing.scheduled_time_out,
        db.work_schedule.timezone
      ),
      status: "timed_out",
      updated_at: timeOutIso,
    })
    .eq("id", existing.id);

  if (error) {
    console.error("[portal-attendance] time_out write failed: %s", error.message);
    return NextResponse.json({ error: "Could not record the time out" }, { status: 503 });
  }

  await log("TIME_OUT", existing.id, { work_date: today, total_hours: totalHours, source: "company-portal" });

  return NextResponse.json({ ok: true, event, totalHours });
}
