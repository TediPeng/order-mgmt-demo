export const SYSTEM_ROLES = ["management", "administrator", "team_lead", "agent"] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];
// Role is a free-form key so custom roles (created by Management) work too.
export type Role = string;

export interface RoleDef {
  id: string;
  key: string;
  name: string;
  description: string;
  is_system: boolean;
  created_at: string;
}

export interface Profile {
  id: string;
  username: string;
  full_name: string;
  email: string;
  role: Role;
  team_lead_id: string | null;
  is_active: boolean;
  password_hash: string;
  must_change_password: boolean;
  avatar_url: string | null;
  created_at: string;
}

// Pre-sale statuses (new/ringing/hung_up/cbr/rsrv/ready_to_ship) are
// agent-driven; a lead becomes a sale on entering ready_to_ship (which also
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
  | "ready_to_ship"
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
  | "deleted";

/** Outbound sync state. "Needs review" is not a status of its own — it is the
 * sync_failed state once the retry budget is exhausted, rendered as
 * "Sync Failed — needs review". */
export type PancakeSyncStatus = "not_synced" | "syncing" | "synced" | "sync_failed";

export const PANCAKE_SYNC_STATUS_LABELS: Record<PancakeSyncStatus, string> = {
  not_synced: "Not Synced",
  syncing: "Syncing",
  synced: "Synced",
  sync_failed: "Sync Failed",
};

/** Field defaults for a brand-new order that has never been forwarded to
 * Pancake POS — spread into every order-creation site (form, import, seed). */
export const ORDER_PANCAKE_DEFAULTS = {
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
  product_id: string | null; // source of truth for the selected product going forward
  product_name: string; // denormalized display text (legacy free-text for old rows)
  variant: string | null; // selected variant, when the product defines any
  quantity: number;
  unit_price: number | null; // blank until the agent fills it in
  discount: number; // per-order discount, subtracted from the line total
  // Grand total: unit_price * quantity - discount + shipping_fee.
  total_amount: number;
  status: OrderStatus;
  // Date the lead most recently entered ready_to_ship; overwritten each time it
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
  notes: string;
  created_by: string;
  updated_by: string | null;
  agent_id: string;
  assigned_agent_email: string;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  name: string;
  code: string | null;
  // Pancake POS variation ID (or SKU) this product maps to. Pancake requires
  // items[].variation_id on every forwarded order; `code` is used as a
  // fallback since Pancake accepts a SKU in the same field.
  pancake_variation_id: string | null;
  /** Optional variant names; when set, an order using this product picks one. */
  variants: string[] | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
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

export type PancakeSyncAction = "forward" | "status_update" | "poll" | "manual_sync" | "retry";
export type PancakeSyncSource =
  | "webhook"
  | "api_polling"
  | "manual_sync"
  | "internal_user"
  | "auto_retry"
  | "ready_to_ship_event";

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

export interface DbShape {
  schema_version: number;
  attendance_sweep_cursor: string | null; // last work_date (YYYY-MM-DD) fully processed by the auto-absent sweep
  profiles: Profile[];
  roles: RoleDef[];
  orders: Order[];
  products: Product[];
  attendance: Attendance[];
  call_logs: CallLog[];
  call_log_records: CallLogRecord[];
  activity_log: ActivityLogEntry[];
  role_permissions: RolePermission[];
  leave_requests: LeaveRequest[];
  notifications: AppNotification[];
  schedules: Schedule[];
  suspensions: Suspension[];
  order_seq: Record<string, number>; // date -> last sequence number
  performance_thresholds: PerformanceThresholds;
  work_schedule: WorkSchedule;
}
