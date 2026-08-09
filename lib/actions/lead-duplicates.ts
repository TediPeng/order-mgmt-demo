"use server";

import { redirect } from "next/navigation";
import { writeDb, queueDelete } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { scopeOrders, orderInScope } from "@/lib/order-access";
import { canonicalPhone } from "@/lib/utils";
import { findDuplicateGroups, protectedReason } from "@/lib/duplicate-leads";
import { requireUser, requirePermission } from "./guards";
import type { DbShape, Order, Profile } from "@/lib/types";

/**
 * Permanent deletion of duplicate leads.
 *
 * Deliberately its own action rather than a loop over deleteLeadAction: that
 * one redirects, and a sweep of two thousand rows must be a single database
 * write with a single audit entry, not two thousand round trips.
 *
 * Every path here re-derives what is deletable from the database. The form
 * sends an id or a phone number, never a decision — a stale page must not be
 * able to delete a row that has since been sent to Pancake.
 */

const PATH = "/leads/duplicates";

function back(message: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(message)}`);
}

/** Removes the rows from the in-memory copy and states the deletions, which is
 * what writeDb() acts on. Returns the snapshots for the audit entry. */
function removeOrders(db: DbShape, ids: Set<string>): Order[] {
  const removed: Order[] = [];
  for (let i = db.orders.length - 1; i >= 0; i--) {
    const order = db.orders[i];
    if (!ids.has(order.id)) continue;
    db.orders.splice(i, 1);
    queueDelete(db, "orders", order.id);
    removed.push(order);
  }
  return removed;
}

async function commit(db: DbShape, user: Profile, removed: Order[], how: string): Promise<void> {
  const info = await getRequestInfo();
  logActivity(
    db,
    user.id,
    "DUPLICATE_LEADS_DELETED",
    "order",
    removed.length === 1 ? removed[0].id : null,
    {
      how,
      deleted: removed.length,
      order_numbers: removed.slice(0, 50).map((o) => o.order_number),
      truncated: removed.length > 50,
    },
    {
      module: "orders",
      // The whole row of each deletion, so the audit trail is the only copy
      // that still exists — there is no undo for this.
      previous_value: removed.slice(0, 50),
      ...info,
    }
  );
  await writeDb(db);
}

/** One row, from its own Delete button. */
export async function deleteDuplicateOrderAction(orderId: string) {
  const { user, db } = await requireUser();
  requirePermission(user, "orders", "delete", db, PATH);

  const order = db.orders.find((o) => o.id === orderId);
  if (!order) back("That lead no longer exists.");
  if (!orderInScope(user, order!, db)) back("You do not have access to that lead.");

  const reason = protectedReason(order!);
  if (reason) back(`${order!.order_number} cannot be deleted here — ${reason}.`);

  const removed = removeOrders(db, new Set([orderId]));
  await commit(db, user, removed, "single");
  redirect(`${PATH}?deleted=${removed.length}`);
}

/** One phone number: keep the earliest lead, delete the rest. */
export async function resolveDuplicateGroupAction(phone: string) {
  const { user, db } = await requireUser();
  requirePermission(user, "orders", "delete", db, PATH);

  const target = canonicalPhone(phone);
  if (!target) back("That is not a phone number.");

  const group = findDuplicateGroups(scopeOrders(user, db.orders, db)).find((g) => g.phone === target);
  if (!group) back("That number no longer has duplicates.");
  if (group.removable.length === 0) back("Nothing in that group can be deleted here.");

  const removed = removeOrders(db, new Set(group.removable.map((o) => o.id)));
  await commit(db, user, removed, "group");
  redirect(`${PATH}?deleted=${removed.length}`);
}

/**
 * Every duplicate at once, keeping the earliest lead per number.
 *
 * The reach of this is the reason it asks for the count to be typed back: the
 * button that removes three rows and the button that removes two thousand look
 * identical, and only one of them should be possible to press by accident.
 */
export async function deleteAllDuplicatesAction(formData: FormData) {
  const { user, db } = await requireUser();
  requirePermission(user, "orders", "delete", db, PATH);

  const groups = findDuplicateGroups(scopeOrders(user, db.orders, db));
  const removable = groups.flatMap((g) => g.removable);
  if (removable.length === 0) back("There are no duplicates to delete.");

  const typed = String(formData.get("confirm_count") || "").trim();
  if (typed !== String(removable.length)) {
    back(`Type ${removable.length} to confirm. Nothing was deleted.`);
  }

  const removed = removeOrders(db, new Set(removable.map((o) => o.id)));
  await commit(db, user, removed, "all");
  redirect(`${PATH}?deleted=${removed.length}`);
}
