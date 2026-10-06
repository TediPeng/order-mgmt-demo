"use server";

import { redirect } from "next/navigation";
import { requireUserLite, requirePermission } from "./guards";
import { getRequestInfo } from "@/lib/request-info";
import { logActivity } from "@/lib/activity";
import { readDb, writeDb } from "@/lib/db";
import { encryptSecret } from "@/lib/pancake/crypto";
import { DEFAULT_API_BASE_URL } from "@/lib/pancake/config";
import { testLogisticsConnection } from "@/lib/logistics/client";
import {
  getConnection,
  insertConnection,
  updateConnection,
  archiveConnection,
  countOrdersForConnection,
} from "@/lib/logistics/store";
import type { Profile } from "@/lib/types";

const CONNECTIONS_PATH = "/logistics/connections";

// Connection management is `logistics.manage` — a different grant from
// `logistics.view`, because this is the side that touches credentials.

function redirectError(message: string): never {
  redirect(`${CONNECTIONS_PATH}?error=${encodeURIComponent(message)}`);
}

async function audit(user: Profile, action: string, entityId: string | null, details: Record<string, unknown>) {
  // `details` must already be redacted by the caller — never a plaintext or
  // encrypted secret, not even a masked one.
  const db = await readDb();
  const info = await getRequestInfo();
  logActivity(db, user.id, action, "logistics_connection", entityId, details, { module: "logistics", ...info });
  await writeDb(db);
}

function readForm(formData: FormData) {
  return {
    connection_name: String(formData.get("connection_name") || "").trim(),
    shop_id: String(formData.get("shop_id") || "").trim(),
    account_label: String(formData.get("account_label") || "").trim() || null,
    api_endpoint: String(formData.get("api_endpoint") || "").trim() || DEFAULT_API_BASE_URL,
    api_key: String(formData.get("api_key") || "").trim(),
    webhook_secret: String(formData.get("webhook_secret") || "").trim(),
    is_enabled: formData.get("is_enabled") !== "off",
    initial_sync_days: Math.max(1, Math.min(365, Number(formData.get("initial_sync_days") || 30) || 30)),
  };
}

export async function createLogisticsConnectionAction(formData: FormData) {
  const { user, db } = await requireUserLite();
  requirePermission(user, "logistics", "manage", db, CONNECTIONS_PATH);

  const form = readForm(formData);
  if (!form.connection_name || !form.shop_id || !form.api_key) {
    redirectError("Connection name, Shop ID and API key are required.");
  }
  // The Shop ID is the number in the POS URL. A Facebook page ID pasted here
  // fails later as an opaque 404 from Pancake, so it is caught at the door.
  if (!/^\d+$/.test(form.shop_id)) {
    redirectError("Shop ID should be the numeric Pancake POS shop ID from the POS URL — not a page name or a Facebook page ID.");
  }

  let api_key_encrypted: string, webhook_secret_encrypted: string | null;
  try {
    api_key_encrypted = encryptSecret(form.api_key);
    webhook_secret_encrypted = form.webhook_secret ? encryptSecret(form.webhook_secret) : null;
  } catch (e) {
    redirectError((e as Error).message);
  }

  const created = await insertConnection({
    connection_name: form.connection_name,
    shop_id: form.shop_id,
    account_label: form.account_label,
    api_endpoint: form.api_endpoint,
    api_key_encrypted,
    webhook_secret_encrypted,
    is_enabled: form.is_enabled,
    initial_sync_days: form.initial_sync_days,
    created_by: user.id,
  });

  await audit(user, "LOGISTICS_CONNECTION_CREATED", created.id, {
    connection_name: form.connection_name,
    shop_id: form.shop_id,
    api_endpoint: form.api_endpoint,
    credentials: "[REDACTED]",
  });
  redirect(`${CONNECTIONS_PATH}?saved=1`);
}

export async function updateLogisticsConnectionAction(connectionId: string, formData: FormData) {
  const { user, db } = await requireUserLite();
  requirePermission(user, "logistics", "manage", db, CONNECTIONS_PATH);

  const existing = await getConnection(connectionId);
  if (!existing) redirectError("Connection not found.");

  const form = readForm(formData);
  if (!form.connection_name || !form.shop_id) {
    redirectError("Connection name and Shop ID are required.");
  }
  if (!/^\d+$/.test(form.shop_id)) {
    redirectError("Shop ID should be the numeric Pancake POS shop ID from the POS URL — not a page name or a Facebook page ID.");
  }

  const fields: Record<string, unknown> = {
    connection_name: form.connection_name,
    shop_id: form.shop_id,
    account_label: form.account_label,
    api_endpoint: form.api_endpoint,
    is_enabled: form.is_enabled,
    initial_sync_days: form.initial_sync_days,
  };
  // Blank means "keep the stored one" — the form never round-trips a secret to
  // the browser, so an empty field cannot mean "clear it".
  try {
    if (form.api_key) fields.api_key_encrypted = encryptSecret(form.api_key);
    if (form.webhook_secret) fields.webhook_secret_encrypted = encryptSecret(form.webhook_secret);
  } catch (e) {
    redirectError((e as Error).message);
  }

  // Changing the shop a connection points at makes every order already stored
  // under it belong to a different shop. Blocked rather than silently allowed:
  // the correct move is a new connection.
  if (form.shop_id !== existing.shop_id) {
    const orderCount = await countOrdersForConnection(connectionId);
    if (orderCount > 0) {
      redirectError(
        `This connection already holds ${orderCount.toLocaleString()} synced orders from shop ${existing.shop_id}. Changing its Shop ID would re-label them as another shop's. Add a new connection instead.`
      );
    }
  }

  await updateConnection(connectionId, fields);
  await audit(user, "LOGISTICS_CONNECTION_UPDATED", connectionId, {
    connection_name: form.connection_name,
    shop_id: form.shop_id,
    api_endpoint: form.api_endpoint,
    credentials_changed: Boolean(form.api_key || form.webhook_secret),
  });
  redirect(`${CONNECTIONS_PATH}?saved=1`);
}

export async function setLogisticsConnectionEnabledAction(connectionId: string, enabled: boolean) {
  const { user, db } = await requireUserLite();
  requirePermission(user, "logistics", "manage", db, CONNECTIONS_PATH);

  const existing = await getConnection(connectionId);
  if (!existing) redirectError("Connection not found.");

  await updateConnection(connectionId, { is_enabled: enabled });
  await audit(user, enabled ? "LOGISTICS_CONNECTION_ENABLED" : "LOGISTICS_CONNECTION_DISABLED", connectionId, {
    connection_name: existing.connection_name,
    shop_id: existing.shop_id,
  });
  redirect(`${CONNECTIONS_PATH}?saved=1`);
}

export async function archiveLogisticsConnectionAction(connectionId: string) {
  const { user, db } = await requireUserLite();
  requirePermission(user, "logistics", "manage", db, CONNECTIONS_PATH);

  const existing = await getConnection(connectionId);
  if (!existing) redirectError("Connection not found.");

  const orderCount = await countOrdersForConnection(connectionId);
  await archiveConnection(connectionId);
  await audit(user, "LOGISTICS_CONNECTION_ARCHIVED", connectionId, {
    connection_name: existing.connection_name,
    shop_id: existing.shop_id,
    orders_retained: orderCount,
  });
  redirect(`${CONNECTIONS_PATH}?saved=1&note=archived&orders=${orderCount}`);
}

export async function testLogisticsConnectionAction(connectionId: string) {
  const { user, db } = await requireUserLite();
  requirePermission(user, "logistics", "manage", db, CONNECTIONS_PATH);

  const conn = await getConnection(connectionId);
  if (!conn) redirectError("Connection not found.");

  const result = await testLogisticsConnection(conn);
  await audit(user, "LOGISTICS_CONNECTION_TESTED", connectionId, {
    connection_name: conn.connection_name,
    shop_id: conn.shop_id,
    result: result.ok ? "success" : "failed",
    // Pancake's own words, which never contain our credentials.
    message: result.message,
  });

  // Recorded on the connection too, so a failed test is visible on the row
  // afterwards rather than only in the flash message that scrolls away.
  await updateConnection(connectionId, {
    last_error_at: result.ok ? conn.last_error_at : new Date().toISOString(),
    last_error_message: result.ok ? conn.last_error_message : result.message,
  });

  const key = result.ok ? "tested" : "error";
  redirect(`${CONNECTIONS_PATH}?${key}=${encodeURIComponent(`${conn.connection_name}: ${result.message}`)}`);
}
