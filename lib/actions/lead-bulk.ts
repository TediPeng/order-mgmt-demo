"use server";

import { revalidatePath } from "next/cache";
import { writeDb, queueDelete, adoptOrders, markOrderDirty } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { orderInScope, canAssignLeads, allowedAssigneeIds } from "@/lib/order-access";
import { notify } from "@/lib/notifications";
import { displayUserName } from "@/lib/types";
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

// ── Transferring a selection ────────────────────────────────────────────────

export interface BulkTransferResult {
  moved: number;
  /** Every row that was NOT moved, with the reason. Never summarised away. */
  skipped: BulkDeleteSkip[];
  error?: string;
}

/**
 * Handing the leads someone has ticked to another caller.
 *
 * The Transfer Leads page moves a whole queue by status, or one lead by phone
 * number with an override. Neither is what a person looking at a filtered list
 * wants: they have already found the rows, and the only thing left was to tick
 * them — which until now meant deleting them or nothing.
 *
 * A selection transfer is a queue transfer, so it follows the queue rules
 * rather than inventing softer ones:
 *
 *   - A sale does not move. order_date, a Pancake id or a forward timestamp
 *     each make it one, and moving one would hand over a figure somebody is
 *     measured on. Those go one at a time by phone with an override, where the
 *     sale credit is explicitly left behind.
 *   - A regular customer does not move. Their record lives on
 *     customers.owner_agent_id and moving the order alone leaves the record
 *     with the old agent and the lead in a list nobody reads. Change owner on
 *     the customer does it properly.
 *
 * Every question is asked again here against the database. A page left open
 * since this morning must not be able to transfer a lead that has since been
 * sold.
 */
export async function transferLeadsSelectionAction(
  ids: string[],
  toAgentId: string
): Promise<BulkTransferResult> {
  const { user, db } = await requireUserLite();

  // Not requirePermission(): that redirects, and a redirect out of an action
  // the client is awaiting a result from surfaces as an unexplained failure.
  if (!canAssignLeads(user, db)) {
    return { moved: 0, skipped: [], error: "You do not have permission to transfer leads." };
  }
  if (!toAgentId) return { moved: 0, skipped: [], error: "Pick the agent to transfer to." };
  if (!allowedAssigneeIds(user, db).includes(toAgentId)) {
    return { moved: 0, skipped: [], error: "You cannot transfer leads to that agent." };
  }
  const toAgent = db.profiles.find((p) => p.id === toAgentId && p.is_active);
  if (!toAgent) return { moved: 0, skipped: [], error: "Pick an active agent." };

  const wanted = Array.from(new Set((ids || []).filter(Boolean)));
  if (wanted.length === 0) return { moved: 0, skipped: [] };
  if (wanted.length > MAX_SELECTION) {
    return { moved: 0, skipped: [], error: `Too many leads at once — ${MAX_SELECTION} is the limit.` };
  }

  const rows = (await ordersByIds(wanted)) as unknown as Order[];
  const found = new Set(rows.map((o) => o.id));

  const skipped: BulkDeleteSkip[] = [];
  const movableIds = new Set<string>();

  for (const id of wanted) {
    if (!found.has(id)) skipped.push({ order_number: id.slice(0, 8), reason: "No longer exists" });
  }

  for (const order of rows) {
    if (!orderInScope(user, order, db)) {
      skipped.push({ order_number: order.order_number, reason: "Not yours to transfer" });
      continue;
    }
    if (order.agent_id === toAgentId) {
      skipped.push({ order_number: order.order_number, reason: "Already theirs" });
      continue;
    }
    if (order.order_date || order.pancake_order_id || order.forwarded_to_pancake_at) {
      skipped.push({
        order_number: order.order_number,
        reason: "Already a sale — move it by phone number with an override",
      });
      continue;
    }
    if (order.is_regular_customer) {
      skipped.push({
        order_number: order.order_number,
        reason: "Regular customer — use Change owner on the customer",
      });
      continue;
    }
    movableIds.add(order.id);
  }

  if (movableIds.size === 0) return { moved: 0, skipped };

  const movable = rows.filter((o) => movableIds.has(o.id));
  const fromAgents = Array.from(
    new Set(movable.map((o) => o.agent_id).filter((id): id is string => Boolean(id) && id !== toAgentId))
  );

  // Through the in-memory shape and dirty list, not a direct update: writeDb
  // writes the rows named in db.dirty_orders, so a write made behind its back
  // can be undone by the save that follows it.
  for (const order of adoptOrders(db, movable as unknown as Record<string, unknown>[])) {
    order.agent_id = toAgentId;
    order.assigned_agent_email = toAgent.email || "";
    // Order Source names who sold it. None of these is a sale — that is what
    // the guard above is for — so it follows the lead, exactly as the queue
    // transfer does.
    order.order_source = toAgent.call_name || order.order_source;
    order.updated_by = user.id;
    markOrderDirty(db, order.id);
  }

  const info = await getRequestInfo();
  logActivity(db, user.id, "LEADS_TRANSFERRED", "order", null, {
    how: "leads_selection",
    to_agent_id: toAgentId,
    to_agent: displayUserName(toAgent),
    moved: movable.length,
    order_ids: movable.map((o) => o.id),
    order_numbers: movable.map((o) => o.order_number),
    skipped: skipped.length,
    skipped_reasons: skipped,
    // A selection can never carry one: those two need the by-phone override.
    override: null,
  }, { module: "orders", ...info });

  notify(db, [toAgentId], "lead_transfer", "Leads transferred to you",
    `${movable.length} lead(s) moved to you.`, "/leads");
  // Losing a lead without being told is how an agent finds out by noticing it
  // missing.
  for (const loser of fromAgents) {
    notify(db, [loser], "lead_transfer", "Leads moved to another agent",
      `${movable.length} of your lead(s) were transferred to ${displayUserName(toAgent)}.`, "/leads");
  }

  await writeDb(db);
  revalidatePath("/leads");

  return { moved: movable.length, skipped };
}
