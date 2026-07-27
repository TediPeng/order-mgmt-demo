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

// Call-workflow statuses (new/hung_up/ringing/cbr/rsrv) precede a sale; a lead
// becomes a sale on entering ready_to_ship, then moves through the fulfillment
// pipeline (printed/shipped/delivered), with returned as a possible final state.
export type OrderStatus =
  | "new"
  | "ready_to_ship"
  | "printed"
  | "shipped"
  | "delivered"
  | "returned"
  | "hung_up"
  | "ringing"
  | "cbr"
  | "rsrv";

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
  quantity: number; // always 1 for leads created under the new workflow; hidden from the UI
  unit_price: number | null; // blank until the agent fills it in
  total_amount: number;
  status: OrderStatus;
  // Date the lead most recently entered ready_to_ship; overwritten each time it
  // re-enters. Blank until then, regardless of created_at.
  order_date: string | null;
  source: "manual" | "import";
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
