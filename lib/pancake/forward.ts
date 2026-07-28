import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { Order, PancakeSyncSource } from "@/lib/types";
import { buildForwardPayload } from "./types";
import { createOrder } from "./createOrder";
import { CREATE_STATUS_PACKAGING_LABEL } from "./config";
import { validateForPancake } from "./validate";
import {
  claimOrderForSync,
  getOrderRow,
  hasSuccessfulForward,
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
  /** Present when the order already had one — lets callers echo it back. */
  pancakeOrderId?: string | null;
  /** Per-field problems from the pre-send validation, when that is what failed. */
  fieldErrors?: { field: string; message: string }[];
}

/** Records a terminal failure: internal status stays Ready to Ship, only the
 * sync state moves. Shared by every failure path so none of them can leave an
 * order stranded in `syncing`. */
async function failSync(
  order: Order,
  reason: string,
  opts: { source: PancakeSyncSource; triggeredBy?: string | null; allowRetry?: boolean },
  extra: {
    accountId?: string | null;
    httpStatus?: number | null;
    requestAt?: string;
    responseAt?: string | null;
    requestPayload?: Record<string, unknown> | null;
    responsePayload?: Record<string, unknown> | null;
    notify?: boolean;
  } = {}
): Promise<void> {
  await updateOrderSyncFields(order.id, {
    pancake_sync_status: "sync_failed",
    pancake_sync_error: reason,
    ...(extra.requestPayload !== undefined ? { pancake_request_payload: extra.requestPayload } : {}),
    ...(extra.responsePayload !== undefined ? { pancake_response_payload: extra.responsePayload } : {}),
  });
  await insertSyncLog({
    order_id: order.id,
    pancake_account_id: extra.accountId ?? null,
    action: opts.allowRetry ? "retry" : "forward",
    old_status: order.status,
    request_at: extra.requestAt ?? new Date().toISOString(),
    response_at: extra.responseAt ?? null,
    http_status: extra.httpStatus ?? null,
    result: "failed",
    error_message: reason,
    triggered_by: opts.triggeredBy ?? null,
    source: opts.source,
    payload_summary: { order_number: order.order_number, system_order_id: order.system_order_id },
  });
  if (extra.notify !== false) {
    await notifyManagement(
      "pancake_sync_failed",
      `Pancake sync failed: ${order.order_number}`,
      reason,
      `/leads?open=${encodeURIComponent(order.order_number)}`
    );
  }
}

/** Sends a Ready-to-Ship order to Pancake POS. Also used by Retry Sync.
 *
 * The Ready-to-Ship check lives HERE, not only in the callers: this service is
 * the single place an order can leave for Pancake, so no other status can ever
 * be sent regardless of who calls it.
 *
 * Exactly-once rests on three things: the pre-send duplicate check, the
 * atomic claim (only one caller can flip an order to `syncing`), and
 * `system_order_id` travelling as the external reference on every create. */
export async function forwardOrderToPancake(
  orderId: string,
  opts: { source: PancakeSyncSource; triggeredBy?: string | null; allowRetry?: boolean }
): Promise<ForwardResult> {
  const order = await getOrderRow(orderId);
  if (!order) return { ok: false, skipped: true, message: "Order not found." };

  // Hard guard: only Ready to Ship is ever sent.
  if (order.status !== "ready_to_ship") {
    return { ok: false, skipped: true, message: "Only Ready to Ship orders are sent to Pancake POS." };
  }

  // --- Duplicate prevention -------------------------------------------------
  if (order.pancake_order_id) {
    return {
      ok: true,
      skipped: true,
      message: `This order has already been synced to Pancake POS (Order ID: ${order.pancake_order_id}).`,
      pancakeOrderId: order.pancake_order_id,
    };
  }
  if (order.pancake_sync_status === "synced") {
    return { ok: true, skipped: true, message: "This order has already been synced to Pancake POS." };
  }
  if (order.pancake_sync_status === "syncing") {
    return { ok: true, skipped: true, message: "A sync is already in progress for this order." };
  }
  if (order.pancake_sync_status === "sync_failed" && !opts.allowRetry) {
    return { ok: false, skipped: true, message: "Previous sync failed — use Retry Sync, or wait for the automatic retry." };
  }
  if (await hasSuccessfulForward(order.id)) {
    return { ok: true, skipped: true, message: "A successful sync is already recorded for this order — not sending again." };
  }

  // --- Pre-send validation --------------------------------------------------
  const validation = validateForPancake(order);
  if (!validation.ok) {
    const reason = `Missing required Pancake fields: ${validation.errors.map((e) => e.message).join(", ")}`;
    await failSync(order, reason, opts, { notify: false });
    return { ok: false, skipped: false, message: reason, fieldErrors: validation.errors };
  }

  // --- Account resolution ---------------------------------------------------
  const { data: agentProfile } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, username, team_lead_id")
    .eq("id", order.agent_id)
    .maybeSingle();
  const accounts = await listAccounts();
  const account = resolveAccount(accounts, order, (agentProfile?.team_lead_id as string) || null);

  if (!account) {
    const reason =
      "No Pancake account resolved for this order. Assign an account to the agent/team/order source, or mark exactly one active account as Default (Settings → Integrations).";
    await failSync(order, reason, opts);
    return { ok: false, skipped: false, message: reason };
  }

  // --- Product line ---------------------------------------------------------
  const { data: product } = await supabaseAdmin
    .from("products")
    .select("name, pancake_variation_id")
    .eq("id", order.product_id || "")
    .maybeSingle();
  const variationId = (product?.pancake_variation_id || "").trim();
  const oneTimeProduct = !variationId && account.use_one_time_products;

  if (!variationId && !oneTimeProduct) {
    const reason = `Product "${product?.name || order.product_name}" has no Pancake variation ID. Map it under Products, or enable quick-add products on the ${account.account_name} account.`;
    await failSync(order, reason, opts, { accountId: account.id });
    return { ok: false, skipped: false, message: reason };
  }

  // --- Claim (concurrency guard) -------------------------------------------
  const requestAt = new Date().toISOString();
  const claimed = await claimOrderForSync(order.id, {
    pancake_pos_account_id: account.id,
    pancake_retry_count: order.pancake_retry_count + 1,
    attemptAt: requestAt,
  });
  if (!claimed) {
    return { ok: true, skipped: true, message: "Another sync for this order is already in progress — skipped." };
  }
  const attempt = claimed.pancake_retry_count;

  // --- Send -----------------------------------------------------------------
  const payload = buildForwardPayload(
    order,
    (agentProfile?.full_name as string) || "",
    (agentProfile?.username as string) || order.assigned_agent_email,
    variationId,
    oneTimeProduct
  );
  const result = await createOrder(account, payload);
  const responseAt = new Date().toISOString();

  if (result.ok && result.pancakeOrderId) {
    // Pancake should report the order as Packaging. If it reports something
    // else, the order IS created (id stored verbatim) but the discrepancy is
    // flagged rather than silently accepted.
    const pancakeStatus = result.pancakeStatus || CREATE_STATUS_PACKAGING_LABEL;
    const mismatchReason = result.statusMismatch
      ? `Order created, but Pancake reported status "${pancakeStatus}" instead of ${CREATE_STATUS_PACKAGING_LABEL}.`
      : null;

    await updateOrderSyncFields(order.id, {
      pancake_order_id: result.pancakeOrderId,
      pancake_status: pancakeStatus,
      pancake_sync_status: mismatchReason ? "sync_failed" : "synced",
      pancake_synced_at: responseAt,
      // Anchor the event clock to Pancake's own timestamp, so the first status
      // change they report is not mistaken for an out-of-order event.
      pancake_event_at: result.eventTimestamp,
      pancake_sync_error: mismatchReason,
      forwarded_to_pancake_at: responseAt,
      pancake_request_payload: result.requestPayload,
      pancake_response_payload: result.responsePayload,
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
      result: mismatchReason ? "failed" : "success",
      error_message: mismatchReason,
      triggered_by: opts.triggeredBy ?? null,
      source: opts.source,
      payload_summary: {
        system_order_id: payload.system_order_id,
        order_number: order.order_number,
        account: account.account_name,
        pancake_status: pancakeStatus,
      },
    });
    await logActivityDirect(opts.triggeredBy ?? null, "PANCAKE_ORDER_SYNCED", "order", order.id, {
      order_number: order.order_number,
      pancake_order_id: result.pancakeOrderId,
      pancake_status: pancakeStatus,
      account: account.account_name,
    });

    if (mismatchReason) {
      await notifyManagement(
        "pancake_sync_failed",
        `Pancake status unexpected: ${order.order_number}`,
        mismatchReason,
        `/leads?open=${encodeURIComponent(order.order_number)}`
      );
      return { ok: false, skipped: false, message: mismatchReason, pancakeOrderId: result.pancakeOrderId };
    }
    return {
      ok: true,
      skipped: false,
      message: `Synced to Pancake POS (Order ID: ${result.pancakeOrderId}).`,
      pancakeOrderId: result.pancakeOrderId,
    };
  }

  const errorMsg = result.error || "Unknown Pancake API error";
  await failSync(order, errorMsg, opts, {
    accountId: account.id,
    httpStatus: result.httpStatus,
    requestAt,
    responseAt,
    requestPayload: result.requestPayload,
    responsePayload: result.responsePayload,
    notify: false,
  });
  await notifyManagement(
    "pancake_sync_failed",
    `Pancake sync failed: ${order.order_number}`,
    `Attempt ${attempt}: ${errorMsg}. An automatic retry is scheduled; Retry Sync is also available.`,
    `/leads?open=${encodeURIComponent(order.order_number)}`
  );
  return { ok: false, skipped: false, message: `Sync failed: ${errorMsg}` };
}
