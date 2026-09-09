"use server";

import { redirect } from "next/navigation";

import { uuid, nowIso } from "@/lib/db";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getRequestInfo } from "@/lib/request-info";
import { isFullAccess } from "@/lib/permissions";
import { scopeAgentsForSchedule } from "@/lib/schedule-access";
import { todayInTz } from "@/lib/utils";
import { DISCIPLINARY_TYPES, type DisciplinaryType } from "@/lib/disciplinary-types";
import { requireUserLite, requirePermission } from "./guards";

const PAGE = "/schedule/suspensions";

/**
 * Declared rather than assigned to a const, and that is not style.
 * TypeScript narrows after a call only when the never-returning function is a
 * declaration; as an arrow const it compiles and then every check below it
 * stops narrowing, so the compiler thinks a row that was just proven to exist
 * might still be null.
 */
function fail(message: string): never {
  redirect(`${PAGE}?error=${encodeURIComponent(message)}`);
}

/**
 * Written straight in rather than through writeDb, which upserts whole tables.
 * A disciplinary record touches nothing readDb holds, and rewriting thirteen
 * tables to log one line is how a screen becomes slow for reasons nobody can
 * find later.
 */
async function log(
  userId: string,
  userEmail: string,
  action: string,
  recordId: string,
  details: Record<string, unknown>
) {
  const info = await getRequestInfo();
  const { error } = await supabaseAdmin.from("activity_log").insert({
    id: uuid(),
    user_id: userId,
    user_email: userEmail,
    action,
    entity_type: "disciplinary_action",
    entity_id: recordId,
    details,
    module: "disciplinary",
    previous_value: null,
    updated_value: null,
    created_at: nowIso(),
    ...info,
  });
  if (error) console.error("[disciplinary] activity log failed: %s", error.message);
}

/**
 * Recording a warning.
 *
 * Suspensions are deliberately NOT accepted here. They already have a form, and
 * that form is the one that blocks the days and paints the schedule — recording
 * a "suspension" here would produce a record of days nobody is actually
 * suspended for, which is worse than having no record at all. Issuing one there
 * writes its own row in this table, so the history stays complete either way.
 */
export async function recordDisciplinaryAction(formData: FormData) {
  const { user, db } = await requireUserLite();
  requirePermission(user, "disciplinary", "manage", db, PAGE);

  const employeeId = String(formData.get("employee_id") || "");
  const actionDate = String(formData.get("action_date") || "");
  const actionType = String(formData.get("action_type") || "") as DisciplinaryType;
  const offense = String(formData.get("offense") || "").trim();
  const details = String(formData.get("details") || "").trim();

  // Scoped, not merely validated. A Team Lead may only write up their own
  // people, and the check is the same one the Schedule module uses to decide
  // whose records they may see at all.
  const employee = scopeAgentsForSchedule(db, user).find((p) => p.id === employeeId);
  if (!employee || isFullAccess(employee.role) || employee.is_test_account) {
    fail("Select a valid employee.");
  }
  if (!actionDate) fail("Date of action is required.");
  if (actionDate > todayInTz()) fail("The date of action cannot be in the future.");
  if (!DISCIPLINARY_TYPES.includes(actionType)) fail("Select a valid action type.");
  if (actionType === "suspension") {
    fail("Use the Issue Suspension form for suspensions — it blocks the days and records itself here.");
  }
  if (!offense) fail("Offense is required.");

  const id = uuid();
  const { error } = await supabaseAdmin.from("disciplinary_actions").insert({
    id,
    employee_id: employeeId,
    action_date: actionDate,
    action_type: actionType,
    offense,
    details: details || null,
    issued_by: user.id,
    status: "active",
  });

  if (error) {
    console.error("[disciplinary] insert failed: %s", error.message);
    fail("Could not record the disciplinary action. Please try again.");
  }

  await log(user.id, user.email, "DISCIPLINARY_ISSUED", id, {
    employee_id: employeeId,
    action_type: actionType,
    action_date: actionDate,
    offense,
  });

  // The person it is about is told. A record somebody has not been shown is
  // exactly the record that gets disputed, and the acknowledgement below is
  // worth nothing if the first they hear of it is at a hearing.
  const { error: notifyError } = await supabaseAdmin.from("notifications").insert({
    id: uuid(),
    recipient_id: employeeId,
    type: "disciplinary_action",
    title: "Disciplinary Action Recorded",
    body: `A disciplinary action was recorded on your file (${offense}). Please review and acknowledge it.`,
    link: PAGE,
    is_read: false,
    created_at: nowIso(),
  });
  if (notifyError) console.error("[disciplinary] notify failed: %s", notifyError.message);

  redirect(`${PAGE}?recorded=1`);
}

/**
 * The employee confirming they were told.
 *
 * Their own record only, and only their own hand: this is the whole value of
 * the field. A supervisor who could tick it for somebody else would be
 * recording that a conversation happened, which is the fact in dispute.
 */
export async function acknowledgeDisciplinaryAction(formData: FormData) {
  const { user } = await requireUserLite();
  const id = String(formData.get("id") || "");
  if (!id) fail("Nothing to acknowledge.");

  const { data, error } = await supabaseAdmin
    .from("disciplinary_actions")
    .update({ status: "acknowledged", acknowledged_at: nowIso(), updated_at: nowIso() })
    .eq("id", id)
    .eq("employee_id", user.id)
    .eq("status", "active")
    .select("id");

  if (error) {
    console.error("[disciplinary] acknowledge failed: %s", error.message);
    fail("Could not acknowledge this record. Please try again.");
  }
  // No row means it was not theirs, or was already answered. Both are the same
  // message: nothing here for you to sign.
  if (!data || data.length === 0) fail("That record cannot be acknowledged.");

  await log(user.id, user.email, "DISCIPLINARY_ACKNOWLEDGED", id, {});
  redirect(`${PAGE}?acknowledged=1`);
}

/**
 * Taking one back.
 *
 * Withdrawn, never deleted, and it stays on the list saying so. A record that
 * can be made to disappear is not a record — and the reason a warning was
 * withdrawn is often more important than the warning.
 */
export async function withdrawDisciplinaryAction(formData: FormData) {
  const { user, db } = await requireUserLite();
  requirePermission(user, "disciplinary", "manage", db, PAGE);

  const id = String(formData.get("id") || "");
  const reason = String(formData.get("withdrawn_reason") || "").trim();
  if (!id) fail("Nothing to withdraw.");
  if (!reason) fail("A reason is required to withdraw a disciplinary action.");

  // Scoped to the same people this user may write up in the first place.
  // Without it, holding disciplinary.manage would mean being able to withdraw
  // anybody's record anywhere in the company by id -- a Team Lead quietly
  // clearing another team's file. The list they can see never offers it; that
  // is not the same as the server refusing it.
  const allowed = scopeAgentsForSchedule(db, user).map((p) => p.id);

  const at = nowIso();
  const { data, error } = await supabaseAdmin
    .from("disciplinary_actions")
    .update({
      status: "withdrawn",
      withdrawn_reason: reason,
      withdrawn_by: user.id,
      withdrawn_at: at,
      updated_at: at,
    })
    .eq("id", id)
    .in("employee_id", allowed)
    .neq("status", "withdrawn")
    .select("id, employee_id");

  if (error) {
    console.error("[disciplinary] withdraw failed: %s", error.message);
    fail("Could not withdraw this record. Please try again.");
  }
  if (!data || data.length === 0) fail("That record cannot be withdrawn.");

  await log(user.id, user.email, "DISCIPLINARY_WITHDRAWN", id, { reason });

  const { error: notifyError } = await supabaseAdmin.from("notifications").insert({
    id: uuid(),
    recipient_id: data[0].employee_id,
    type: "disciplinary_action",
    title: "Disciplinary Action Withdrawn",
    body: `A disciplinary action on your file was withdrawn: ${reason}`,
    link: PAGE,
    is_read: false,
    created_at: at,
  });
  if (notifyError) console.error("[disciplinary] notify failed: %s", notifyError.message);

  redirect(`${PAGE}?withdrawn=1`);
}
