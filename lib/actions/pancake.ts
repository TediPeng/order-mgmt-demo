"use server";

import { redirect } from "next/navigation";
import { v4 as uuid } from "uuid";
import { requireUserLite, requirePermission } from "./guards";
import { getRequestInfo } from "@/lib/request-info";
import { logActivity } from "@/lib/activity";
import { writeDb, nowIso, loadOrderInto } from "@/lib/db";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { RETRY_BATCH } from "@/lib/pancake/config";
import { encryptSecret } from "@/lib/pancake/crypto";
import { testConnection } from "@/lib/pancake/client";
import { forwardOrderToPancake } from "@/lib/pancake/forward";
import { applyIncomingUpdate } from "@/lib/pancake/receive";
import { getOrder } from "@/lib/pancake/getOrder";
import {
  getAccount,
  insertAccount,
  updateAccount,
  deleteAccount,
  listAccounts,
  listStatusMap,
  upsertStatusMapEntry,
  deleteStatusMapEntry,
  getOrderRow,
  insertSyncLog,
  updateOrderSyncFields,
} from "@/lib/pancake/store";
import { LEAD_STATUSES } from "@/lib/validation";
import type { PancakeAccount, Profile } from "@/lib/types";

const SETTINGS_PATH = "/settings/integrations";
const FAILED_PATH = "/settings/integrations/failed";

// All integration management is Management-only ("integrations" module in the
// roles matrix; full-access roles bypass, nothing is granted by default).

function redirectError(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

async function audit(user: Profile, action: string, entityId: string | null, details: Record<string, unknown>) {
  // Values in `details` must already be redacted by the caller — never
  // plaintext or encrypted secrets.
  const { user: u, db } = { user, db: await (await import("@/lib/db")).readDb() };
  const info = await getRequestInfo();
  logActivity(db, u.id, action, "pancake_account", entityId, details, { module: "integrations", ...info });
  await writeDb(db);
}

/** Clears the default flag on every other account so exactly one active
 * default exists (a partial unique index backs this at the DB level). */
async function clearOtherDefaults(exceptId: string) {
  const accounts = await listAccounts();
  for (const a of accounts) {
    if (a.id !== exceptId && a.is_default) await updateAccount(a.id, { is_default: false });
  }
}

export async function createPancakeAccountAction(formData: FormData) {
  const { user, db } = await requireUserLite();
  requirePermission(user, "integrations", "manage", db, SETTINGS_PATH);

  const account_name = String(formData.get("account_name") || "").trim();
  const shop_or_page_id = String(formData.get("shop_or_page_id") || "").trim();
  const api_endpoint = String(formData.get("api_endpoint") || "").trim();
  const api_key = String(formData.get("api_key") || "").trim();
  const webhook_secret = String(formData.get("webhook_secret") || "").trim();
  if (!account_name || !shop_or_page_id || !api_endpoint || !api_key) {
    redirectError(SETTINGS_PATH, "Account name, Shop/Page ID, API endpoint, and API key are required.");
  }

  let api_key_encrypted: string, webhook_secret_encrypted: string | null;
  try {
    api_key_encrypted = encryptSecret(api_key);
    webhook_secret_encrypted = webhook_secret ? encryptSecret(webhook_secret) : null;
  } catch (e) {
    redirectError(SETTINGS_PATH, (e as Error).message);
  }

  const account: PancakeAccount = {
    id: uuid(),
    account_name,
    shop_or_page_id,
    api_endpoint,
    api_key_encrypted,
    webhook_secret_encrypted,
    assigned_agent_id: String(formData.get("assigned_agent_id") || "") || null,
    assigned_team_lead_id: String(formData.get("assigned_team_lead_id") || "") || null,
    assigned_order_source: String(formData.get("assigned_order_source") || "").trim() || null,
    is_default: formData.get("is_default") === "on",
    is_active: formData.get("is_active") !== "off",
    use_one_time_products: formData.get("use_one_time_products") !== "off",
    default_payment_method: String(formData.get("default_payment_method") || "").trim() || null,
    default_shipping_fee: formData.get("default_shipping_fee") !== null && String(formData.get("default_shipping_fee")).trim() !== ""
      ? Number(formData.get("default_shipping_fee"))
      : null,
    default_courier: String(formData.get("default_courier") || "").trim() || null,

    created_by: user.id,
    created_at: new Date().toISOString(),
    updated_at: null,
  };
  if (account.is_default) await clearOtherDefaults(account.id);
  await insertAccount(account);
  await audit(user, "PANCAKE_ACCOUNT_CREATED", account.id, {
    account_name,
    shop_or_page_id,
    api_endpoint,
    credentials: "[REDACTED]",
  });
  redirect(`${SETTINGS_PATH}?saved=1`);
}

export async function updatePancakeAccountAction(accountId: string, formData: FormData) {
  const { user, db } = await requireUserLite();
  requirePermission(user, "integrations", "manage", db, SETTINGS_PATH);

  const existing = await getAccount(accountId);
  if (!existing) redirectError(SETTINGS_PATH, "Account not found.");

  const fields: Partial<PancakeAccount> = {
    account_name: String(formData.get("account_name") || "").trim() || existing.account_name,
    shop_or_page_id: String(formData.get("shop_or_page_id") || "").trim() || existing.shop_or_page_id,
    api_endpoint: String(formData.get("api_endpoint") || "").trim() || existing.api_endpoint,
    assigned_agent_id: String(formData.get("assigned_agent_id") || "") || null,
    assigned_team_lead_id: String(formData.get("assigned_team_lead_id") || "") || null,
    assigned_order_source: String(formData.get("assigned_order_source") || "").trim() || null,
    is_default: formData.get("is_default") === "on",
    is_active: formData.get("is_active") === "on",
    use_one_time_products: formData.get("use_one_time_products") === "on",
    default_payment_method: String(formData.get("default_payment_method") || "").trim() || null,
    default_shipping_fee: formData.get("default_shipping_fee") !== null && String(formData.get("default_shipping_fee")).trim() !== ""
      ? Number(formData.get("default_shipping_fee"))
      : null,
    default_courier: String(formData.get("default_courier") || "").trim() || null,

    updated_at: new Date().toISOString(),
  };

  // Re-enter-to-change: blank secret fields keep the stored (encrypted) value.
  const api_key = String(formData.get("api_key") || "").trim();
  const webhook_secret = String(formData.get("webhook_secret") || "").trim();
  const changedSecrets: string[] = [];
  try {
    if (api_key) {
      fields.api_key_encrypted = encryptSecret(api_key);
      changedSecrets.push("api_key");
    }
    if (webhook_secret) {
      fields.webhook_secret_encrypted = encryptSecret(webhook_secret);
      changedSecrets.push("webhook_secret");
    }
  } catch (e) {
    redirectError(SETTINGS_PATH, (e as Error).message);
  }

  if (fields.is_default && fields.is_active) await clearOtherDefaults(accountId);
  await updateAccount(accountId, fields);
  await audit(user, "PANCAKE_ACCOUNT_UPDATED", accountId, {
    account_name: fields.account_name,
    is_default: fields.is_default,
    is_active: fields.is_active,
    secrets_changed: changedSecrets.length > 0 ? changedSecrets : "none",
    credentials: "[REDACTED]",
  });
  redirect(`${SETTINGS_PATH}?saved=1`);
}

export async function deletePancakeAccountAction(accountId: string) {
  const { user, db } = await requireUserLite();
  requirePermission(user, "integrations", "manage", db, SETTINGS_PATH);
  const existing = await getAccount(accountId);
  if (!existing) redirectError(SETTINGS_PATH, "Account not found.");
  try {
    await deleteAccount(accountId);
  } catch {
    // FK from orders/sync logs: deactivate instead of hard delete.
    await updateAccount(accountId, { is_active: false, is_default: false, updated_at: new Date().toISOString() });
    await audit(user, "PANCAKE_ACCOUNT_DEACTIVATED", accountId, { account_name: existing.account_name });
    redirect(`${SETTINGS_PATH}?saved=1&note=deactivated`);
  }
  await audit(user, "PANCAKE_ACCOUNT_DELETED", accountId, { account_name: existing.account_name });
  redirect(`${SETTINGS_PATH}?saved=1`);
}

export async function testPancakeConnectionAction(accountId: string) {
  const { user, db } = await requireUserLite();
  requirePermission(user, "integrations", "manage", db, SETTINGS_PATH);
  const account = await getAccount(accountId);
  if (!account) redirectError(SETTINGS_PATH, "Account not found.");
  const result = await testConnection(account);
  await audit(user, "PANCAKE_CONNECTION_TESTED", accountId, { account_name: account.account_name, ok: result.ok });
  redirect(
    `${SETTINGS_PATH}?${result.ok ? "tested" : "error"}=${encodeURIComponent(
      `${account.account_name}: ${result.message}`
    )}`
  );
}

// --- Status map -------------------------------------------------------------

const STATUS_MAP_PATH = "/settings/integrations/status-map";

export async function saveStatusMapEntryAction(formData: FormData) {
  const { user, db } = await requireUserLite();
  requirePermission(user, "integrations", "manage", db, STATUS_MAP_PATH);

  const id = String(formData.get("id") || "") || uuid();
  const pancake_status = String(formData.get("pancake_status") || "").trim();
  const internal_status = String(formData.get("internal_status") || "").trim();
  if (!pancake_status) redirectError(STATUS_MAP_PATH, "Pancake status code is required.");
  if (!(LEAD_STATUSES as readonly string[]).includes(internal_status)) {
    redirectError(STATUS_MAP_PATH, "Internal status must be a valid lead status.");
  }
  const duplicate = (await listStatusMap()).find((m) => m.pancake_status === pancake_status && m.id !== id);
  if (duplicate) redirectError(STATUS_MAP_PATH, `"${pancake_status}" is already mapped.`);

  await upsertStatusMapEntry({
    id,
    pancake_status,
    internal_status,
    is_active: formData.get("is_active") === "on",
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  });
  await audit(user, "PANCAKE_STATUS_MAP_SAVED", id, { pancake_status, internal_status });
  redirect(`${STATUS_MAP_PATH}?saved=1`);
}

export async function deleteStatusMapEntryAction(id: string) {
  const { user, db } = await requireUserLite();
  requirePermission(user, "integrations", "manage", db, STATUS_MAP_PATH);
  await deleteStatusMapEntry(id);
  await audit(user, "PANCAKE_STATUS_MAP_DELETED", id, {});
  redirect(`${STATUS_MAP_PATH}?saved=1`);
}

// --- Per-order manual sync (used by the API route behind the popup buttons) --

/** A clock as well as the count, because the count alone cannot know how slow Pancake is being
 * today. Whatever has not been started by this point is left for the next press
 * — reported on screen, rather than discovered when the request dies. The first
 * order always runs, so a single Retry is never a no-op. */
const RETRY_TIME_BUDGET_MS = 40_000;

/** Re-sends a set of failed orders — the Sync Failed queue's Retry All.
 *
 * Serial, like the sweep: these are calls to somebody else's API and a burst of
 * twenty parallel forwards is how a rate limit gets found. */
export async function retryFailedSyncsAction(orderIds: string[]) {
  const { user, db } = await requireUserLite();
  requirePermission(user, "integrations", "manage", db, FAILED_PATH);

  const startedAt = Date.now();
  let attempted = 0;
  let fixed = 0;
  for (const id of orderIds.slice(0, RETRY_BATCH)) {
    if (attempted > 0 && Date.now() - startedAt > RETRY_TIME_BUDGET_MS) break;
    attempted++;
    try {
      const result = await forwardOrderToPancake(id, {
        source: "manual_sync",
        triggeredBy: user.id,
        allowRetry: true,
      });
      if (result.ok) fixed++;
    } catch {
      // One order that throws is one order's problem. Uncaught, it took the
      // whole batch down and the page with it, so the orders already sent were
      // reported as an application error. The failure is on the order's own
      // sync log either way; here it is simply not counted as fixed.
    }
  }

  redirect(
    `${FAILED_PATH}?retried=${attempted}&fixed=${fixed}&left=${Math.max(0, orderIds.length - attempted)}`
  );
}

/**
 * Sends an order the repeat-buyer hold is refusing, against that hold.
 *
 * The hold is right about the common case and wrong about two the floor meets
 * weekly. A parcel that has genuinely been delivered but whose Pancake status
 * has not caught up still reads as in flight. And a customer who wants two
 * parcels on purpose — one for herself, one for her sister, ordered in the same
 * breath — is not a double-submit, however identical the two orders look from
 * here.
 *
 * No rule settles those, because the fact that decides them is in neither
 * system: it is what the customer said on the phone. Retry cannot help either —
 * it asks Pancake the same question and gets the same answer, which is why
 * these orders sat in the queue being retried every ten minutes for days.
 *
 * So it is a person overruling it for one send, and the shape is deliberately
 * the one already used for resolving without syncing: same permission, a
 * written reason of at least five characters, the same audit trail. An order
 * that went out against the hold is precisely the one somebody will ask about
 * if two parcels do turn up.
 */
export async function sendHeldOrderAnywayAction(orderId: string, formData: FormData) {
  const { user, db } = await requireUserLite();
  requirePermission(user, "integrations", "manage", db, FAILED_PATH);

  const reason = String(formData.get("reason") || "").trim();
  if (reason.length < 5) {
    redirect(`${FAILED_PATH}?error=${encodeURIComponent("Give a reason of at least 5 characters.")}`);
  }

  const order = await loadOrderInto(db, orderId);
  if (!order) redirect(`${FAILED_PATH}?error=${encodeURIComponent("Order not found.")}`);

  logActivity(db, user.id, "PANCAKE_HOLD_OVERRIDDEN", "order", orderId, {
    order_number: order!.order_number,
    reason,
  }, { module: "integrations", ...(await getRequestInfo()) });
  await writeDb(db);

  const result = await forwardOrderToPancake(orderId, {
    source: "manual_sync",
    triggeredBy: user.id,
    allowRetry: true,
    overrideRepeatHold: true,
  });

  // The override only lifts the hold. Everything else that can refuse an order
  // still can — a missing address id, an unmapped product — so the answer is
  // reported rather than assumed.
  if (!result.ok) {
    redirect(`${FAILED_PATH}?error=${encodeURIComponent(result.message)}`);
  }
  redirect(`${FAILED_PATH}?sent=${encodeURIComponent(order!.order_number)}`);
}

/**
 * Detaches an order from a Pancake order that is dead, so it can be sent again.
 *
 * Forwarding refuses anything that already carries a pancake_order_id, and it
 * is right to: a second send is a second parcel. But the link can outlive the
 * order it points at. Pancake cancels one — 24984 was cancelled two hours after
 * it was created — and ROMA is then holding a reference to something nobody can
 * fulfil, with no way to raise the order again except by retyping it as a new
 * lead and losing its history.
 *
 * So the link is cleared rather than the guard loosened. The old id goes into
 * the sync log and the activity log, because "which Pancake order did this use
 * to be" is the first question anybody will ask afterwards.
 *
 * It does NOT send. The order goes back to not_synced and is forwarded the
 * ordinary way, by entering Packaging — the same path, the same validation, the
 * same repeat-buyer check. Sending from here would skip all of it.
 *
 * The retry counter is reset with the link, and that part is not cosmetic:
 * above zero, the pre-send check hunts for a recent Pancake order matching this
 * phone and total and adopts it rather than creating one. It would find the
 * cancelled order and re-attach the very link this just removed.
 */
export async function detachFromPancakeOrderAction(formData: FormData) {
  const { user, db } = await requireUserLite();
  requirePermission(user, "integrations", "manage", db, FAILED_PATH);

  // The order comes from the form rather than a bound argument: the popup is a
  // client component rendering whichever order is open, so one action passed
  // down beats a closure per row.
  const orderId = String(formData.get("order_id") || "");
  const reason = String(formData.get("reason") || "").trim();
  if (reason.length < 5) {
    redirect(`/leads?open_id=${orderId}&error=${encodeURIComponent("Give a reason of at least 5 characters.")}`);
  }

  const order = await loadOrderInto(db, orderId);
  if (!order) redirect(`/leads?error=${encodeURIComponent("Order not found.")}`);

  const previousId = order!.pancake_order_id;
  if (!previousId) {
    redirect(`/leads?open_id=${orderId}&error=${encodeURIComponent("This order is not linked to a Pancake order.")}`);
  }

  await updateOrderSyncFields(orderId, {
    pancake_order_id: null,
    pancake_status: null,
    pancake_sync_status: "not_synced",
    pancake_sync_error: null,
    pancake_retry_count: 0,
    forwarded_to_pancake_at: null,
  });

  await insertSyncLog({
    order_id: orderId,
    pancake_order_id: previousId,
    action: "unlinked",
    result: "success",
    request_at: new Date().toISOString(),
    source: "internal_user",
    error_message: `Unlinked from Pancake order ${previousId} by ${user.full_name}: ${reason}`,
    payload_summary: { note: "Order detached so it can be sent to Pancake as a new order", previous_pancake_order_id: previousId },
  });

  logActivity(db, user.id, "PANCAKE_ORDER_UNLINKED", "order", orderId, {
    order_number: order!.order_number,
    previous_pancake_order_id: previousId,
    reason,
  }, { module: "integrations", ...(await getRequestInfo()) });
  await writeDb(db);

  redirect(`/leads?open_id=${orderId}&unlinked=${encodeURIComponent(previousId!)}`);
}

export async function manualRetrySync(user: Profile, orderId: string): Promise<{ ok: boolean; message: string }> {
  const result = await forwardOrderToPancake(orderId, { source: "manual_sync", triggeredBy: user.id, allowRetry: true });
  return { ok: result.ok, message: result.message };
}

export async function manualSyncNow(user: Profile, orderId: string): Promise<{ ok: boolean; message: string }> {
  const order = await getOrderRow(orderId);
  if (!order) return { ok: false, message: "Order not found." };
  if (!order.pancake_order_id || !order.pancake_pos_account_id) {
    return { ok: false, message: "Order has not been forwarded to Pancake yet — nothing to sync." };
  }
  const account = await getAccount(order.pancake_pos_account_id);
  if (!account) return { ok: false, message: "The Pancake account for this order no longer exists." };

  const requestAt = new Date().toISOString();
  const res = await getOrder(account, order);
  if (!res.ok) {
    await insertSyncLog({
      order_id: order.id,
      pancake_order_id: order.pancake_order_id,
      pancake_account_id: account.id,
      action: "manual_sync",
      source: "manual_sync",
      request_at: requestAt,
      response_at: new Date().toISOString(),
      http_status: res.httpStatus,
      result: "failed",
      error_message: res.error,
      triggered_by: user.id,
    });
    return { ok: false, message: res.error || "Sync failed." };
  }
  const applied = await applyIncomingUpdate(
    {
      pancakeOrderId: order.pancake_order_id,
      externalReference: order.id,
      orderNumber: order.order_number,
      phone: null,
      rawStatus: res.rawStatus,
      statusName: res.statusName,
      // Manual Sync was dropping everything but the status, so a manual sync
      // could neither pick up courier/tracking nor fire the ODZ tag rule.
      trackingNumber: res.trackingNumber,
      courier: res.courier,
      tags: res.tags,
      eventTimestamp: res.eventTimestamp,
      shopId: account.shop_or_page_id,
    },
    "manual_sync",
    account.id
  );
  return { ok: true, message: applied.applied ? applied.reason : `Up to date (${applied.reason})` };
}

/**
 * The three ways a person closes a sync failure that a retry cannot.
 *
 * Retry asks Pancake again, and for the duplicate-hold group that is exactly
 * what must not happen: more than one Pancake order matches the phone and total,
 * so sending again risks a second shipment. The queue had only that one button,
 * so those orders sat in it — four of them since 10 August — with no way to say
 * what had been found in Pancake.
 *
 * None of the three deletes anything. An order is a sale that has been counted;
 * what changes is what this system believes about where it lives.
 */

/** "I found it in Pancake — this is its number."
 *
 * The correct ending for a duplicate hold that turns out to be already sent.
 * The two systems agree afterwards, the order leaves the queue as synced rather
 * than as an exception, and the id is the one people quote. */
export async function linkExistingPancakeOrderAction(orderId: string, formData: FormData) {
  const { user, db } = await requireUserLite();
  requirePermission(user, "integrations", "manage", db, FAILED_PATH);

  const pancakeOrderId = String(formData.get("pancake_order_id") || "").trim();
  if (!pancakeOrderId) {
    redirect(`${FAILED_PATH}?error=${encodeURIComponent("Enter the Pancake order number.")}`);
  }

  const order = await loadOrderInto(db, orderId);
  if (!order) redirect(`${FAILED_PATH}?error=${encodeURIComponent("Order not found.")}`);

  // Two of ours pointing at one Pancake order is the thing this whole guard
  // exists to prevent, so it is refused here too rather than only on the way out.
  const { data: clash } = await supabaseAdmin
    .from("orders")
    .select("order_number")
    .eq("pancake_order_id", pancakeOrderId)
    .neq("id", orderId)
    .maybeSingle();
  if (clash) {
    redirect(
      `${FAILED_PATH}?error=${encodeURIComponent(
        `Pancake order ${pancakeOrderId} is already linked to ${clash.order_number}.`
      )}`
    );
  }

  await updateOrderSyncFields(orderId, {
    pancake_order_id: pancakeOrderId,
    pancake_sync_status: "synced",
    pancake_sync_error: null,
    pancake_synced_at: nowIso(),
    // Linking asserts the order IS in Pancake — that is the whole point of the
    // action. Without this it was only half-asserted: applyIncomingUpdate()
    // refuses any update for an order with no forwarded_to_pancake_at, so a
    // linked order accepted its Pancake id, went green as Synced, and then
    // ignored every status Pancake ever sent it. Four orders linked on 16
    // August sat frozen at Packaging for six days while polling rejected their
    // updates 10,365 times — a quarter of all Pancake logging in the week.
    //
    // Now, rather than when it actually reached Pancake, which nobody knows:
    // the order was created there by hand, outside this system.
    forwarded_to_pancake_at: nowIso(),
  });

  await insertSyncLog({
    order_id: orderId,
    action: "manual_link",
    result: "success",
    error_message: `Linked by hand to Pancake order ${pancakeOrderId} after duplicate review.`,
    source: "internal_user",
  });

  logActivity(db, user.id, "PANCAKE_ORDER_LINKED", "order", orderId, {
    order_number: order!.order_number,
    pancake_order_id: pancakeOrderId,
  }, { module: "integrations", ...(await getRequestInfo()) });
  await writeDb(db);

  redirect(`${FAILED_PATH}?linked=${encodeURIComponent(order!.order_number)}`);
}

/** "I cancelled the duplicate in Pancake — send this one."
 *
 * Clears the attempt count and the held error so the next retry runs as a first
 * attempt would. It does not send: the person presses Retry when they are ready,
 * which keeps the decision and the sending as two separate acts. */
export async function clearDuplicateHoldAction(orderId: string) {
  const { user, db } = await requireUserLite();
  requirePermission(user, "integrations", "manage", db, FAILED_PATH);

  const order = await loadOrderInto(db, orderId);
  if (!order) redirect(`${FAILED_PATH}?error=${encodeURIComponent("Order not found.")}`);

  await updateOrderSyncFields(orderId, {
    pancake_retry_count: 0,
    pancake_sync_error: null,
  });

  await insertSyncLog({
    order_id: orderId,
    action: "hold_cleared",
    result: "success",
    error_message: "Duplicate hold cleared by hand; attempts reset so a retry can run.",
    source: "internal_user",
  });

  logActivity(db, user.id, "PANCAKE_HOLD_CLEARED", "order", orderId, {
    order_number: order!.order_number,
  }, { module: "integrations", ...(await getRequestInfo()) });
  await writeDb(db);

  redirect(`${FAILED_PATH}?cleared=${encodeURIComponent(order!.order_number)}`);
}

/** "This one is not going to Pancake."
 *
 * Takes the order out of the queue without pretending it synced and without
 * touching the sale. A reason is required: `resolved` is a state only a person
 * can set, so the record has to say who and why. */
export async function resolveWithoutSyncAction(orderId: string, formData: FormData) {
  const { user, db } = await requireUserLite();
  requirePermission(user, "integrations", "manage", db, FAILED_PATH);

  const reason = String(formData.get("reason") || "").trim();
  if (reason.length < 5) {
    redirect(`${FAILED_PATH}?error=${encodeURIComponent("Give a reason of at least 5 characters.")}`);
  }

  const order = await loadOrderInto(db, orderId);
  if (!order) redirect(`${FAILED_PATH}?error=${encodeURIComponent("Order not found.")}`);

  await updateOrderSyncFields(orderId, {
    pancake_sync_status: "resolved",
    pancake_sync_error: `Resolved without syncing: ${reason}`,
  });

  await insertSyncLog({
    order_id: orderId,
    action: "resolved_manually",
    result: "success",
    error_message: `Resolved without syncing by ${user.full_name}: ${reason}`,
    source: "internal_user",
  });

  logActivity(db, user.id, "PANCAKE_SYNC_RESOLVED", "order", orderId, {
    order_number: order!.order_number,
    reason,
  }, { module: "integrations", ...(await getRequestInfo()) });
  await writeDb(db);

  redirect(`${FAILED_PATH}?resolved=${encodeURIComponent(order!.order_number)}`);
}
