"use server";

import { revalidatePath } from "next/cache";
import { writeDb, queueDelete } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { orderInScope } from "@/lib/order-access";
import { protectedReason } from "@/lib/duplicate-leads";
import { ordersByIds } from "@/lib/duplicates-query";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { can } from "@/lib/permissions";
import { MAX_LEAD_PAGE_SIZE } from "@/lib/leads-query";
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

/**
 * Ticked at once — a full page of the largest size the list offers.
 *
 * Derived rather than written down again. It used to be 200 with a note saying
 * that was "far above what the UI can hand over", which was true while the list
 * showed twenty-five rows and stopped being true the day it could show five
 * hundred. Two numbers describing one thing drift the moment either moves.
 */
const MAX_SELECTION = MAX_LEAD_PAGE_SIZE;

/**
 * How many deleted orders keep a copy.
 *
 * This is the number that decides whether a deletion can be undone, and it used
 * to be 50 while 200 could be deleted — so a sweep of 200 kept 50 and lost 150,
 * silently, with `truncated: true` in a log nobody reads until they need it.
 * That is not hypothetical here: 12,232 rows went that way on 2026-08-24 and
 * are not coming back.
 *
 * So it matches the selection cap now. Nothing is deleted without a copy of it
 * surviving, which is the only thing that makes deleting five hundred at once
 * a reasonable offer rather than a bigger version of that accident.
 *
 * It costs a large audit row — five hundred whole orders is on the order of a
 * megabyte of jsonb, plus their lines and call sessions. That is the price of
 * the delete being reversible, and it is worth paying.
 */
const AUDIT_SAMPLE = MAX_SELECTION;

export interface BulkDeleteSkip {
  order_number: string;
  reason: string;
}

export interface BulkDeleteResult {
  deleted: number;
  /** Every row that was NOT deleted, with the reason. Never summarised away. */
  skipped: BulkDeleteSkip[];
  /** What went with the leads. order_items and call_sessions both CASCADE from
   * orders, so deleting a lead silently takes its lines and its call history
   * too — and call time is what the performance figures are built from. Both
   * are in the audit entry, and both are said out loud here. */
  itemsRemoved: number;
  sessionsRemoved: number;
  error?: string;
}

export async function deleteLeadsAction(ids: string[]): Promise<BulkDeleteResult> {
  const { user, db } = await requireUserLite();

  // Not requirePermission(): that redirects, and a redirect out of an action
  // the client is awaiting a result from surfaces as an unexplained failure.
  if (!can(user.role, "orders", "delete", db.role_permissions)) {
    return { deleted: 0, skipped: [], itemsRemoved: 0, sessionsRemoved: 0, error: "You do not have permission to delete leads." };
  }

  const wanted = Array.from(new Set((ids || []).filter(Boolean)));
  if (wanted.length === 0) return { deleted: 0, skipped: [], itemsRemoved: 0, sessionsRemoved: 0 };
  if (wanted.length > MAX_SELECTION) {
    return { deleted: 0, skipped: [], itemsRemoved: 0, sessionsRemoved: 0, error: `Too many leads at once — ${MAX_SELECTION} is the limit.` };
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

  if (deletable.length === 0) return { deleted: 0, skipped, itemsRemoved: 0, sessionsRemoved: 0 };

  // The children, fetched before the parent goes.
  //
  // order_items and call_sessions are ON DELETE CASCADE, so Postgres removes
  // them without anybody asking — and an audit entry holding only the order
  // row would be a record of the deletion that cannot undo it. A lead worth
  // deleting can still carry the lines an agent typed and the calls they made.
  const doomed = deletable.map((o) => o.id);
  const [itemsRes, sessionsRes] = await Promise.all([
    supabaseAdmin.from("order_items").select("*").in("order_id", doomed),
    supabaseAdmin.from("call_sessions").select("*").in("order_id", doomed),
  ]);
  if (itemsRes.error) throw new Error(`order_items snapshot failed: ${itemsRes.error.message}`);
  if (sessionsRes.error) throw new Error(`call_sessions snapshot failed: ${sessionsRes.error.message}`);
  const items = itemsRes.data || [];
  const sessions = sessionsRes.data || [];

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
      order_items_removed: items.length,
      call_sessions_removed: sessions.length,
      truncated: deletable.length > AUDIT_SAMPLE,
    },
    {
      module: "orders",
      // Whole rows, because there is no undo for this and the audit entry is
      // the only place they still exist — the cascaded children included, or
      // a restore would bring back an order with no lines and no call history.
      previous_value: {
        orders: deletable.slice(0, AUDIT_SAMPLE),
        order_items: items,
        call_sessions: sessions,
      },
      ...info,
    }
  );

  // Last, and only after the deletes are queued: an audit entry written before
  // the write lands would record a deletion that never happened.
  await writeDb(db);
  revalidatePath("/leads");

  return { deleted: deletable.length, skipped, itemsRemoved: items.length, sessionsRemoved: sessions.length };
}
