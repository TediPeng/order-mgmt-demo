"use server";

import { revalidatePath } from "next/cache";
import { writeDb, queueDelete } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { orderInScope } from "@/lib/order-access";
import { protectedReason } from "@/lib/duplicate-leads";
import { ordersByIds } from "@/lib/duplicates-query";
import { can } from "@/lib/permissions";
import { requireUserLite } from "./guards";
import type { Order } from "@/lib/types";

/**
 * Deleting the leads someone has ticked on the Leads list.
 *
 * Separate from deleteLeadAction, which redirects: this one has to come back
 * with an answer, because a selection of twenty-five rows is not all-or-
 * nothing. Some of them will be refused, and the person who ticked them is
 * owed the list of which ones and why — a bulk action that quietly deletes
 * eighteen of twenty-five and reports "done" is how a sale goes missing
 * without anyone noticing for a week.
 *
 * The selection is a list of ids and nothing else. Every question about
 * whether a row may go — scope, and whether it is protected — is asked again
 * here, against the database, at the moment of deletion. A page left open
 * since this morning must not be able to delete a lead that has since been
 * sent to Pancake.
 */

/** Ticked at once. The list shows twenty-five rows a page, so this is already
 * far above what the UI can hand over; it exists to bound a crafted request. */
const MAX_SELECTION = 200;

/** Ids per audit snapshot — the entry holds whole rows, because after this it
 * is the only copy of them that exists. */
const AUDIT_SAMPLE = 50;

export interface BulkDeleteSkip {
  order_number: string;
  reason: string;
}

export interface BulkDeleteResult {
  deleted: number;
  /** Every row that was NOT deleted, with the reason. Never summarised away. */
  skipped: BulkDeleteSkip[];
  error?: string;
}

export async function deleteLeadsAction(ids: string[]): Promise<BulkDeleteResult> {
  const { user, db } = await requireUserLite();

  // Not requirePermission(): that redirects, and a redirect out of an action
  // the client is awaiting a result from surfaces as an unexplained failure.
  if (!can(user.role, "orders", "delete", db.role_permissions)) {
    return { deleted: 0, skipped: [], error: "You do not have permission to delete leads." };
  }

  const wanted = Array.from(new Set((ids || []).filter(Boolean)));
  if (wanted.length === 0) return { deleted: 0, skipped: [] };
  if (wanted.length > MAX_SELECTION) {
    return { deleted: 0, skipped: [], error: `Too many leads at once — ${MAX_SELECTION} is the limit.` };
  }

  const rows = (await ordersByIds(wanted)) as unknown as Order[];
  const found = new Set(rows.map((o) => o.id));

  const skipped: BulkDeleteSkip[] = [];
  const deletable: Order[] = [];

  // A row the query did not return is one that has already gone. Saying so is
  // better than counting it as deleted, which would make a stale page look
  // like it had done work it did not do.
  for (const id of wanted) {
    if (!found.has(id)) skipped.push({ order_number: id.slice(0, 8), reason: "No longer exists" });
  }

  for (const order of rows) {
    if (!orderInScope(user, order, db)) {
      skipped.push({ order_number: order.order_number, reason: "Not yours to delete" });
      continue;
    }
    // The same guard the Duplicates page uses, deliberately. A lead that
    // reached Packaging counts as a sale and one already in Pancake exists in
    // two systems — deleting either here would leave the other holding a
    // record with nothing behind it.
    const reason = protectedReason(order);
    if (reason) {
      skipped.push({ order_number: order.order_number, reason });
      continue;
    }
    deletable.push(order);
  }

  if (deletable.length === 0) return { deleted: 0, skipped };

  for (const order of deletable) queueDelete(db, "orders", order.id);

  const info = await getRequestInfo();
  logActivity(
    db,
    user.id,
    "LEADS_BULK_DELETED",
    "order",
    deletable.length === 1 ? deletable[0].id : null,
    {
      how: "leads_selection",
      deleted: deletable.length,
      order_numbers: deletable.map((o) => o.order_number),
      skipped: skipped.length,
      skipped_reasons: skipped,
      truncated: deletable.length > AUDIT_SAMPLE,
    },
    {
      module: "orders",
      // Whole rows, because there is no undo for this and the audit entry is
      // the only place they still exist.
      previous_value: deletable.slice(0, AUDIT_SAMPLE),
      ...info,
    }
  );

  // Last, and only after the deletes are queued: an audit entry written before
  // the write lands would record a deletion that never happened.
  await writeDb(db);
  revalidatePath("/leads");

  return { deleted: deletable.length, skipped };
}
