import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import type { DbShape, Profile, RolePermission, RoleDef, WorkSchedule, OrderStatus } from "./types";
import { MODULES } from "./types";
import { MODULE_ACTIONS, defaultAllowed, buildDefaultRows } from "./permissions";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const SCHEMA_VERSION = 7;

function nowIso() {
  return new Date().toISOString();
}

const DEFAULT_WORK_SCHEDULE: WorkSchedule = {
  work_start: "08:00",
  work_end: "17:00",
  break_minutes: 60,
  timezone: process.env.APP_TIMEZONE || "Asia/Manila",
  auto_mark_absent: false,
  require_attachment_for_sick_leave: false,
};

const SYSTEM_ROLE_DEFS: RoleDef[] = [
  {
    id: uuid(),
    key: "management",
    name: "Management",
    description: "Full system access: manage users, roles, settings, and view/export everything.",
    is_system: true,
    created_at: nowIso(),
  },
  {
    id: uuid(),
    key: "administrator",
    name: "Administrator",
    description: "Full system access: account management, permissions, order reassignment, and system configuration. Equivalent bypass to Management.",
    is_system: true,
    created_at: nowIso(),
  },
  {
    id: uuid(),
    key: "team_lead",
    name: "Team Lead",
    description: "Manages an assigned team of agents: reviews orders, uploads call logs, views team performance.",
    is_system: true,
    created_at: nowIso(),
  },
  {
    id: uuid(),
    key: "agent",
    name: "Agent",
    description: "Handles calls and orders; views personal performance and attendance.",
    is_system: true,
    created_at: nowIso(),
  },
];

function seedDb(): DbShape {
  const managementId = uuid();
  const teamLeadId = uuid();
  const agentId = uuid();

  const profiles: Profile[] = [
    {
      id: managementId,
      username: "admin",
      full_name: "Alex Rivera",
      email: "admin@demo.local",
      role: "management",
      team_lead_id: null,
      is_active: true,
      password_hash: bcrypt.hashSync("admin123", 10),
      must_change_password: false,
      avatar_url: null,
      created_at: nowIso(),
    },
    {
      id: teamLeadId,
      username: "manager",
      full_name: "Morgan Chen",
      email: "manager@demo.local",
      role: "team_lead",
      team_lead_id: null,
      is_active: true,
      password_hash: bcrypt.hashSync("manager123", 10),
      must_change_password: false,
      avatar_url: null,
      created_at: nowIso(),
    },
    {
      id: agentId,
      username: "employee",
      full_name: "Jamie Santos",
      email: "employee@demo.local",
      role: "agent",
      team_lead_id: teamLeadId,
      is_active: true,
      password_hash: bcrypt.hashSync("employee123", 10),
      must_change_password: false,
      avatar_url: null,
      created_at: nowIso(),
    },
  ];

  const today = new Date();
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const orderNum = (d: Date, seq: number) =>
    `ORD-${d.toISOString().slice(0, 10).replace(/-/g, "")}-${String(seq).padStart(4, "0")}`;

  const productMouseId = uuid();
  const productSpeakerId = uuid();
  const productChargerId = uuid();

  const products = [
    {
      id: productMouseId,
      name: "Wireless Mouse",
      code: "PRD-0001",
      is_active: true,
      created_by: managementId,
      created_at: nowIso(),
      updated_by: null,
      updated_at: null,
    },
    {
      id: productSpeakerId,
      name: "Bluetooth Speaker",
      code: "PRD-0002",
      is_active: true,
      created_by: managementId,
      created_at: nowIso(),
      updated_by: null,
      updated_at: null,
    },
    {
      id: productChargerId,
      name: "USB-C Charger",
      code: "PRD-0003",
      is_active: true,
      created_by: managementId,
      created_at: nowIso(),
      updated_by: null,
      updated_at: null,
    },
  ];

  const orders = [
    {
      id: uuid(),
      order_number: orderNum(today, 1),
      customer_name: "Maria Lopez",
      customer_phone: "0917-555-0142",
      purok: "",
      barangay: "",
      city: "Manila",
      province: "Metro Manila",
      landmark: "123 Mabini St, Manila",
      previous_order_date: null,
      previous_order_product: null,
      previous_order_amount: null,
      product_id: productMouseId,
      product_name: "Wireless Mouse",
      quantity: 1,
      unit_price: 450,
      total_amount: 450,
      status: "ready_to_ship" as const,
      order_date: ymd(today),
      source: "manual" as const,
      notes: "Repeat customer",
      created_by: agentId,
      updated_by: null,
      agent_id: agentId,
      assigned_agent_email: profiles[2].email,
      created_at: nowIso(),
      updated_at: nowIso(),
    },
    {
      id: uuid(),
      order_number: orderNum(today, 2),
      customer_name: "John Cruz",
      customer_phone: "0918-555-0199",
      purok: "",
      barangay: "",
      city: "Quezon City",
      province: "Metro Manila",
      landmark: "45 Rizal Ave, Quezon City",
      previous_order_date: null,
      previous_order_product: null,
      previous_order_amount: null,
      product_id: null,
      product_name: "",
      quantity: 1,
      unit_price: null,
      total_amount: 0,
      status: "ringing" as const,
      order_date: null,
      source: "manual" as const,
      notes: "",
      created_by: teamLeadId,
      updated_by: null,
      agent_id: teamLeadId,
      assigned_agent_email: profiles[1].email,
      created_at: nowIso(),
      updated_at: nowIso(),
    },
    {
      id: uuid(),
      order_number: orderNum(today, 3),
      customer_name: "Ana Reyes",
      customer_phone: "0919-555-0177",
      purok: "",
      barangay: "",
      city: "Cebu City",
      province: "Cebu",
      landmark: "88 Bonifacio St, Cebu",
      previous_order_date: null,
      previous_order_product: null,
      previous_order_amount: null,
      product_id: null,
      product_name: "",
      quantity: 1,
      unit_price: null,
      total_amount: 0,
      status: "new" as const,
      order_date: null,
      source: "manual" as const,
      notes: "",
      created_by: agentId,
      updated_by: null,
      agent_id: agentId,
      assigned_agent_email: profiles[2].email,
      created_at: nowIso(),
      updated_at: nowIso(),
    },
    {
      id: uuid(),
      order_number: orderNum(today, 4),
      customer_name: "Paolo Garcia",
      customer_phone: "0920-555-0133",
      purok: "",
      barangay: "",
      city: "Davao City",
      province: "Davao del Sur",
      landmark: "12 Del Pilar St, Davao",
      previous_order_date: null,
      previous_order_product: null,
      previous_order_amount: null,
      product_id: productChargerId,
      product_name: "USB-C Charger",
      quantity: 1,
      unit_price: 899,
      total_amount: 899,
      status: "hung_up" as const,
      order_date: null,
      source: "manual" as const,
      notes: "Customer changed mind",
      created_by: teamLeadId,
      updated_by: null,
      agent_id: teamLeadId,
      assigned_agent_email: profiles[1].email,
      created_at: nowIso(),
      updated_at: nowIso(),
    },
  ];

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const attendance = [
    {
      id: uuid(),
      user_id: agentId,
      work_date: ymd(yesterday),
      time_in: new Date(yesterday.setHours(8, 2, 0, 0)).toISOString(),
      time_out: new Date(yesterday.setHours(17, 15, 0, 0)).toISOString(),
      total_hours: 9.22,
      overridden: false,
      override_reason: null,
      overridden_by: null,
      break_start: null,
      break_end: null,
      break_minutes: null,
      scheduled_time_in: DEFAULT_WORK_SCHEDULE.work_start,
      scheduled_time_out: DEFAULT_WORK_SCHEDULE.work_end,
      minutes_late: 2,
      over_break_minutes: 0,
      overtime_hours: 0,
      status: "timed_out" as const,
      remarks: null,
      attachment_path: null,
      created_by: null,
      updated_by: null,
      updated_at: new Date(yesterday).toISOString(),
    },
    {
      id: uuid(),
      user_id: teamLeadId,
      work_date: ymd(yesterday),
      time_in: new Date(yesterday.setHours(8, 30, 0, 0)).toISOString(),
      time_out: new Date(yesterday.setHours(17, 30, 0, 0)).toISOString(),
      total_hours: 9,
      overridden: false,
      override_reason: null,
      overridden_by: null,
      break_start: null,
      break_end: null,
      break_minutes: null,
      scheduled_time_in: DEFAULT_WORK_SCHEDULE.work_start,
      scheduled_time_out: DEFAULT_WORK_SCHEDULE.work_end,
      minutes_late: 30,
      over_break_minutes: 0,
      overtime_hours: 0,
      status: "timed_out" as const,
      remarks: null,
      attachment_path: null,
      created_by: null,
      updated_by: null,
      updated_at: new Date(yesterday).toISOString(),
    },
  ];

  const role_permissions: RolePermission[] = [
    ...buildDefaultRows("team_lead", uuid, nowIso),
    ...buildDefaultRows("agent", uuid, nowIso),
  ];

  return {
    schema_version: SCHEMA_VERSION,
    attendance_sweep_cursor: null,
    profiles,
    roles: SYSTEM_ROLE_DEFS,
    orders,
    products,
    attendance,
    call_logs: [],
    call_log_records: [],
    activity_log: [
      {
        id: uuid(),
        user_id: managementId,
        user_email: profiles[0].email,
        action: "SYSTEM_SEEDED",
        entity_type: null,
        entity_id: null,
        details: { note: "Demo data seeded" },
        module: null,
        previous_value: null,
        updated_value: null,
        ip_address: null,
        device_info: null,
        created_at: nowIso(),
      },
    ],
    role_permissions,
    leave_requests: [],
    notifications: [],
    schedules: [],
    suspensions: [],
    order_seq: { [ymd(today)]: 4 },
    performance_thresholds: { top_performer_min_ratio: 1.2, needs_improvement_max_ratio: 0.8, rts_warning_threshold_pct: 15 },
    work_schedule: DEFAULT_WORK_SCHEDULE,
  };
}

const OLD_ROLE_MAP: Record<string, string> = { admin: "management", manager: "team_lead", employee: "agent" };
const OLD_PERMISSION_KEY_MAP: Record<string, [string, string]> = {
  "orders.create": ["orders", "create"],
  "orders.cancel": ["orders", "edit"],
  "orders.delete": ["orders", "delete"],
  "orders.import": ["orders", "upload"],
  "attendance.view_all": ["attendance", "view"],
  "attendance.export": ["attendance", "export"],
  "call_logs.upload": ["call_logs", "upload"],
  "call_logs.view": ["call_logs", "view"],
  "call_logs.delete": ["call_logs", "delete"],
  "activity_log.view": ["audit_logs", "view"],
};

// Migrates a pre-4S-RETENTION db.json (admin/manager/employee roles, flat
// permission_key rows) into the module x action shape (schema v2). Existing
// accounts and their data are preserved as-is; only role labels and
// permission rows change shape.
function migrateV1toV2(raw: Record<string, unknown>): Record<string, unknown> {
  const profiles = ((raw.profiles as Record<string, unknown>[]) || []).map((p) => ({
    ...p,
    role: OLD_ROLE_MAP[p.role as string] || (p.role as string),
    team_lead_id: (p.team_lead_id as string | null | undefined) ?? null,
  })) as Profile[];

  const orders = ((raw.orders as Record<string, unknown>[]) || []).map((o) => ({
    ...o,
    agent_id: (o.agent_id as string | undefined) ?? (o.created_by as string),
  }));

  const call_log_records = ((raw.call_log_records as Record<string, unknown>[]) || []).map((r) => ({
    ...r,
    agent_id: (r.agent_id as string | null | undefined) ?? null,
  }));

  const attendance = ((raw.attendance as Record<string, unknown>[]) || []).map((a) => ({
    ...a,
    overridden: (a.overridden as boolean | undefined) ?? false,
    override_reason: (a.override_reason as string | null | undefined) ?? null,
    overridden_by: (a.overridden_by as string | null | undefined) ?? null,
  }));

  const activity_log = ((raw.activity_log as Record<string, unknown>[]) || []).map((e) => ({
    ...e,
    module: (e.module as string | null | undefined) ?? null,
    previous_value: e.previous_value ?? null,
    updated_value: e.updated_value ?? null,
    ip_address: (e.ip_address as string | null | undefined) ?? null,
    device_info: (e.device_info as string | null | undefined) ?? null,
  }));

  const migratedRolePerms: RolePermission[] = [];
  const seen = new Set<string>();
  for (const row of (raw.role_permissions as Record<string, unknown>[]) || []) {
    const role = OLD_ROLE_MAP[row.role as string] || (row.role as string);
    const permKey = row.permission_key as string | undefined;
    if (!permKey) continue;
    const mapped = OLD_PERMISSION_KEY_MAP[permKey];
    if (!mapped) continue;
    const [moduleKey, action] = mapped;
    const dedupeKey = `${role}:${moduleKey}:${action}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    migratedRolePerms.push({
      id: (row.id as string) || uuid(),
      role,
      module: moduleKey as RolePermission["module"],
      action: action as RolePermission["action"],
      allowed: row.allowed as boolean,
      updated_by: (row.updated_by as string | null) ?? null,
      updated_at: (row.updated_at as string) || nowIso(),
    });
  }
  for (const role of ["team_lead", "agent"] as const) {
    for (const m of MODULES) {
      for (const a of MODULE_ACTIONS[m]) {
        const dedupeKey = `${role}:${m}:${a}`;
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          migratedRolePerms.push({
            id: uuid(),
            role,
            module: m,
            action: a,
            allowed: defaultAllowed(role, m, a),
            updated_by: null,
            updated_at: nowIso(),
          });
        }
      }
    }
  }

  return {
    schema_version: 2,
    profiles,
    roles: SYSTEM_ROLE_DEFS,
    orders,
    attendance,
    call_logs: raw.call_logs || [],
    call_log_records,
    activity_log,
    role_permissions: migratedRolePerms,
    order_seq: raw.order_seq || {},
    performance_thresholds: { top_performer_min_ratio: 1.2, needs_improvement_max_ratio: 0.8 },
  };
}

// Adds break/late tracking to attendance, leave requests, notifications,
// email-based order assignment, and the work-schedule settings (schema v3).
function migrateV2toV3(raw: Record<string, unknown>): Record<string, unknown> {
  const profiles = (raw.profiles as Profile[]) || [];
  const emailById = new Map(profiles.map((p) => [p.id, p.email]));
  const workSchedule = (raw.work_schedule as WorkSchedule | undefined) || DEFAULT_WORK_SCHEDULE;

  const attendance = ((raw.attendance as Record<string, unknown>[]) || []).map((a) => ({
    break_start: null,
    break_end: null,
    break_minutes: null,
    scheduled_time_in: workSchedule.work_start,
    scheduled_time_out: workSchedule.work_end,
    minutes_late: 0,
    over_break_minutes: 0,
    status: a.time_out ? "timed_out" : "on_time",
    remarks: null,
    attachment_path: null,
    created_by: null,
    updated_by: null,
    updated_at: (a.time_out as string) || (a.time_in as string) || nowIso(),
    ...a, // preserve any fields already present (e.g. re-running migration)
  }));

  const orders = ((raw.orders as Record<string, unknown>[]) || []).map((o) => ({
    updated_by: null,
    assigned_agent_email: emailById.get(o.agent_id as string) || "",
    ...o,
  }));

  const activity_log = ((raw.activity_log as Record<string, unknown>[]) || []).map((e) => ({
    user_email: e.user_id ? emailById.get(e.user_id as string) || null : null,
    ...e,
  }));

  return {
    ...raw,
    schema_version: 3,
    attendance,
    orders,
    activity_log,
    leave_requests: raw.leave_requests || [],
    notifications: raw.notifications || [],
    work_schedule: workSchedule,
  };
}

// Adds the Administrator system role and the auto-absent sweep cursor (schema v4).
function migrateV3toV4(raw: Record<string, unknown>): Record<string, unknown> {
  const roles = (raw.roles as RoleDef[]) || [];
  const hasAdministrator = roles.some((r) => r.key === "administrator");
  const withAdministrator = hasAdministrator
    ? roles
    : [
        ...roles,
        {
          id: uuid(),
          key: "administrator",
          name: "Administrator",
          description:
            "Full system access: account management, permissions, order reassignment, and system configuration. Equivalent bypass to Management.",
          is_system: true,
          created_at: nowIso(),
        },
      ];

  return {
    ...raw,
    schema_version: 4,
    roles: withAdministrator,
    attendance_sweep_cursor: (raw.attendance_sweep_cursor as string | null | undefined) ?? null,
  };
}

// Old order-fulfillment statuses -> new call-workflow/pipeline statuses.
// completed and returned are treated as having already been fulfilled, so
// they're backstamped with created_at as a best-effort order_date since the
// real "became ready to ship" date doesn't exist in pre-v5 data.
const OLD_STATUS_MAP: Record<string, OrderStatus> = {
  new: "new",
  pending: "new",
  completed: "ready_to_ship",
  cancelled: "new",
  returned: "returned",
};
const BACKSTAMP_STATUSES = new Set(["ready_to_ship", "returned"]);

// Converts Orders (order-fulfillment) into Leads (call-center workflow):
// structured address fields (customer_address -> landmark), previous-order
// info, product_id, a real order_date field, the 10-status pipeline, and the
// new products catalog (schema v5).
function migrateV4toV5(raw: Record<string, unknown>): Record<string, unknown> {
  const orders = ((raw.orders as Record<string, unknown>[]) || []).map((o) => {
    const oldStatus = o.status as string;
    const newStatus = OLD_STATUS_MAP[oldStatus] || (oldStatus as OrderStatus);
    const createdAt = (o.created_at as string) || nowIso();
    return {
      ...o,
      purok: (o.purok as string | undefined) ?? "",
      barangay: (o.barangay as string | undefined) ?? "",
      city: (o.city as string | undefined) ?? "",
      province: (o.province as string | undefined) ?? "",
      landmark: (o.landmark as string | undefined) ?? (o.customer_address as string | undefined) ?? "",
      previous_order_date: (o.previous_order_date as string | null | undefined) ?? null,
      previous_order_product: (o.previous_order_product as string | null | undefined) ?? null,
      previous_order_amount: (o.previous_order_amount as number | null | undefined) ?? null,
      product_id: (o.product_id as string | null | undefined) ?? null,
      status: newStatus,
      order_date:
        (o.order_date as string | null | undefined) ??
        (BACKSTAMP_STATUSES.has(newStatus) ? createdAt.slice(0, 10) : null),
      customer_address: undefined,
    };
  });
  // Drop the now-migrated customer_address key entirely.
  for (const o of orders) delete (o as Record<string, unknown>).customer_address;

  return {
    ...raw,
    schema_version: 5,
    orders,
    products: (raw.products as unknown[]) || [],
  };
}

// Adds Work From Home/Rest Day attendance statuses, overtime_hours on
// attendance rows, profiles.avatar_url, and the RTS % warning threshold
// setting (schema v6). Purely additive -- no existing rows change meaning.
function migrateV5toV6(raw: Record<string, unknown>): Record<string, unknown> {
  const profiles = ((raw.profiles as Record<string, unknown>[]) || []).map((p) => ({
    avatar_url: null,
    ...p,
  }));
  const attendance = ((raw.attendance as Record<string, unknown>[]) || []).map((a) => ({
    overtime_hours: 0,
    ...a,
  }));
  const thresholds = (raw.performance_thresholds as Record<string, unknown>) || {};

  return {
    ...raw,
    schema_version: 6,
    profiles,
    attendance,
    performance_thresholds: {
      top_performer_min_ratio: 1.2,
      needs_improvement_max_ratio: 0.8,
      ...thresholds,
      rts_warning_threshold_pct: (thresholds.rts_warning_threshold_pct as number | undefined) ?? 15,
    },
  };
}

// Adds the Schedule Creator module: schedules[] and suspensions[] collections
// (schema v7). Purely additive -- no existing rows change.
function migrateV6toV7(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    ...raw,
    schema_version: 7,
    schedules: raw.schedules || [],
    suspensions: raw.suspensions || [],
  };
}

function ensureDb(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(seedDb(), null, 2));
  }
}

export function readDb(): DbShape {
  ensureDb();
  let raw = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  let changed = false;

  if (!raw.schema_version || raw.schema_version < 2) {
    raw = migrateV1toV2(raw);
    changed = true;
  }
  if (raw.schema_version < 3) {
    raw = migrateV2toV3(raw);
    changed = true;
  }
  if (raw.schema_version < 4) {
    raw = migrateV3toV4(raw);
    changed = true;
  }
  if (raw.schema_version < 5) {
    raw = migrateV4toV5(raw);
    changed = true;
  }
  if (raw.schema_version < 6) {
    raw = migrateV5toV6(raw);
    changed = true;
  }
  if (raw.schema_version < 7) {
    raw = migrateV6toV7(raw);
    changed = true;
  }

  if (changed) fs.writeFileSync(DB_PATH, JSON.stringify(raw, null, 2));
  return raw as DbShape;
}

export function writeDb(db: DbShape): void {
  ensureDb();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

export function resetDb(): void {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  ensureDb();
}

export function nextOrderNumber(db: DbShape, date: Date = new Date()): string {
  const key = date.toISOString().slice(0, 10);
  const seq = (db.order_seq[key] ?? 0) + 1;
  db.order_seq[key] = seq;
  return `ORD-${key.replace(/-/g, "")}-${String(seq).padStart(4, "0")}`;
}

export { uuid, nowIso };
