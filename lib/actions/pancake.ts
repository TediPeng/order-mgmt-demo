"use server";

import { redirect } from "next/navigation";
import { v4 as uuid } from "uuid";
import { requireUserLite, requirePermission } from "./guards";
import { getRequestInfo } from "@/lib/request-info";
import { logActivity } from "@/lib/activity";
import { writeDb } from "@/lib/db";
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
} from "@/lib/pancake/store";
import { LEAD_STATUSES } from "@/lib/validation";
import type { PancakeAccount, Profile } from "@/lib/types";

const SETTINGS_PATH = "/settings/integrations";

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
