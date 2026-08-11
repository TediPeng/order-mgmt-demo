import { v4 as uuid } from "uuid";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { POLLABLE_STATUSES } from "@/lib/validation";
import type {
  Order,
  PancakeAccount,
  PancakeStatusMapEntry,
  PancakeSyncLog,
  PancakeSyncAction,
  PancakeSyncSource,
} from "@/lib/types";

// Targeted supabaseAdmin access for the Pancake tables + order sync fields.
// Deliberately NOT part of the whole-DbShape read/write cycle: sync logs are
// append-only and potentially large, and webhook/cron writers must touch only
// their own rows instead of racing user requests over the full table set.

function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

function mapOrder(o: Record<string, unknown>): Order {
  return {
    ...(o as unknown as Order),
    previous_order_amount: numOrNull(o.previous_order_amount),
    unit_price: numOrNull(o.unit_price),
    total_amount: Number(o.total_amount),
    shipping_fee: numOrNull(o.shipping_fee),
    discount: Number(o.discount ?? 0),
    pancake_retry_count: Number(o.pancake_retry_count ?? 0),
  };
}

// --- accounts ---------------------------------------------------------------

export async function listAccounts(): Promise<PancakeAccount[]> {
  const { data, error } = await supabaseAdmin.from("pancake_accounts").select("*").order("created_at", { ascending: true });
  if (error) throw new Error(`pancake_accounts read failed: ${error.message}`);
  return (data || []) as PancakeAccount[];
}

export async function getAccount(id: string): Promise<PancakeAccount | null> {
  const { data, error } = await supabaseAdmin.from("pancake_accounts").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`pancake_accounts read failed: ${error.message}`);
  return (data as PancakeAccount) || null;
}

export async function insertAccount(row: PancakeAccount): Promise<void> {
  const { error } = await supabaseAdmin.from("pancake_accounts").insert(row);
  if (error) throw new Error(`pancake_accounts insert failed: ${error.message}`);
}

export async function updateAccount(id: string, fields: Partial<PancakeAccount>): Promise<void> {
  const { error } = await supabaseAdmin.from("pancake_accounts").update(fields).eq("id", id);
  if (error) throw new Error(`pancake_accounts update failed: ${error.message}`);
}

export async function deleteAccount(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from("pancake_accounts").delete().eq("id", id);
  if (error) throw new Error(`pancake_accounts delete failed: ${error.message}`);
}

/** Resolution order (Section 0.3): assigned Agent -> agent's Team Lead ->
 * lead's order_source tag -> the active default account. Only active accounts
 * participate. Returns null when nothing resolves (caller sets needs_review). */
export function resolveAccount(
  accounts: PancakeAccount[],
  order: Pick<Order, "agent_id" | "order_source">,
  agentTeamLeadId: string | null
): PancakeAccount | null {
  const active = accounts.filter((a) => a.is_active);
  return (
    active.find((a) => a.assigned_agent_id === order.agent_id) ||
    (agentTeamLeadId ? active.find((a) => a.assigned_team_lead_id === agentTeamLeadId) : undefined) ||
    (order.order_source ? active.find((a) => a.assigned_order_source && a.assigned_order_source === order.order_source) : undefined) ||
    active.find((a) => a.is_default) ||
    null
  );
}

// --- status map -------------------------------------------------------------

export async function listStatusMap(): Promise<PancakeStatusMapEntry[]> {
  const { data, error } = await supabaseAdmin.from("pancake_status_map").select("*").order("pancake_status", { ascending: true });
  if (error) throw new Error(`pancake_status_map read failed: ${error.message}`);
  return (data || []) as PancakeStatusMapEntry[];
}

export async function upsertStatusMapEntry(entry: PancakeStatusMapEntry): Promise<void> {
  const { error } = await supabaseAdmin.from("pancake_status_map").upsert(entry, { onConflict: "id" });
  if (error) throw new Error(`pancake_status_map upsert failed: ${error.message}`);
}

export async function deleteStatusMapEntry(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from("pancake_status_map").delete().eq("id", id);
  if (error) throw new Error(`pancake_status_map delete failed: ${error.message}`);
}

// --- sync logs --------------------------------------------------------------

export interface SyncLogInput {
  order_id?: string | null;
  pancake_order_id?: string | null;
  pancake_account_id?: string | null;
  action: PancakeSyncAction;
  old_status?: string | null;
  new_status?: string | null;
  request_at?: string | null;
  response_at?: string | null;
  http_status?: number | null;
  result?: "success" | "failed" | null;
  error_message?: string | null;
  triggered_by?: string | null;
  source?: PancakeSyncSource | null;
  /** REDACTED summary only — never tokens/keys/secrets/full payloads. */
  payload_summary?: Record<string, unknown> | null;
}

export async function insertSyncLog(input: SyncLogInput): Promise<void> {
  const row: PancakeSyncLog = {
    id: uuid(),
    order_id: input.order_id ?? null,
    pancake_order_id: input.pancake_order_id ?? null,
    pancake_account_id: input.pancake_account_id ?? null,
    action: input.action,
    old_status: input.old_status ?? null,
    new_status: input.new_status ?? null,
    request_at: input.request_at ?? null,
    response_at: input.response_at ?? null,
    http_status: input.http_status ?? null,
    result: input.result ?? null,
    error_message: input.error_message ?? null,
    triggered_by: input.triggered_by ?? null,
    source: input.source ?? null,
    payload_summary: input.payload_summary ?? null,
  };
  const { error } = await supabaseAdmin.from("pancake_sync_logs").insert(row);
  if (error) throw new Error(`pancake_sync_logs insert failed: ${error.message}`);
}

/** Identity of one Pancake state change: which order, what status, at what
 * Pancake-clock instant. Stored on every processed inbound log row so a repeat
 * delivery of the same event can be recognized and skipped. */
export function eventKey(pancakeOrderId: string, rawStatus: string, eventTimestamp: string): string {
  return `${pancakeOrderId}|${rawStatus}|${eventTimestamp}`;
}

/** True when this exact event was already processed. Pancake (and any webhook
 * transport) can deliver the same event more than once — at-least-once delivery
 * is normal — so the second copy must not be applied again. */
export async function hasProcessedEvent(key: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("pancake_sync_logs")
    .select("id")
    .eq("payload_summary->>event_key", key)
    .limit(1);
  if (error) throw new Error(`pancake_sync_logs read failed: ${error.message}`);
  return (data || []).length > 0;
}

export interface SyncLogFilters {
  order_id?: string;
  pancake_account_id?: string;
  result?: "success" | "failed";
  source?: PancakeSyncSource;
  date_from?: string; // YYYY-MM-DD
  date_to?: string;
  limit?: number;
}

export async function listSyncLogs(filters: SyncLogFilters = {}): Promise<PancakeSyncLog[]> {
  let q = supabaseAdmin.from("pancake_sync_logs").select("*").order("request_at", { ascending: false, nullsFirst: false });
  if (filters.order_id) q = q.eq("order_id", filters.order_id);
  if (filters.pancake_account_id) q = q.eq("pancake_account_id", filters.pancake_account_id);
  if (filters.result) q = q.eq("result", filters.result);
  if (filters.source) q = q.eq("source", filters.source);
  if (filters.date_from) q = q.gte("request_at", `${filters.date_from}T00:00:00Z`);
  if (filters.date_to) q = q.lte("request_at", `${filters.date_to}T23:59:59Z`);
  q = q.limit(filters.limit ?? 200);
  const { data, error } = await q;
  if (error) throw new Error(`pancake_sync_logs read failed: ${error.message}`);
  return (data || []) as PancakeSyncLog[];
}

// --- orders (targeted) ------------------------------------------------------

export async function getOrderRow(id: string): Promise<Order | null> {
  const { data, error } = await supabaseAdmin.from("orders").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`orders read failed: ${error.message}`);
  return data ? mapOrder(data) : null;
}

export async function findOrderByPancakeId(pancakeOrderId: string): Promise<Order | null> {
  const { data, error } = await supabaseAdmin.from("orders").select("*").eq("pancake_order_id", pancakeOrderId).limit(2);
  if (error) throw new Error(`orders read failed: ${error.message}`);
  return data && data.length === 1 ? mapOrder(data[0]) : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Looks up the order an external reference points at. The reference is
 * whatever we put in Pancake's `custom_id`: `system_order_id` (the order
 * number) for anything sent since the refinement, and the internal UUID for
 * orders forwarded before it. Querying `orders.id` with a non-UUID would make
 * Postgres reject the whole statement, so the shape is checked first. */
export async function findOrderByExternalReference(reference: string): Promise<Order | null> {
  if (UUID_RE.test(reference)) {
    const byId = await getOrderRow(reference);
    if (byId) return byId;
  }
  const { data, error } = await supabaseAdmin.from("orders").select("*").eq("system_order_id", reference).limit(2);
  if (error) throw new Error(`orders read failed: ${error.message}`);
  return data && data.length === 1 ? mapOrder(data[0]) : null;
}

export async function findOrderByOrderNumber(orderNumber: string): Promise<Order | null> {
  const { data, error } = await supabaseAdmin.from("orders").select("*").eq("order_number", orderNumber).limit(2);
  if (error) throw new Error(`orders read failed: ${error.message}`);
  return data && data.length === 1 ? mapOrder(data[0]) : null;
}

/** Phone fallback: only FORWARDED orders count, and the match must be unique —
 * anything else returns null and the caller records needs_review. */
export async function findForwardedOrdersByPhone(phone: string): Promise<Order[]> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("customer_phone", phone)
    .not("forwarded_to_pancake_at", "is", null);
  if (error) throw new Error(`orders read failed: ${error.message}`);
  return (data || []).map(mapOrder);
}

/** Orders the polling cron should check: forwarded, in a non-terminal
 * fulfillment state — anything Pancake could still move on. */
export async function listOrdersForPolling(): Promise<Order[]> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("pancake_sync_status", "synced")
    .not("pancake_order_id", "is", null)
    .in("status", POLLABLE_STATUSES as unknown as string[]);
  if (error) throw new Error(`orders read failed: ${error.message}`);
  return (data || []).map(mapOrder);
}

/** How many orders are waiting in the Sync Failed queue, for the badge that
 * says so before anyone opens it. A head count rather than the rows: the number
 * is wanted on a page that does not otherwise read orders at all. */
export async function countOrdersWithFailedSync(): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("pancake_sync_status", "sync_failed");
  if (error) throw new Error(`orders count failed: ${error.message}`);
  return count ?? 0;
}

export async function listOrdersWithFailedSync(): Promise<Order[]> {
  const { data, error } = await supabaseAdmin.from("orders").select("*").eq("pancake_sync_status", "sync_failed");
  if (error) throw new Error(`orders read failed: ${error.message}`);
  return (data || []).map(mapOrder);
}

/** Orders left in `syncing` by a forward that never finished — the request was
 * killed mid-flight (serverless timeout/instance recycle). Without this they
 * would sit in `syncing` forever and the duplicate guard would skip them, so
 * the sweep releases them back to `sync_failed` for the retry queue. */
export async function listOrdersStuckSyncing(olderThanIso: string): Promise<Order[]> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("pancake_sync_status", "syncing")
    .lt("pancake_last_sync_attempt_at", olderThanIso);
  if (error) throw new Error(`orders read failed: ${error.message}`);
  return (data || []).map(mapOrder);
}

/** Atomically claims an order for sending: flips it to `syncing` only if it is
 * NOT already syncing and has no Pancake order id. Postgres applies the
 * predicate and the write in one statement, so two concurrent callers (a
 * double-click, or a cron retry overlapping a manual one) cannot both win —
 * the loser gets no row back and must not call Pancake.
 *
 * Returns the claimed row, or null when another caller holds the claim. */
export async function claimOrderForSync(
  id: string,
  fields: { pancake_pos_account_id: string; pancake_retry_count: number; attemptAt: string }
): Promise<Order | null> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .update({
      pancake_sync_status: "syncing",
      pancake_pos_account_id: fields.pancake_pos_account_id,
      pancake_retry_count: fields.pancake_retry_count,
      pancake_last_sync_attempt_at: fields.attemptAt,
    })
    .eq("id", id)
    .neq("pancake_sync_status", "syncing")
    .is("pancake_order_id", null)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`orders claim failed: ${error.message}`);
  return data ? mapOrder(data) : null;
}

/** True when a successful `forward` already exists for this order — the
 * belt-and-braces duplicate check required before any create call. */
export async function hasSuccessfulForward(orderId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("pancake_sync_logs")
    .select("id")
    .eq("order_id", orderId)
    .eq("result", "success")
    .in("action", ["forward", "retry"])
    .limit(1);
  if (error) throw new Error(`pancake_sync_logs read failed: ${error.message}`);
  return (data || []).length > 0;
}

/** Targeted update of sync/fulfillment fields only — never touches notes,
 * agent assignment, or any other internally-owned column (Section 6). */
export async function updateOrderSyncFields(
  id: string,
  fields: Partial<
    Pick<
      Order,
      | "status"
      | "pancake_order_id"
      | "pancake_pos_account_id"
      | "pancake_status"
      | "pancake_sync_status"
      | "pancake_synced_at"
      | "pancake_event_at"
      | "payment_method"
      | "shipping_fee"
      | "courier"
      | "tracking_number"
      | "pancake_last_sync_attempt_at"
      | "pancake_request_payload"
      | "pancake_response_payload"
      | "pancake_sync_error"
      | "forwarded_to_pancake_at"
      | "pancake_retry_count"
      | "updated_at"
    >
  >
): Promise<void> {
  const { error } = await supabaseAdmin.from("orders").update(fields).eq("id", id);
  if (error) throw new Error(`orders sync-field update failed: ${error.message}`);
}

// --- notifications + audit log (standalone, no DbShape) ---------------------

export async function activeAdministratorIds(): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, role, is_active, is_deleted")
    .eq("role", "administrator")
    .eq("is_active", true)
    .eq("is_deleted", false);
  if (error) throw new Error(`profiles read failed: ${error.message}`);
  return (data || []).map((p) => p.id as string);
}

export async function notifyAdministrators(type: string, title: string, body: string | null, link: string | null): Promise<void> {
  const ids = await activeAdministratorIds();
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  const rows = ids.map((recipient_id) => ({
    id: uuid(),
    recipient_id,
    type,
    title,
    body,
    link,
    is_read: false,
    created_at: now,
  }));
  const { error } = await supabaseAdmin.from("notifications").insert(rows);
  if (error) throw new Error(`notifications insert failed: ${error.message}`);
}

export async function logActivityDirect(
  userId: string | null,
  action: string,
  entityType: string | null,
  entityId: string | null,
  details: Record<string, unknown> | null,
  extra: { module?: string; previous_value?: unknown; updated_value?: unknown } = {}
): Promise<void> {
  let userEmail: string | null = null;
  if (userId) {
    const { data } = await supabaseAdmin.from("profiles").select("email").eq("id", userId).maybeSingle();
    userEmail = (data?.email as string) || null;
  }
  const { error } = await supabaseAdmin.from("activity_log").insert({
    id: uuid(),
    user_id: userId,
    user_email: userEmail,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
    module: extra.module ?? "integrations",
    previous_value: extra.previous_value ?? null,
    updated_value: extra.updated_value ?? null,
    ip_address: null,
    device_info: null,
    created_at: new Date().toISOString(),
  });
  if (error) throw new Error(`activity_log insert failed: ${error.message}`);
}
