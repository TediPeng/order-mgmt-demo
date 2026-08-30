export const SYSTEM_ROLES = ["administrator", "team_lead", "agent"] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];
// Role is a free-form key so custom roles (created by an Administrator) work too.
export type Role = string;

export interface RoleDef {
  id: string;
  key: string;
  name: string;
  description: string;
  is_system: boolean;
  created_at: string;
}

export type ThemePreference = "light" | "dark" | "system";

export interface Profile {
  id: string;
  username: string;
  full_name: string;
  email: string;
  role: Role;
  team_lead_id: string | null;
  /** Agent's Call Name, assigned by an Administrator. Stamped onto every order
   * they create as order_source, and read-only to the agent. */
  call_name: string | null;
  contact_number: string | null;
  is_active: boolean;
  password_hash: string;
  must_change_password: boolean;
  avatar_url: string | null;
  /** Per-account theme, applied server-side on first paint. */
  theme_preference: ThemePreference;
  /** Optional named permission preset this account was created from. */
  permission_profile: string | null;
  last_login_at: string | null;
  /** Anonymized tombstone: the row survives so historical orders, call logs and
   * audit entries keep a valid FK target, rendered as "Deleted User". */
  is_deleted: boolean;
  deleted_at: string | null;
  /** An account used to test the system, not to sell. Its orders, calls and
   * attendance are real rows and stay where they are — deleting them would
   * take the audit trail with them — but they are not the floor's work, so
   * nothing that measures the floor counts them. Set by hand in the database;
   * there is no UI for it. See isTestAccount() in lib/permissions.ts. */
  is_test_account: boolean;
  created_at: string;
}

/**
 * The Order ID users see, search and quote.
 *
 * Pancake generates the order id once an order is forwarded, and from that
 * point it is the reference both systems share — so it wins. The internal
 * ORD-YYYYMMDD-#### stays in the database for matching and history, and is
 * shown only while an order has not reached Pancake yet.
 */
export function displayOrderId(order: Pick<Order, "order_number" | "pancake_order_id">): string {
  return order.pancake_order_id || order.order_number;
}

/**
 * The same reference, short enough for a frozen column: `ORD-20260811-0168`
 * shows as `168`, and the first order of a day as `001`.
 *
 * The prefix and the date are the same on every row of a day's work, in the one
 * column pinned to the left, costing horizontal space on every screen. The
 * counter is what anybody actually reads, and the zero the sequence is padded
 * to four digits with is not part of it — three digits is what a day's work
 * reaches, so that is the width the column is held to. A Pancake id is the
 * number typed into Pancake to find the order, so it is returned whole.
 *
 * Near enough to unique to scan by: across the 51,948 orders without a Pancake
 * id there are 51,421 distinct counters — 507 repeat at all, and the worst
 * repeats four times in eighteen months. It is a label to find a row by, not a
 * key; the full value is on the cell's tooltip, in the popup header and on the
 * lead's own page, which is where it gets read out and pasted into Pancake.
 */
export function shortOrderId(order: Pick<Order, "order_number" | "pancake_order_id">): string {
  if (order.pancake_order_id) return order.pancake_order_id;
  // ORD-YYYYMMDD-NNNN → NNNN, and anything not in that shape is left alone
  // rather than sliced into something meaningless.
  const parts = order.order_number.split("-");
  if (parts.length !== 3) return order.order_number;
  // The padding drops, but not below three digits: a counter that reads "1" on
  // one row and "168" on the next is a ragged column, and "001" is still read
  // as the first order of the day. A day past 999 keeps every digit it needs.
  const counter = parts[2].replace(/^0+/, "");
  return counter ? counter.padStart(3, "0") : "000";
}

/** True while an order still shows its internal number because Pancake has not
 * issued one yet — the UI dims it and adds "(pending sync)". */
export function isPendingOrderId(order: Pick<Order, "pancake_order_id">): boolean {
  return !order.pancake_order_id;
}

/** Display name for a profile that may have been anonymized by a permanent
 * account deletion. */
export function displayUserName(profile: Pick<Profile, "full_name" | "is_deleted"> | null | undefined): string {
  if (!profile) return "Unknown User";
  return profile.is_deleted ? "Deleted User" : profile.full_name;
}

/** The short name for dense surfaces — the calendar chip, where a full name
 * plus a time range is wider than a day cell and gets cut off mid-surname.
 * Falls back to the full name for an account with no Call Name set. */
export function displayCallName(
  profile: Pick<Profile, "full_name" | "call_name" | "is_deleted"> | null | undefined
): string {
  if (!profile) return "Unknown User";
  if (profile.is_deleted) return "Deleted User";
  return profile.call_name?.trim() || profile.full_name;
}

// Pre-sale statuses (new/ringing/hung_up/cbr/rsrv) are agent-driven; a lead
// becomes a sale on entering packaging (which also
// forwards it to Pancake POS), then the fulfillment statuses
// (confirmed/printed/shipped/in_transit/failed_delivery/delivered/returned/
// cancelled) are normally driven by Pancake sync — Management may override
// manually (audit-logged with source internal_user).
export type OrderStatus =
  | "new"
  | "ringing"
  | "hung_up"
  | "cbr"
  | "rsrv"
  // Four more call outcomes, added 2026-08-10. `cancel` is how the CALL ended
  // and is not `cancelled`, which is Pancake's fulfillment cancellation.
  | "inc"
  | "call_back"
  | "reject_offer"
  | "cancel"
  // Fulfillment statuses mirror Pancake POS's own set (lib/validation.ts).
  | "waiting_confirmation"
  | "confirmed"
  | "restocking"
  | "purchased"
  | "wait_for_printing"
  | "printed"
  | "packaging"
  | "waiting_pickup"
  | "shipped"
  | "delivered"
  | "collected_money"
  | "returning"
  | "partial_return"
  | "returned"
  | "cancelled"
  | "deleted"
  // Out of delivery zone. Set only by the Pancake ODZ tag rule, never by an
  // agent. Neither Delivered nor Returned, so it is excluded from RTS %.
  | "odz";

/** Outbound sync state. "Needs review" is not a status of its own — it is the
 * sync_failed state once the retry budget is exhausted, rendered as
 * "Sync Failed — needs review". */
export type PancakeSyncStatus = "not_synced" | "syncing" | "synced" | "sync_failed" | "resolved";

export const PANCAKE_SYNC_STATUS_LABELS: Record<PancakeSyncStatus, string> = {
  not_synced: "Not Synced",
  syncing: "Syncing",
  synced: "Synced",
  sync_failed: "Sync Failed",
  // Closed by a person rather than by a successful send. The order is not in
  // Pancake and is not going to be, and somebody has said so — which is a
  // different fact from never having tried, and the only one that keeps a
  // failure out of the queue without pretending it succeeded.
  resolved: "Resolved manually",
};

/** Field defaults for a brand-new order that has never been forwarded to
 * Pancake POS — spread into every order-creation site (form, import, seed). */
export const ORDER_PANCAKE_DEFAULTS = {
  tag: null,
  customer_id: null,
  is_regular_customer: false,
  regular_customer_since: null,
  tracking_number: null,
  province_code: null,
  city_code: null,
  barangay_code: null,
  pancake_province_id: null,
  pancake_district_id: null,
  pancake_commune_id: null,
  address_needs_review: false,
  shipping_fee: null,
  courier: null,
  payment_method: null,
  order_source: null,
  discount: 0,
  variant: null,
  system_order_id: null,
  pancake_order_id: null,
  pancake_pos_account_id: null,
  pancake_status: null,
  pancake_sync_status: "not_synced",
  pancake_synced_at: null,
  pancake_event_at: null,
  pancake_last_sync_attempt_at: null,
  pancake_request_payload: null,
  pancake_response_payload: null,
  pancake_sync_error: null,
  forwarded_to_pancake_at: null,
  pancake_retry_count: 0,
  manual_unlock_active: false,
  manual_unlock_reason: null,
  manual_unlock_by: null,
  manual_unlock_at: null,
} satisfies Partial<Order>;

export interface Order {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  purok: string;
  barangay: string;
  city: string;
  province: string;
  landmark: string;
  previous_order_date: string | null;
  previous_order_product: string | null;
  previous_order_amount: number | null;
  // What was noted on the customer's last order. Auto-filled from that order's
  // notes when the form or import file does not supply it, same as the three
  // fields above.
  previous_order_note: string | null;
  // How that order ended. Held as text rather than the order_status enum: an
  // imported file may name a status this system does not have, and keeping the
  // row is worth more than enforcing the vocabulary. Rendered through
  // LEAD_STATUS_LABELS when it is one we know.
  previous_order_status: string | null;
  product_id: string | null; // source of truth for the selected product going forward
  product_name: string; // denormalized display text (legacy free-text for old rows)
  variant: string | null; // selected variant, when the product defines any
  quantity: number;
  unit_price: number | null; // blank until the agent fills it in
  discount: number; // per-order discount, subtracted from the line total
  // Grand total: unit_price * quantity - discount + shipping_fee.
  total_amount: number;
  status: OrderStatus;
  // Date the lead most recently entered packaging; overwritten each time it
  // re-enters. Blank until then, regardless of created_at.
  order_date: string | null;
  source: "manual" | "import";
  // Optional order fields included in the Pancake forward payload; NOT part of
  // the Ready-to-Ship required-field validation.
  shipping_fee: number | null;
  courier: string | null;
  payment_method: string | null;
  // Optional routing tag: resolves which Pancake account receives the order
  // (priority: assigned agent -> agent's team -> order_source -> default).
  order_source: string | null;
  // Free-text tag: Management/Team Lead edit it, agents only read it.
  tag: string | null;
  // Set once the customer behind this order is tagged Regular.
  customer_id: string | null;
  is_regular_customer: boolean;
  regular_customer_since: string | null;
  // Written only by the integration; shows "Not Available" until synced.
  tracking_number: string | null;
  // PSGC codes alongside the display names, carrying the authoritative
  // province -> city -> barangay relationships.
  province_code: string | null;
  city_code: string | null;
  barangay_code: string | null;
  // Legacy free-text address that could not be matched to PSGC on migration.
  address_needs_review: boolean;
  // Pancake POS's own province/district/commune IDs, captured by the address
  // picker. These are what the create-order payload sends — Pancake ignores a
  // name-only address, so without them the order arrives with no location. Held
  // separately from the PSGC *_code columns above, which are a different
  // identifier space kept for legacy rows.
  pancake_province_id: string | null;
  pancake_district_id: string | null;
  pancake_commune_id: string | null;
  // Pancake POS sync state. Managed by lib/pancake/*; the DbShape write path
  // carries these along unchanged.
  // Stable external reference sent to Pancake (defaults to order_number).
  system_order_id: string | null;
  // Pancake's own order id, stored exactly as returned — never generated here.
  pancake_order_id: string | null;
  pancake_pos_account_id: string | null;
  // Raw Pancake-side status label (Packaging, then fulfillment statuses).
  pancake_status: string | null;
  pancake_sync_status: PancakeSyncStatus;
  // When WE last talked to Pancake (our clock) — for display only.
  pancake_synced_at: string | null;
  // Pancake-clock timestamp of the last observed state. The ONLY value the
  // out-of-order guard compares against, so both sides use the same clock.
  pancake_event_at: string | null;
  pancake_last_sync_attempt_at: string | null;
  // Full request/response bodies, redacted of credentials, for troubleshooting.
  pancake_request_payload: Record<string, unknown> | null;
  pancake_response_payload: Record<string, unknown> | null;
  pancake_sync_error: string | null;
  forwarded_to_pancake_at: string | null;
  pancake_retry_count: number;
  // A synced order is locked from manual editing. An Administrator may unlock
  // it for one save, which relocks it again.
  manual_unlock_active: boolean;
  manual_unlock_reason: string | null;
  manual_unlock_by: string | null;
  manual_unlock_at: string | null;
  notes: string;
  created_by: string;
  updated_by: string | null;
  agent_id: string;
  assigned_agent_email: string;
  created_at: string;
  updated_at: string;
}

export const PRODUCT_STATUSES = ["active", "inactive", "out_of_stock"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  out_of_stock: "Out of Stock",
};

export interface Product {
  id: string;
  name: string;
  code: string | null;
  sku: string | null;
  unit: string | null;
  selling_price: number | null;
  stock_quantity: number | null;
  // Pancake POS variation ID (or SKU) this product maps to. Pancake requires
  // items[].variation_id on every forwarded order; `code` is used as a
  // fallback since Pancake accepts a SKU in the same field.
  pancake_variation_id: string | null;
  /** Optional variant names; when set, an order using this product picks one. */
  variants: string[] | null;
  /** Only "active" products are offered in the agent product dropdown. */
  status: ProductStatus;
  created_by: string;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
}

export interface ProductUpload {
  id: string;
  file_name: string;
  uploaded_by: string | null;
  total_rows: number;
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  update_existing: boolean;
  /** Per-row rejection reasons, replayed to build the downloadable error report. */
  errors: ProductUploadRowError[] | null;
  uploaded_at: string;
}

export interface ProductUploadRowError {
  row: number;
  product_name: string;
  reason: string;
}

export type AttendanceStatus =
  | "on_time"
  | "late"
  | "absent"
  | "on_leave"
  | "half_day"
  | "over_break"
  | "timed_out"
  | "wfh"
  | "rest_day"
  | "suspended";

export interface Attendance {
  id: string;
  user_id: string;
  work_date: string; // YYYY-MM-DD
  time_in: string | null; // ISO, null for manually-created absent/on_leave rows
  time_out: string | null;
  total_hours: number | null;
  overridden: boolean;
  override_reason: string | null;
  overridden_by: string | null;
  break_start: string | null;
  break_end: string | null;
  break_minutes: number | null;
  scheduled_time_in: string; // HH:mm
  scheduled_time_out: string; // HH:mm
  minutes_late: number;
  over_break_minutes: number;
  overtime_hours: number;
  status: AttendanceStatus;
  remarks: string | null;
  attachment_path: string | null;
  created_by: string | null; // null = self time-in
  updated_by: string | null;
  updated_at: string;
}

export type ScheduleStatus = "scheduled" | "rest_day" | "suspension" | "unassigned";

export interface Schedule {
  id: string;
  agent_id: string;
  schedule_date: string; // YYYY-MM-DD
  duty_start: string | null; // HH:mm, null for rest day / suspension
  duty_end: string | null;
  is_rest_day: boolean;
  status: ScheduleStatus;
  remarks: string | null;
  suspension_id: string | null; // set when auto-created/replaced by a suspension
  recurrence_group: string | null; // links rows created by one recurring/bulk action
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string | null;
}

export type SuspensionStatus = "active" | "completed" | "lifted";

export interface Suspension {
  id: string;
  employee_id: string;
  start_date: string; // YYYY-MM-DD
  duration_days: 3 | 7 | 15;
  end_date: string; // YYYY-MM-DD, inclusive, auto-computed
  reason: string;
  issued_by: string;
  date_issued: string; // YYYY-MM-DD
  remarks: string | null;
  status: SuspensionStatus;
  lifted_reason: string | null;
  lifted_by: string | null;
  lifted_at: string | null;
  created_at: string;
}

export interface CallLog {
  id: string;
  file_name: string;
  storage_path: string;
  file_size_bytes: number;
  record_count: number;
  uploaded_by: string;
  uploaded_at: string;
}

export interface CallLogRecord {
  id: string;
  call_log_id: string;
  agent_id: string | null;
  caller_name: string;
  phone_number: string;
  call_date: string;
  duration_seconds: number;
  call_type: string;
  notes: string;
}

export interface ActivityLogEntry {
  id: string;
  user_id: string | null;
  user_email: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  module: string | null;
  previous_value: unknown;
  updated_value: unknown;
  ip_address: string | null;
  device_info: string | null;
  created_at: string;
}

export type LeaveType = "sick" | "emergency" | "unpaid";
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled" | "returned_for_revision";

export interface LeaveRequest {
  id: string;
  agent_id: string;
  agent_email: string;
  department_team: string | null;
  filing_date: string; // YYYY-MM-DD
  leave_start: string;
  leave_end: string;
  leave_days: number;
  leave_type: LeaveType;
  reason: string;
  attachment_path: string | null;
  supervisor_id: string | null;
  status: LeaveStatus;
  urgent_review: boolean;
  management_remarks: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppNotification {
  id: string;
  recipient_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

export interface WorkSchedule {
  work_start: string; // HH:mm
  work_end: string; // HH:mm
  break_minutes: number;
  timezone: string;
  auto_mark_absent: boolean;
  require_attachment_for_sick_leave: boolean;
  /** How many agents may be off on one day, floor-wide. See lib/leave.ts. */
  max_approved_leave_per_day: number;
}

export const MODULES = [
  "dashboard",
  "orders",
  "products",
  "call_logs",
  "performance",
  "ranking",
  "attendance",
  "leave",
  "schedules",
  "disciplinary",
  "users",
  "roles",
  "reports",
  "audit_logs",
  "settings",
  "integrations",
  "file_uploads",
  "regular_customers",
] as const;
export type ModuleKey = (typeof MODULES)[number];

export const ACTIONS = [
  "view",
  "create",
  "edit",
  "delete",
  "upload",
  "download",
  "export",
  "approve",
  "assign",
  "manage",
] as const;
export type ActionKey = (typeof ACTIONS)[number];

export interface RolePermission {
  id: string;
  role: string;
  module: ModuleKey;
  action: ActionKey;
  allowed: boolean;
  updated_by: string | null;
  updated_at: string;
}

export interface PerformanceThresholds {
  top_performer_min_ratio: number; // vs team average, e.g. 1.2 = 120% of average
  needs_improvement_max_ratio: number; // e.g. 0.8 = 80% of average
  rts_warning_threshold_pct: number; // RTS % (Returned Qty / Delivered Qty) above this is styled as a warning
}

// --- Pancake POS integration ------------------------------------------------
// These tables are intentionally NOT part of DbShape: sync logs are
// append-only and potentially large, and webhook/cron writers must not race
// the whole-DbShape read/write cycle. Access goes through lib/pancake/store.ts
// (targeted supabaseAdmin queries) instead.

export interface PancakeAccount {
  id: string;
  account_name: string;
  shop_or_page_id: string;
  api_endpoint: string;
  api_key_encrypted: string; // AES-256-GCM via lib/pancake/crypto.ts — never plaintext, never sent to the client
  webhook_secret_encrypted: string | null;
  assigned_agent_id: string | null;
  assigned_team_lead_id: string | null;
  assigned_order_source: string | null;
  is_default: boolean;
  is_active: boolean;
  // Send products with no pancake_variation_id as Pancake "quick add"
  // (one-time) products rather than holding the order back for mapping.
  use_one_time_products: boolean;
  // Applied to an order's blank fields when it is forwarded, so agents never
  // have to see or enter them.
  default_payment_method: string | null;
  default_shipping_fee: number | null;
  default_courier: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface PancakeStatusMapEntry {
  id: string;
  pancake_status: string; // exact code from the Pancake API (seeded values are TODO placeholders)
  internal_status: string; // must be a valid OrderStatus
  is_active: boolean;
  updated_by: string | null;
  updated_at: string;
}

export type PancakeSyncAction =
  | "forward"
  | "status_update"
  | "poll"
  | "manual_sync"
  | "retry"
  | "duplicate_ignored"
  // The four a person takes when a retry cannot end the failure itself.
  | "manual_link"
  | "hold_cleared"
  | "resolved_manually"
  // The reverse of manual_link: the Pancake order this pointed at is dead —
  // cancelled there, or deleted — so the link is cut and the order can be sent
  // again as a new one. The old id is kept on the log entry.
  | "unlinked";
export type PancakeSyncSource =
  | "webhook"
  | "api_polling"
  | "manual_sync"
  | "internal_user"
  | "auto_retry"
  | "tag_rule"
  | "ready_to_ship_event" // historical: renamed to packaging_event
  | "packaging_event";

export const PANCAKE_SYNC_SOURCE_LABELS: Record<PancakeSyncSource, string> = {
  webhook: "Webhook",
  api_polling: "Polling",
  manual_sync: "Manual Sync",
  internal_user: "Internal User",
  auto_retry: "Auto Retry",
  tag_rule: "Tag Rule",
  ready_to_ship_event: "Packaging Event",
  packaging_event: "Packaging Event",
};

export interface PancakeSyncLog {
  id: string;
  order_id: string | null;
  pancake_order_id: string | null;
  pancake_account_id: string | null;
  action: PancakeSyncAction;
  old_status: string | null;
  new_status: string | null;
  request_at: string | null;
  response_at: string | null;
  http_status: number | null;
  result: "success" | "failed" | null;
  error_message: string | null;
  triggered_by: string | null; // null for webhook/cron
  source: PancakeSyncSource | null;
  payload_summary: Record<string, unknown> | null; // REDACTED: never tokens/keys/secrets
}

import type { DialScheme } from "./dial";

export interface OperationsSettings {
  /** Off by default: a file dictating status could push leads straight into
   * the sale pipeline, stamping order dates and firing Pancake forwards. */
  allow_status_import: boolean;
  /** Minimum duration for a calling session to count towards Calls Made.
   * 0 counts every completed session. */
  min_call_seconds: number;
  /** Which URL scheme a clicked phone number uses, so it opens the softphone
   * on the agent's PC. "off" renders numbers as plain text. See lib/dial.ts —
   * this is a fact about that PC, not about this app, so it is a setting. */
  dial_scheme: DialScheme;
  /**
   * When true, an agent cannot sign in here with a password and must arrive
   * through the company portal.
   *
   * Agents only, and that is the point rather than an omission. An
   * Administrator keeps the password form because it is the way back in when
   * the portal or the SSO hand-off is the thing that broke — and two of the
   * three administrator accounts have no employee record in the portal at all,
   * so SSO could not let them in even if it were working.
   *
   * A setting and not an environment variable for the same reason: turning it
   * off has to be one click by whoever is awake, not a redeploy.
   */
  agent_login_via_portal_only: boolean;
}

export interface DbShape {
  schema_version: number;
  attendance_sweep_cursor: string | null; // last work_date (YYYY-MM-DD) fully processed by the auto-absent sweep
  auto_time_out_cursor: string | null; // same, for the auto time-out sweep; null until it first runs
  profiles: Profile[];
  roles: RoleDef[];
  orders: Order[];
  products: Product[];
  attendance: Attendance[];
  call_logs: CallLog[];
  call_log_records: CallLogRecord[];
  /** OUTBOX, not history. readDb() leaves this empty; it collects only what the
   * current request logs, and writeDb() inserts and drains it. Reading the
   * audit trail goes through lib/audit-log.ts — this array will never contain
   * an entry from an earlier request. */
  activity_log: ActivityLogEntry[];
  role_permissions: RolePermission[];
  leave_requests: LeaveRequest[];
  notifications: AppNotification[];
  schedules: Schedule[];
  suspensions: Suspension[];
  order_seq: Record<string, number>; // date -> last sequence number
  performance_thresholds: PerformanceThresholds;
  work_schedule: WorkSchedule;
  operations: OperationsSettings;
  /** OUTBOX, like activity_log above: the rows this request wants deleted.
   *
   * Deletion used to be inferred — writeDb() removed anything present in the
   * database but missing from these arrays. That reads "absent" as "deleted",
   * which is true of one request at a time and false the moment two overlap:
   * a row another request created after this one loaded is also absent, and
   * was being destroyed on that basis. Deletion is now stated rather than
   * inferred, so writeDb() can only remove what an action actually asked it
   * to. */
  pending_deletes: PendingDelete[];
  /** Ids of orders changed by this request — see the note above. */
  dirty_orders: string[];
}

/** The ids of orders this request actually changed.
 *
 * writeDb() used to upsert the ENTIRE orders table on every save — at 57,000
 * leads a single status change rewrote all 57,000 rows. Like pending_deletes,
 * this is stated rather than inferred: an action that changes an order says
 * so with markOrderDirty(), and nothing else is written.
 *
 * The trade is deliberate. Inferring the change set means either diffing every
 * row (which needs a second copy of the table in memory) or writing all of
 * them (which is what this replaces). Stating it costs one call at each
 * mutation site, and a missed call is a change that silently does not persist
 * — so the sites are few and all of them live in lib/actions. */
export interface PendingDelete {
  table: string;
  id: string;
  key?: string;
}


/** One product line on an order.
 *
 * Deliberately absent from DbShape. readDb() loads whole tables, so putting
 * line items there would pull every line of every order into every page —
 * the payload problem the orders refactor exists to undo. These are read and
 * written through lib/order-items.ts instead, the same way call_sessions and
 * the Pancake tables are.
 *
 * The order keeps carrying `total_amount`, `quantity` and `product_name` as
 * its summary, so lists, dashboards, exports and the Pancake payload continue
 * to work without knowing lines exist.
 */
export interface OrderItem {
  id: string;
  order_id: string;
  /** Display order, so the sequence an agent entered survives a reload. */
  position: number;
  product_id: string | null;
  /** Denormalized: a deleted product nulls product_id but must not erase the
   * record of what was sold. */
  product_name: string;
  variant: string | null;
  quantity: number;
  unit_price: number;
  discount: number;
  /** quantity * unit_price - discount, as charged. Stored rather than derived
   * so a later price change cannot rewrite what the customer paid. */
  line_total: number;
}

/** A line as submitted by the form, before it has an id. */
export interface OrderItemInput {
  product_id: string | null;
  product_name: string;
  variant: string | null;
  quantity: number;
  unit_price: number;
  discount: number;
}

// --- Regular Customers, calling sessions, agent call logs -------------------
// Accessed through targeted supabaseAdmin queries (lib/customers.ts,
// lib/call-sessions.ts, lib/agent-call-logs.ts), not through DbShape.

export interface Customer {
  id: string;
  full_name: string;
  phone_raw: string;
  phone_normalized: string;
  purok: string | null;
  barangay: string | null;
  city: string | null;
  province: string | null;
  landmark: string | null;
  // Pancake POS's own address IDs, captured by the address picker. Carried so
  // an order raised from this customer arrives at Pancake with a location —
  // names alone are ignored there. Same identifier space as orders.pancake_*.
  pancake_province_id: string | null;
  pancake_district_id: string | null;
  pancake_commune_id: string | null;
  owner_agent_id: string;
  original_agent_id: string | null;
  is_regular_customer: boolean;
  regular_since: string | null;
  customer_status: string;
  total_orders: number;
  created_at: string;
  updated_at: string | null;
}

/**
 * A regular customer an owner has lent to a teammate.
 *
 * Additive to `Customer.owner_agent_id`, which a share never changes — there is
 * always exactly one person accountable for the record, and removing a share
 * cannot leave it ownerless.
 */
export interface CustomerShare {
  customer_id: string;
  agent_id: string;
  /** The owner who shared it, or null if that account has since been removed. */
  shared_by: string | null;
  created_at: string;
}

export type DuplicateMatchType = "phone" | "name_address" | "name_barangay_city" | "other";
export type DuplicateConfidence = "high" | "medium" | "low";
export type DuplicateStatus = "open" | "confirmed_duplicate" | "not_duplicate" | "merged";

export interface CustomerDuplicateMatch {
  id: string;
  customer_id: string;
  matched_customer_id: string;
  match_type: DuplicateMatchType;
  confidence: DuplicateConfidence;
  status: DuplicateStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface CallSession {
  id: string;
  agent_id: string;
  /** The order being called.
   *
   * Null only while the call is on a regular customer who has no order yet:
   * the agent rings them from their record and the order is written during the
   * call, at which point createLeadAction attaches it here. Every finished
   * call that produced an order therefore reads exactly like a lead call. */
  order_id: string | null;
  /** The regular customer being called, when the call started from their
   * record rather than from a lead. Stays set after the order is attached, so
   * the monitor and the call list can still say who was rung. */
  customer_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  previous_status: string | null;
  new_status: string | null;
  remarks: string | null;
  /** Generated column: true while ended_at is null. */
  is_active: boolean;
  created_at: string;
}

/** A short, repeatable break. Distinct from attendance.break_start/break_end,
 * which is the single daily break and refuses a second one. Lives in its own
 * table because there can be many per day; see lib/bio-breaks.ts. */
export interface BioBreak {
  id: string;
  agent_id: string;
  /** Attendance day in the app timezone, so totals group correctly across a
   * UTC midnight that lands mid-shift. */
  work_date: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  created_at: string;
}

// --- Release notes & account deletion audit --------------------------------
// Both are append-mostly and read outside the authenticated session (the login
// page shows published release notes), so they use targeted queries rather
// than DbShape.

export interface UpdateLog {
  id: string;
  version: string;
  release_date: string; // YYYY-MM-DD
  title: string;
  new_features: string[] | null;
  fixes: string[] | null;
  improvements: string[] | null;
  known_issues: string[] | null;
  is_published: boolean;
  created_by: string | null;
  created_at: string;
}

export type DeletionHandling = "anonymized" | "hard_deleted";

export interface AccountDeletion {
  id: string;
  deleted_profile_id: string | null;
  deleted_username: string | null;
  deleted_full_name: string | null;
  deleted_email: string | null;
  deleted_role: string | null;
  deleted_by: string | null;
  reason: string;
  handling_method: DeletionHandling;
  linked_record_counts: Record<string, number> | null;
  deleted_at: string;
}
