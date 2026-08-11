"use server";

import { redirect } from "next/navigation";
import { writeDb, queueDelete } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { orderInScope } from "@/lib/order-access";
import { leadScopeFor } from "@/lib/leads-query";
import { duplicateRemovable, ordersByIds, phoneKeyOf } from "@/lib/duplicates-query";
import { protectedReason } from "@/lib/duplicate-leads";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUserLite, requirePermission } from "./guards";
import type { DbShape, Order, Profile } from "@/lib/types";

/**
 * Permanent deletion of duplicate leads.
 *
 * Deliberately its own action rather than a loop over deleteLeadAction: that
 * one redirects, and a sweep of six thousand rows must be a single database
 * write with a single audit entry, not six thousand round trips.
 *
 * Every path here re-derives what is deletable from the database. The form
 * sends an id or a phone number, never a decision — a stale page must not be
 * able to delete a row that has since been sent to Pancake.
 *
 * Nothing here loads db.orders. It used to: each of these actions read all
 * 57,000 orders to find the handful it was about to delete, which is most of
 * why the page was at the edge of its time limit before it deleted anything.
 */

const PATH = "/leads/duplicates";

/** Ids per audit snapshot. The entry holds whole rows because it is the only
 * copy that survives the deletion; fifty is a readable record, not a second
 * copy of the table. */
const AUDIT_SAMPLE = 50;

function back(message: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(message)}`);
}

/**
 * States the deletions and writes them, then records what was deleted.
 *
 * The ordering inside writeDb() matters and was wrong until 2026-08-10: the
 * audit entry went in with the other upserts, BEFORE the delete was attempted,
 * so a failed sweep still logged "6,255 duplicate leads deleted". The audit
 * insert is now the last thing writeDb() does, so an entry means the deletion
 * landed.
 */
async function deleteOrders(db: DbShape, user: Profile, ids: string[], how: string): Promise<number> {
  // Whole rows for the audit, fetched before they cease to exist.
  const snapshot = await ordersByIds(ids.slice(0, AUDIT_SAMPLE));
  const orderNumbers = snapshot.map((o) => o.order_number as string);

  for (const id of ids) queueDelete(db, "orders", id);

  const info = await getRequestInfo();
  logActivity(
    db,
    user.id,
    "DUPLICATE_LEADS_DELETED",
    "order",
    ids.length === 1 ? ids[0] : null,
    {
      how,
      deleted: ids.length,
      order_numbers: orderNumbers,
      truncated: ids.length > AUDIT_SAMPLE,
    },
    {
      module: "orders",
      // The whole row of each deletion, so the audit trail is the only copy
      // that still exists — there is no undo for this.
      previous_value: snapshot,
      ...info,
    }
  );
  await writeDb(db);
  return ids.length;
}

/** One row, from its own Delete button. */
export async function deleteDuplicateOrderAction(orderId: string) {
  const { user, db } = await requireUserLite();
  requirePermission(user, "orders", "delete", db, PATH);

  const { data, error } = await supabaseAdmin.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (error) throw new Error(`Lead lookup failed: ${error.message}`);
  const order = data as unknown as Order | null;
  if (!order) back("That lead no longer exists.");
  if (!orderInScope(user, order!, db)) back("You do not have access to that lead.");

  const reason = protectedReason(order!);
  if (reason) back(`${order!.order_number} cannot be deleted here — ${reason}.`);

  // protectedReason() judges one row on its own, so it cannot see the two things
  // that are true only of a group: that this row is a duplicate at all, and who
  // holds the lead being kept. Both live in lead_duplicate_rows(), so the single
  // Delete button asks the same question the sweep asks rather than a weaker one
  // — otherwise the row a "Delete all" now refuses to touch could still be
  // removed one click at a time.
  const group = await duplicateRemovable(leadScopeFor(user, db), phoneKeyOf(order!.customer_phone));
  if (!group.ids.includes(orderId)) {
    back(`${order!.order_number} cannot be deleted here — it is not a removable duplicate.`);
  }

  const deleted = await deleteOrders(db, user, [orderId], "single");
  redirect(`${PATH}?deleted=${deleted}`);
}

/** One phone number: keep the earliest lead, delete the rest. */
export async function resolveDuplicateGroupAction(phone: string) {
  const { user, db } = await requireUserLite();
  requirePermission(user, "orders", "delete", db, PATH);

  const key = phoneKeyOf(phone);
  if (!key) back("That is not a phone number.");

  const group = await duplicateRemovable(leadScopeFor(user, db), key);
  if (!group.groupExists) back("That number no longer has duplicates.");
  if (group.ids.length === 0) back("Nothing in that group can be deleted here.");

  const deleted = await deleteOrders(db, user, group.ids, "group");
  redirect(`${PATH}?deleted=${deleted}`);
}

/**
 * Every duplicate at once, keeping the earliest lead per number.
 *
 * The reach of this is the reason it asks for the count to be typed back: the
 * button that removes three rows and the button that removes six thousand look
 * identical, and only one of them should be possible to press by accident.
 */
export async function deleteAllDuplicatesAction(formData: FormData) {
  const { user, db } = await requireUserLite();
  requirePermission(user, "orders", "delete", db, PATH);

  const all = await duplicateRemovable(leadScopeFor(user, db));
  if (all.ids.length === 0) back("There are no duplicates to delete.");

  const typed = String(formData.get("confirm_count") || "").trim();
  if (typed !== String(all.ids.length)) {
    back(`Type ${all.ids.length} to confirm. Nothing was deleted.`);
  }

  const deleted = await deleteOrders(db, user, all.ids, "all");
  redirect(`${PATH}?deleted=${deleted}`);
}
