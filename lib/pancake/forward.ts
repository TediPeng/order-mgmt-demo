import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { PancakeSyncSource } from "@/lib/types";
import { buildForwardPayload } from "./types";
import { createOrder } from "./createOrder";
import {
  getOrderRow,
  listAccounts,
  resolveAccount,
  updateOrderSyncFields,
  insertSyncLog,
  notifyManagement,
  logActivityDirect,
} from "./store";

export interface ForwardResult {
  ok: boolean;
  skipped: boolean;
  message: string;
}

/** Forward-on-Ready-to-Ship (Section 2), also reused by Retry Sync.
 *
 * Guards, in order:
 *  - order must exist and be in ready_to_ship (unless this is a retry of a
 *    failed sync, where the internal status is still ready_to_ship anyway)
 *  - duplicate check: skip when a pancake_order_id already exists or sync is
 *    synced/processing/pending; a plain RTS re-entry never re-forwards, and
 *    a `failed` state only re-forwards when allowRetry is set (Management
 *    retry button / auto-retry cron)
 *  - account resolution: agent -> team -> order_source -> default; nothing
 *    resolves => needs_review + admin notification
 *
 * The internal order id is the idempotency key, so even a double-send cannot
 * duplicate on the Pancake side. */
export async function forwardOrderToPancake(
  orderId: string,
  opts: { source: PancakeSyncSource; triggeredBy?: string | null; allowRetry?: boolean }
): Promise<ForwardResult> {
  const order = await getOrderRow(orderId);
  if (!order) return { ok: false, skipped: true, message: "Order not found." };
  if (order.status !== "ready_to_ship") {
    return { ok: false, skipped: true, message: "Order is not in Ready to Ship." };
  }

  // Duplicate / exactly-once guards.
  if (order.pancake_order_id || order.pancake_sync_status === "synced") {
    return { ok: true, skipped: true, message: "Already forwarded to Pancake — skipped (no duplicate created)." };
  }
  if (order.pancake_sync_status === "processing" || order.pancake_sync_status === "pending") {
    return { ok: true, skipped: true, message: "A forward attempt is already in flight — skipped." };
  }
  if (order.pancake_sync_status === "failed" && !opts.allowRetry) {
    return { ok: false, skipped: true, message: "Previous forward failed — use Retry Sync (Management) or wait for auto-retry." };
  }
  if (order.pancake_sync_status === "needs_review" && !opts.allowRetry) {
    return { ok: false, skipped: true, message: "Order is in Needs Review — resolve it from the integration settings." };
  }

  // Pancake requires items[].variation_id (its own catalog id, or the SKU) on
  // every order line, so the product must be mapped first. Failing here keeps
  // the bad payload out of Pancake and gives Management something actionable.
  const { data: product } = await supabaseAdmin
    .from("products")
    .select("name, code, pancake_variation_id")
    .eq("id", order.product_id || "")
    .maybeSingle();
  const variationId = (product?.pancake_variation_id || product?.code || "").trim();
  if (!variationId) {
    const reason = product
      ? `Product "${product.name}" has no Pancake variation ID. Set it under Products → ${product.name} → Pancake variation ID / SKU.`
      : "This lead has no product selected, so there is nothing to send to Pancake.";
    await updateOrderSyncFields(order.id, { pancake_sync_status: "needs_review", pancake_sync_error: reason });
    await insertSyncLog({
      order_id: order.id,
      action: "forward",
      old_status: order.status,
      request_at: new Date().toISOString(),
      result: "failed",
      error_message: reason,
      triggered_by: opts.triggeredBy ?? null,
      source: opts.source,
    });
    await notifyManagement(
      "pancake_needs_review",
      `Pancake sync needs review: ${order.order_number}`,
      reason,
      `/leads?open=${encodeURIComponent(order.order_number)}`
    );
    return { ok: false, skipped: false, message: reason };
  }

  // Resolve the receiving account.
  const { data: agentProfile } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, username, team_lead_id")
    .eq("id", order.agent_id)
    .maybeSingle();
  const accounts = await listAccounts();
  const account = resolveAccount(accounts, order, (agentProfile?.team_lead_id as string) || null);

  if (!account) {
    await updateOrderSyncFields(order.id, {
      pancake_sync_status: "needs_review",
      pancake_sync_error:
        "No Pancake account resolved for this order. Assign an account to the agent/team/order source, or mark exactly one active account as Default (Settings → Integrations).",
    });
    await insertSyncLog({
      order_id: order.id,
      action: "forward",
      old_status: order.status,
      request_at: new Date().toISOString(),
      result: "failed",
      error_message: "No Pancake account resolved (agent → team → order source → default all empty).",
      triggered_by: opts.triggeredBy ?? null,
      source: opts.source,
    });
    await notifyManagement(
      "pancake_needs_review",
      `Pancake sync needs review: ${order.order_number}`,
      "No Pancake POS account could be resolved for this order. Configure an assignment or a default account.",
      `/leads?open=${encodeURIComponent(order.order_number)}`
    );
    return { ok: false, skipped: false, message: "No Pancake account resolved — marked Needs Review." };
  }

  const requestAt = new Date().toISOString();
  const attempt = order.pancake_sync_attempts + 1;
  // updated_at doubles as the "processing since" marker the sweep uses to
  // release orders whose forward was killed mid-flight (see listOrdersStuckProcessing).
  await updateOrderSyncFields(order.id, {
    pancake_sync_status: "processing",
    pancake_pos_account_id: account.id,
    pancake_sync_attempts: attempt,
    updated_at: requestAt,
  });

  const payload = buildForwardPayload(
    order,
    (agentProfile?.full_name as string) || "",
    (agentProfile?.username as string) || order.assigned_agent_email,
    variationId
  );
  const result = await createOrder(account, payload);
  const responseAt = new Date().toISOString();

  if (result.ok && result.pancakeOrderId) {
    await updateOrderSyncFields(order.id, {
      pancake_order_id: result.pancakeOrderId,
      pancake_sync_status: "synced",
      pancake_last_synced_at: responseAt,
      pancake_sync_error: null,
      forwarded_to_pancake_at: responseAt,
    });
    await insertSyncLog({
      order_id: order.id,
      pancake_order_id: result.pancakeOrderId,
      pancake_account_id: account.id,
      action: opts.allowRetry ? "retry" : "forward",
      old_status: order.status,
      new_status: order.status,
      request_at: requestAt,
      response_at: responseAt,
      http_status: result.httpStatus,
      result: "success",
      triggered_by: opts.triggeredBy ?? null,
      source: opts.source,
      payload_summary: { external_reference: order.id, order_number: order.order_number, account: account.account_name },
    });
    await logActivityDirect(opts.triggeredBy ?? null, "PANCAKE_ORDER_FORWARDED", "order", order.id, {
      order_number: order.order_number,
      pancake_order_id: result.pancakeOrderId,
      account: account.account_name,
    });
    return { ok: true, skipped: false, message: `Forwarded to Pancake (${result.pancakeOrderId}).` };
  }

  // Failure: internal status STAYS Ready to Ship; only sync state changes.
  const errorMsg = result.error || "Unknown Pancake API error";
  await updateOrderSyncFields(order.id, {
    pancake_sync_status: "failed",
    pancake_sync_error: errorMsg,
  });
  await insertSyncLog({
    order_id: order.id,
    pancake_account_id: account.id,
    action: opts.allowRetry ? "retry" : "forward",
    old_status: order.status,
    request_at: requestAt,
    response_at: responseAt,
    http_status: result.httpStatus,
    result: "failed",
    error_message: errorMsg,
    triggered_by: opts.triggeredBy ?? null,
    source: opts.source,
    payload_summary: { external_reference: order.id, order_number: order.order_number, account: account.account_name },
  });
  await notifyManagement(
    "pancake_sync_failed",
    `Pancake forward failed: ${order.order_number}`,
    `Attempt ${attempt}: ${errorMsg}. Auto-retry is scheduled; you can also use Retry Sync.`,
    `/leads?open=${encodeURIComponent(order.order_number)}`
  );
  return { ok: false, skipped: false, message: `Forward failed: ${errorMsg}` };
}
