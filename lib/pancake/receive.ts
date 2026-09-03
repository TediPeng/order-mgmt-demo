import type { Order, PancakeSyncSource } from "@/lib/types";
import { TERMINAL_STATUSES } from "@/lib/validation";
import { normalizePhone } from "@/lib/utils";
import type { IncomingUpdate } from "./types";
import { mapStatus } from "./mapStatus";
import { hasOdzTag } from "./config";
import {
  eventKey,
  findForwardedOrdersByPhone,
  findOrderByExternalReference,
  findOrderByOrderNumber,
  findOrderByPancakeId,
  hasProcessedEvent,
  listStatusMap,
  insertSyncLog,
  notifyAdministrators,
  logActivityDirect,
  updateOrderSyncFields,
} from "./store";

export interface ApplyResult {
  applied: boolean;
  reason: string;
  orderId: string | null;
}

const TERMINAL: readonly string[] = TERMINAL_STATUSES;

/** Strict matching order (Section 4): pancake_order_id -> internal order id
 * echoed as external reference -> order number -> phone (last resort, must be
 * a UNIQUE forwarded order). Never by customer name. */
export async function matchOrder(update: IncomingUpdate): Promise<{ order: Order | null; matchedBy: string; ambiguous: boolean }> {
  if (update.pancakeOrderId) {
    const o = await findOrderByPancakeId(update.pancakeOrderId);
    if (o) return { order: o, matchedBy: "pancake_order_id", ambiguous: false };
  }
  if (update.externalReference) {
    const o = await findOrderByExternalReference(update.externalReference);
    if (o) return { order: o, matchedBy: "external_reference", ambiguous: false };
  }
  if (update.orderNumber) {
    const o = await findOrderByOrderNumber(update.orderNumber);
    if (o) return { order: o, matchedBy: "order_number", ambiguous: false };
  }
  if (update.phone) {
    const candidates = await findForwardedOrdersByPhone(update.phone);
    const normalized = candidates.filter((c) => normalizePhone(c.customer_phone) === normalizePhone(update.phone!));
    if (normalized.length === 1) return { order: normalized[0], matchedBy: "phone", ambiguous: false };
    if (normalized.length > 1) return { order: null, matchedBy: "phone", ambiguous: true };
  }
  return { order: null, matchedBy: "none", ambiguous: false };
}

/** Applies one incoming Pancake status update with full update protection
 * (Section 6): status-map resolution, out-of-order rejection, terminal-status
 * rules, and never touching any non-fulfillment field. Every decision —
 * applied or not — lands in pancake_sync_logs. */
export async function applyIncomingUpdate(update: IncomingUpdate, source: PancakeSyncSource, accountId: string | null): Promise<ApplyResult> {
  const base = {
    pancake_order_id: update.pancakeOrderId,
    pancake_account_id: accountId,
    action: (source === "webhook" ? "status_update" : "poll") as "status_update" | "poll",
    source,
    request_at: new Date().toISOString(),
  };

  const { order, matchedBy, ambiguous } = await matchOrder(update);
  if (!order) {
    const reason = ambiguous
      ? "Phone-number fallback matched more than one forwarded order — refusing to guess."
      : "No order matched (pancake id / external reference / order number / phone all failed).";
    await insertSyncLog({ ...base, result: "failed", error_message: reason, new_status: update.rawStatus });
    await notifyAdministrators("pancake_needs_review", "Pancake update needs review: unmatched order", reason, "/settings/integrations/logs");
    return { applied: false, reason, orderId: null };
  }

  // Guard: a matched order that was never forwarded shouldn't accept Pancake updates.
  if (!order.forwarded_to_pancake_at) {
    const reason = `Matched order ${order.order_number} (by ${matchedBy}) was never forwarded to Pancake — update ignored.`;
    await insertSyncLog({ ...base, order_id: order.id, result: "failed", error_message: reason, new_status: update.rawStatus });
    return { applied: false, reason, orderId: order.id };
  }

  // Pancake Order ID consistency check.
  if (update.pancakeOrderId && order.pancake_order_id && update.pancakeOrderId !== order.pancake_order_id) {
    const reason = `Pancake order id mismatch (incoming ${update.pancakeOrderId}, stored ${order.pancake_order_id}) — rejected.`;
    await insertSyncLog({ ...base, order_id: order.id, result: "failed", error_message: reason });
    return { applied: false, reason, orderId: order.id };
  }

  if (!update.rawStatus) {
    const reason = "Update carried no status field — nothing to apply.";
    await insertSyncLog({ ...base, order_id: order.id, result: "failed", error_message: reason });
    return { applied: false, reason, orderId: order.id };
  }

  // --- Duplicate delivery ---------------------------------------------------
  // Webhook transports are at-least-once, so the same event can arrive twice
  // (and polling can race a webhook for the same change). Identity is the
  // (pancake order, status, Pancake-clock timestamp) triple; a repeat is logged
  // as a duplicate and never re-applied. Needs all three parts to be a real
  // key — without a timestamp the "status unchanged" path below already
  // absorbs repeats harmlessly.
  const key =
    update.pancakeOrderId && update.eventTimestamp
      ? eventKey(update.pancakeOrderId, update.rawStatus, update.eventTimestamp)
      : null;
  if (key && (await hasProcessedEvent(key))) {
    const reason = `Duplicate delivery of an already-applied event (${update.rawStatus} @ ${update.eventTimestamp}) — ignored.`;
    // Stamped even though nothing is applied, because "we asked and Pancake
    // answered" is exactly what pancake_synced_at records, and the sweep picks
    // its next candidates by that stamp.
    //
    // Without this the poller ate itself. For a webhook a repeated event really
    // is a duplicate delivery; for polling an unchanged order returns the same
    // (order, status, timestamp) triple every single time, which is the normal
    // answer, not a duplicate. This branch returned before the "status
    // unchanged" path below — the one that does the stamping — so those orders
    // stayed permanently stale, were re-selected on the next run, and held the
    // whole budget for ever. On 2 September that was 4,162 polls spread across
    // 33 orders, 126 apiece, while 1,212 waited and 704 had not been asked
    // about in over a week.
    await updateOrderSyncFields(order.id, { pancake_synced_at: new Date().toISOString() });
    await insertSyncLog({
      ...base,
      order_id: order.id,
      action: "duplicate_ignored",
      old_status: order.status,
      new_status: update.rawStatus,
      result: "success",
      error_message: reason,
      payload_summary: { duplicate_of_event_key: key },
    });
    return { applied: false, reason, orderId: order.id };
  }

  // --- ODZ tag rule ---------------------------------------------------------
  // An `ODZ` tag on the Pancake order means "out of delivery zone" and wins over
  // whatever the status map would otherwise resolve to. Recorded with source
  // `tag_rule` so the history shows why the status moved.
  const odzTagged = hasOdzTag(update.tags);

  // Unknown incoming status: do NOT touch the lead; surface for review (Section 5).
  const statusMap = await listStatusMap();
  const mappedStatus = mapStatus(update.rawStatus, statusMap);
  const internalStatus = odzTagged ? "odz" : mappedStatus;
  const effectiveSource: PancakeSyncSource = odzTagged ? "tag_rule" : source;

  // An unmapped status is only a problem when the tag rule has not already
  // decided the outcome.
  if (!internalStatus) {
    const reason = `Unknown Pancake status "${update.rawStatus}" — lead untouched, mapping needed.`;
    // The outbound sync succeeded; only the mapping is missing, so the sync
    // status is left alone and the raw Pancake status is still recorded.
    await updateOrderSyncFields(order.id, { pancake_status: update.rawStatus, pancake_sync_error: reason });
    await insertSyncLog({ ...base, order_id: order.id, old_status: order.status, new_status: update.rawStatus, result: "failed", error_message: reason });
    await notifyAdministrators(
      "pancake_needs_review",
      `Unknown Pancake status: "${update.rawStatus}"`,
      `Order ${order.order_number} received an unmapped status. Add it at Settings → Integrations → Status Map.`,
      "/settings/integrations/status-map"
    );
    return { applied: false, reason, orderId: order.id };
  }

  // Nothing changed. This is the common case when polling — Pancake keeps
  // reporting the same status — so it is recorded quietly and, crucially,
  // BEFORE the out-of-order check: an unchanged order's updated_at is always
  // older than our own synced-at stamp, and treating that as an anomaly would
  // write a failure row on every single poll.
  if (internalStatus === order.status) {
    await updateOrderSyncFields(order.id, {
      pancake_status: update.statusName || update.rawStatus,
      ...(update.trackingNumber ? { tracking_number: update.trackingNumber } : {}),
      ...(update.courier ? { courier: update.courier } : {}),
      pancake_sync_status: "synced",
      pancake_synced_at: new Date().toISOString(),
      pancake_event_at: update.eventTimestamp || order.pancake_event_at,
      pancake_sync_error: null,
    });
    return { applied: false, reason: "Status unchanged.", orderId: order.id };
  }

  // Out-of-order protection: an event older than the last one we observed is
  // logged, never applied. Both sides come from PANCAKE's clock — comparing
  // against our own synced-at stamp would reject every genuine update, since
  // that stamp is written after the event it describes. Strings are parsed to
  // real instants first: Pancake sends a naive timestamp, ours carries an
  // offset, so a string comparison would also give the wrong answer.
  const eventMs = update.eventTimestamp ? Date.parse(update.eventTimestamp) : NaN;
  const lastMs = order.pancake_event_at ? Date.parse(order.pancake_event_at) : NaN;
  if (Number.isFinite(eventMs) && Number.isFinite(lastMs) && eventMs < lastMs) {
    const reason = `Out-of-order event (${update.eventTimestamp} is older than last observed ${order.pancake_event_at}) — logged, not applied.`;
    await insertSyncLog({
      ...base,
      order_id: order.id,
      old_status: order.status,
      new_status: update.rawStatus,
      result: "failed",
      error_message: reason,
    });
    return { applied: false, reason, orderId: order.id };
  }

  // Terminal statuses never move backward automatically; terminal-to-terminal
  // is allowed (with the full log entry below).
  if (TERMINAL.includes(order.status) && !TERMINAL.includes(internalStatus)) {
    const reason = `Refusing automatic move out of terminal status ${order.status} -> ${internalStatus}. An Administrator can override manually.`;
    await insertSyncLog({ ...base, order_id: order.id, old_status: order.status, new_status: internalStatus, result: "failed", error_message: reason });
    await notifyAdministrators(
      "pancake_needs_review",
      `Blocked backward status move: ${order.order_number}`,
      reason,
      `/leads?open=${encodeURIComponent(order.order_number)}`
    );
    return { applied: false, reason, orderId: order.id };
  }

  // Apply: fulfillment status + sync bookkeeping ONLY. Notes, agent
  // assignment, ownership, and every other field are untouchable here.
  const now = new Date().toISOString();
  await updateOrderSyncFields(order.id, {
    status: internalStatus as Order["status"],
    pancake_status: update.statusName || update.rawStatus,
    ...(update.trackingNumber ? { tracking_number: update.trackingNumber } : {}),
    ...(update.courier ? { courier: update.courier } : {}),
    pancake_sync_status: "synced",
    pancake_synced_at: now,
    pancake_event_at: update.eventTimestamp || order.pancake_event_at,
    pancake_sync_error: null,
    updated_at: now,
  });
  await insertSyncLog({
    ...base,
    source: effectiveSource,
    order_id: order.id,
    old_status: order.status,
    new_status: internalStatus,
    response_at: new Date().toISOString(),
    result: "success",
    payload_summary: {
      matched_by: matchedBy,
      raw_status: update.rawStatus,
      event_timestamp: update.eventTimestamp,
      tags: update.tags ?? [],
      ...(odzTagged ? { odz_tag_applied: true } : {}),
      // Written last so hasProcessedEvent() can recognize a repeat delivery.
      ...(key ? { event_key: key } : {}),
    },
  });
  await logActivityDirect(null, "PANCAKE_STATUS_SYNCED", "order", order.id, {
    order_number: order.order_number,
    matched_by: matchedBy,
  }, {
    module: "orders",
    previous_value: { status: order.status },
    updated_value: { status: internalStatus, source: effectiveSource },
  });
  const how = odzTagged ? "ODZ tag rule" : `matched by ${matchedBy}`;
  return { applied: true, reason: `Status ${order.status} -> ${internalStatus} (${how}).`, orderId: order.id };
}
