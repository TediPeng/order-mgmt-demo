import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import type { DbShape, Profile, RolePermission, RoleDef, WorkSchedule } from "./types";
import { ORDER_PANCAKE_DEFAULTS } from "./types";
import { buildDefaultRows } from "./permissions";
import { supabaseAdmin } from "./supabaseAdmin";

const SCHEMA_VERSION = 7;

function nowIso() {
  return new Date().toISOString();
}

function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

function num(v: unknown): number {
  return Number(v);
}

function time5(v: unknown): string {
  return String(v).slice(0, 5);
}

function time5OrNull(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v).slice(0, 5);
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
      pancake_variation_id: null,
      variants: null,
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
      pancake_variation_id: null,
      variants: null,
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
      pancake_variation_id: null,
      variants: null,
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
      ...ORDER_PANCAKE_DEFAULTS,
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
      ...ORDER_PANCAKE_DEFAULTS,
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
      ...ORDER_PANCAKE_DEFAULTS,
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
      ...ORDER_PANCAKE_DEFAULTS,
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

// --- Supabase-backed persistence -------------------------------------------
// The rest of the app was built around a single in-memory DbShape object:
// read the whole thing, mutate it with plain JS, write the whole thing back.
// To avoid rewriting ~50 call sites' business logic, that contract is kept
// exactly as-is here -- only the storage underneath changed from a local
// JSON file (which doesn't work on Vercel's read-only serverless filesystem)
// to Postgres. readDb() fetches every table and assembles a DbShape;
// writeDb() upserts the current rows and deletes any that were removed.

type Row = Record<string, unknown>;

async function upsertTable(table: string, rows: Row[], idKey = "id"): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabaseAdmin.from(table).upsert(rows, { onConflict: idKey });
  if (error) throw new Error(`Supabase upsert failed for ${table}: ${error.message}`);
}

async function deleteRemoved(table: string, rows: Row[], idKey = "id"): Promise<void> {
  const query = supabaseAdmin.from(table).delete();
  const { error } =
    rows.length > 0
      ? await query.not(idKey, "in", `(${rows.map((r) => `"${r[idKey]}"`).join(",")})`)
      : await query.not(idKey, "is", null);
  if (error) throw new Error(`Supabase delete failed for ${table}: ${error.message}`);
}

export async function readDb(): Promise<DbShape> {
  const { data: existingProfiles, error: checkError } = await supabaseAdmin.from("profiles").select("id").limit(1);
  if (checkError) throw new Error(`Supabase read failed: ${checkError.message}`);

  if (!existingProfiles || existingProfiles.length === 0) {
    const seeded = seedDb();
    await writeDb(seeded);
    return seeded;
  }

  const [
    rolesRes,
    profilesRes,
    ordersRes,
    productsRes,
    attendanceRes,
    callLogsRes,
    callLogRecordsRes,
    activityLogRes,
    rolePermsRes,
    leaveRequestsRes,
    notificationsRes,
    schedulesRes,
    suspensionsRes,
    orderSeqRes,
    appSettingsRes,
  ] = await Promise.all([
    supabaseAdmin.from("roles").select("*"),
    supabaseAdmin.from("profiles").select("*"),
    supabaseAdmin.from("orders").select("*"),
    supabaseAdmin.from("products").select("*"),
    supabaseAdmin.from("attendance").select("*"),
    supabaseAdmin.from("call_logs").select("*"),
    supabaseAdmin.from("call_log_records").select("*"),
    supabaseAdmin.from("activity_log").select("*").order("created_at", { ascending: false }),
    supabaseAdmin.from("role_permissions").select("*"),
    supabaseAdmin.from("leave_requests").select("*"),
    supabaseAdmin.from("notifications").select("*"),
    supabaseAdmin.from("schedules").select("*"),
    supabaseAdmin.from("suspensions").select("*"),
    supabaseAdmin.from("order_sequences").select("*"),
    supabaseAdmin.from("app_settings").select("*").eq("id", 1).single(),
  ]);

  for (const res of [
    rolesRes,
    profilesRes,
    ordersRes,
    productsRes,
    attendanceRes,
    callLogsRes,
    callLogRecordsRes,
    activityLogRes,
    rolePermsRes,
    leaveRequestsRes,
    notificationsRes,
    schedulesRes,
    suspensionsRes,
    orderSeqRes,
    appSettingsRes,
  ]) {
    if (res.error) throw new Error(`Supabase read failed: ${res.error.message}`);
  }

  const settings = appSettingsRes.data!;

  return {
    schema_version: SCHEMA_VERSION,
    attendance_sweep_cursor: settings.attendance_sweep_cursor,
    profiles: (profilesRes.data || []) as DbShape["profiles"],
    roles: (rolesRes.data || []) as DbShape["roles"],
    orders: (ordersRes.data || []).map((o) => ({
      ...o,
      previous_order_amount: numOrNull(o.previous_order_amount),
      unit_price: numOrNull(o.unit_price),
      total_amount: num(o.total_amount),
      shipping_fee: numOrNull(o.shipping_fee),
      discount: num(o.discount ?? 0),
      // Must match the column exactly: writeDb upserts these objects back, so
      // a key that is not a real column fails the whole write.
      pancake_retry_count: num(o.pancake_retry_count ?? 0),
    })) as DbShape["orders"],
    products: (productsRes.data || []) as DbShape["products"],
    attendance: (attendanceRes.data || []).map((a) => ({
      ...a,
      total_hours: numOrNull(a.total_hours),
      overtime_hours: num(a.overtime_hours),
      scheduled_time_in: time5(a.scheduled_time_in),
      scheduled_time_out: time5(a.scheduled_time_out),
    })) as DbShape["attendance"],
    call_logs: (callLogsRes.data || []) as DbShape["call_logs"],
    call_log_records: (callLogRecordsRes.data || []) as DbShape["call_log_records"],
    activity_log: (activityLogRes.data || []) as DbShape["activity_log"],
    role_permissions: (rolePermsRes.data || []) as DbShape["role_permissions"],
    leave_requests: (leaveRequestsRes.data || []) as DbShape["leave_requests"],
    notifications: (notificationsRes.data || []) as DbShape["notifications"],
    schedules: (schedulesRes.data || []).map((s) => ({
      ...s,
      duty_start: time5OrNull(s.duty_start),
      duty_end: time5OrNull(s.duty_end),
    })) as DbShape["schedules"],
    suspensions: (suspensionsRes.data || []) as DbShape["suspensions"],
    order_seq: Object.fromEntries((orderSeqRes.data || []).map((r) => [r.seq_date, r.last_seq])),
    performance_thresholds: {
      top_performer_min_ratio: num(settings.top_performer_min_ratio),
      needs_improvement_max_ratio: num(settings.needs_improvement_max_ratio),
      rts_warning_threshold_pct: num(settings.rts_warning_threshold_pct),
    },
    work_schedule: {
      work_start: time5(settings.work_start),
      work_end: time5(settings.work_end),
      break_minutes: settings.break_minutes,
      timezone: settings.timezone,
      auto_mark_absent: settings.auto_mark_absent,
      require_attachment_for_sick_leave: settings.require_attachment_for_sick_leave,
    },
  };
}

export async function writeDb(db: DbShape): Promise<void> {
  const orderSeqRows: Row[] = Object.entries(db.order_seq).map(([seq_date, last_seq]) => ({ seq_date, last_seq }));

  // Phase 1: upsert parent-before-child so every FK target already exists.
  await upsertTable("roles", db.roles as unknown as Row[]);
  await upsertTable("profiles", db.profiles as unknown as Row[]);
  await Promise.all([
    upsertTable("products", db.products as unknown as Row[]),
    upsertTable("role_permissions", db.role_permissions as unknown as Row[]),
  ]);
  await upsertTable("orders", db.orders as unknown as Row[]);
  await Promise.all([
    upsertTable("attendance", db.attendance as unknown as Row[]),
    upsertTable("call_logs", db.call_logs as unknown as Row[]),
    upsertTable("leave_requests", db.leave_requests as unknown as Row[]),
    upsertTable("suspensions", db.suspensions as unknown as Row[]),
    upsertTable("notifications", db.notifications as unknown as Row[]),
    upsertTable("activity_log", db.activity_log as unknown as Row[]),
  ]);
  await Promise.all([
    upsertTable("call_log_records", db.call_log_records as unknown as Row[]),
    upsertTable("schedules", db.schedules as unknown as Row[]),
  ]);
  await upsertTable("order_sequences", orderSeqRows, "seq_date");

  const { error: settingsError } = await supabaseAdmin
    .from("app_settings")
    .update({
      attendance_sweep_cursor: db.attendance_sweep_cursor,
      work_start: db.work_schedule.work_start,
      work_end: db.work_schedule.work_end,
      break_minutes: db.work_schedule.break_minutes,
      timezone: db.work_schedule.timezone,
      auto_mark_absent: db.work_schedule.auto_mark_absent,
      require_attachment_for_sick_leave: db.work_schedule.require_attachment_for_sick_leave,
      top_performer_min_ratio: db.performance_thresholds.top_performer_min_ratio,
      needs_improvement_max_ratio: db.performance_thresholds.needs_improvement_max_ratio,
      rts_warning_threshold_pct: db.performance_thresholds.rts_warning_threshold_pct,
    })
    .eq("id", 1);
  if (settingsError) throw new Error(`Supabase app_settings update failed: ${settingsError.message}`);

  // Phase 2: delete child-before-parent so nothing still references a
  // soon-to-be-deleted row.
  await Promise.all([
    deleteRemoved("call_log_records", db.call_log_records as unknown as Row[]),
    deleteRemoved("schedules", db.schedules as unknown as Row[]),
  ]);
  await Promise.all([
    deleteRemoved("attendance", db.attendance as unknown as Row[]),
    deleteRemoved("call_logs", db.call_logs as unknown as Row[]),
    deleteRemoved("leave_requests", db.leave_requests as unknown as Row[]),
    deleteRemoved("suspensions", db.suspensions as unknown as Row[]),
    deleteRemoved("notifications", db.notifications as unknown as Row[]),
    deleteRemoved("activity_log", db.activity_log as unknown as Row[]),
  ]);
  await deleteRemoved("orders", db.orders as unknown as Row[]);
  await Promise.all([
    deleteRemoved("products", db.products as unknown as Row[]),
    deleteRemoved("role_permissions", db.role_permissions as unknown as Row[]),
  ]);
  await deleteRemoved("profiles", db.profiles as unknown as Row[]);
  await deleteRemoved("roles", db.roles as unknown as Row[]);
  await deleteRemoved("order_sequences", orderSeqRows, "seq_date");
}

export function nextOrderNumber(db: DbShape, date: Date = new Date()): string {
  const key = date.toISOString().slice(0, 10);
  const seq = (db.order_seq[key] ?? 0) + 1;
  db.order_seq[key] = seq;
  return `ORD-${key.replace(/-/g, "")}-${String(seq).padStart(4, "0")}`;
}

export { uuid, nowIso };
