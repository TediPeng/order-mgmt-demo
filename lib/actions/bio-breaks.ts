"use server";

import { redirect } from "next/navigation";
import { requireUserLite } from "./guards";
import { startBioBreak, endBioBreak } from "@/lib/bio-breaks";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { writeDb } from "@/lib/db";
import { todayInTz } from "@/lib/utils";

/** Only ever redirect somewhere inside this app — same guard as the attendance
 * actions, kept local because a "use server" module may export nothing but
 * async functions. */
function safeRedirectTarget(raw: FormDataEntryValue | null): string {
  const value = String(raw || "");
  return value.startsWith("/") ? value : "/attendance/clock";
}

/** Bio breaks are unlimited by policy — the point is to measure them, not to
 * ration them — so there is no allowance check here. Both ends are still
 * audit-logged, because the monitor's totals are only worth anything if every
 * start and stop is attributable. */

export async function startBioBreakAction(formData: FormData) {
  const { user, db } = await requireUserLite();
  const target = safeRedirectTarget(formData.get("redirect_to"));
  const today = todayInTz();

  // The same gate the main break uses: nothing can start before the day has.
  const record = db.attendance.find((a) => a.user_id === user.id && a.work_date === today);
  if (!record || !record.time_in) {
    redirect(`${target}?error=${encodeURIComponent("You must time in before starting a bio break.")}`);
  }
  if (record!.time_out) {
    redirect(`${target}?error=${encodeURIComponent("You cannot start a bio break after timing out.")}`);
  }

  const result = await startBioBreak(user.id, today);
  if (!result.ok) {
    redirect(`${target}?error=${encodeURIComponent(result.message)}`);
  }

  const info = await getRequestInfo();
  logActivity(db, user.id, "BIO_BREAK_START", "attendance", result.bioBreak.id, { work_date: today }, {
    module: "attendance",
    ...info,
  });
  await writeDb(db);
  redirect(`${target}?biobreak=started`);
}

export async function endBioBreakAction(formData: FormData) {
  const { user, db } = await requireUserLite();
  const target = safeRedirectTarget(formData.get("redirect_to"));

  const ended = await endBioBreak(user.id);
  if (!ended) {
    redirect(`${target}?error=${encodeURIComponent("You do not have a bio break in progress.")}`);
  }

  const info = await getRequestInfo();
  logActivity(
    db,
    user.id,
    "BIO_BREAK_END",
    "attendance",
    ended!.id,
    { work_date: ended!.work_date, duration_seconds: ended!.duration_seconds },
    { module: "attendance", ...info }
  );
  await writeDb(db);
  redirect(`${target}?biobreak=ended`);
}
