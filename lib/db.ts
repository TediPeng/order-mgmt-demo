import { cache } from "react";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import type { DbShape, Profile, RolePermission, RoleDef, WorkSchedule } from "./types";
import { ORDER_PANCAKE_DEFAULTS } from "./types";
import { buildDefaultRows } from "./permissions";
import { randomTempPassword } from "./passwords";
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
    key: "administrator",
    name: "Administrator",
    description:
      "Full system access: users, roles and permissions, all leads and reports, products, Pancake POS integration, update logs, and permanent deletion.",
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
  const administratorId = uuid();
  const teamLeadId = uuid();
  const agentId = uuid();

  // Seeded only into a completely empty database. Each account gets a random
  // password it must change on first login — there is no documented default.
  const seedPassword = () => bcrypt.hashSync(randomTempPassword(), 10);

  const profileDefaults = {
    contact_number: null,
    avatar_url: null,
    theme_preference: "light" as const,
    permission_profile: null,
    last_login_at: null,
    is_deleted: false,
    deleted_at: null,
    must_change_password: true,
    is_active: true,
  };

  const profiles: Profile[] = [
    {
      id: administratorId,
      username: "ROMA_admin",
      full_name: "Alex Rivera",
      email: "admin@demo.local",
      role: "administrator",
      team_lead_id: null,
      call_name: null,
      password_hash: seedPassword(),
      created_at: nowIso(),
      ...profileDefaults,
    },
    {
      id: teamLeadId,
      username: "ROMA_morgan",
      full_name: "Morgan Chen",
      email: "manager@demo.local",
      role: "team_lead",
      team_lead_id: null,
      call_name: null,
      password_hash: seedPassword(),
      created_at: nowIso(),
      ...profileDefaults,
    },
    {
      id: agentId,
      username: "ROMA_jamie",
      full_name: "Jamie Santos",
      email: "employee@demo.local",
      role: "agent",
      team_lead_id: teamLeadId,
      call_name: "JAMIE",
      password_hash: seedPassword(),
      created_at: nowIso(),
      ...profileDefaults,
    },
  ];

  const today = new Date();
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const orderNum = (d: Date, seq: number) =>
    `ORD-${d.toISOString().slice(0, 10).replace(/-/g, "")}-${String(seq).padStart(4, "0")}`;

  const productMouseId = uuid();
  const productSpeakerId = uuid();
  const productChargerId = uuid();

  const seedProduct = (id: string, name: string, code: string, price: number) => ({
    id,
    name,
    code,
    sku: code,
    unit: "pc",
    selling_price: price,
    stock_quantity: 0,
    pancake_variation_id: null,
    variants: null,
    status: "active" as const,
    created_by: administratorId,
    created_at: nowIso(),
    updated_by: null,
    updated_at: null,
  });

  const products = [
    seedProduct(productMouseId, "Wireless Mouse", "PRD-0001", 450),
    seedProduct(productSpeakerId, "Bluetooth Speaker", "PRD-0002", 1200),
    seedProduct(productChargerId, "USB-C Charger", "PRD-0003", 350),
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
      previous_order_note: null,
      previous_order_status: null,
      product_id: productMouseId,
      product_name: "Wireless Mouse",
      quantity: 1,
      unit_price: 450,
      total_amount: 450,
      ...ORDER_PANCAKE_DEFAULTS,
      status: "packaging" as const,
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
      previous_order_note: null,
      previous_order_status: null,
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
      previous_order_note: null,
      previous_order_status: null,
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
      previous_order_note: null,
      previous_order_status: null,
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
        user_id: administratorId,
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
    pending_deletes: [],
    dirty_orders: [],
    operations: { allow_status_import: false, min_call_seconds: 0 },
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

// activity_log is append-only — logActivity() only ever unshifts, and nothing
// edits or removes an entry — and it is both the fastest-growing and the widest
// table here, since previous_value/updated_value hold whole order snapshots.
// So it is not loaded at all: DbShape.activity_log is an OUTBOX carrying only
// what this request logged, which writeDb() inserts and empties. Reads of the
// trail go through lib/audit-log.ts, which queries the slice a page needs.

/** PostgREST caps a single response at 1000 rows (Supabase's `db-max-rows`).
 * A plain `select("*")` therefore returns the FIRST THOUSAND and says nothing
 * about the rest: with 6,585 orders the dashboard read exactly 1000, and every
 * count, list, export and metric derived from them was quietly wrong.
 *
 * So every table is read in pages until a short page arrives. The explicit
 * order matters as much as the range — without one, Postgres may return rows
 * in a different order per request, which across page boundaries silently
 * duplicates some rows and drops others. */
const PAGE_SIZE = 1000;

async function selectAll(table: string, orderBy = "id"): Promise<{ data: Row[]; error: { message: string } | null }> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("*")
      .order(orderBy, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { data: [], error };
    const page = (data || []) as Row[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return { data: rows, error: null };
  }
}

/** One upsert carrying every row was the whole cost of a large import: 2,400
 * orders of ~50 columns is a multi-megabyte request body and a single enormous
 * statement, measured at 67 SECONDS against 35ms for all the work around it.
 * Vercel cuts the function off long before that, which is why an import of a
 * few thousand rows reported nothing at all. In chunks it is seconds. */
const UPSERT_CHUNK = 500;

async function upsertTable(table: string, rows: Row[], idKey = "id"): Promise<void> {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabaseAdmin.from(table).upsert(chunk, { onConflict: idKey });
    if (error) throw new Error(`Supabase upsert failed for ${table}: ${error.message}`);
  }
}

// deleteRemoved() used to live here: a delete-by-exclusion that removed every
// row absent from the in-memory copy. It is gone rather than left unused,
// because its second branch — no rows in the array, therefore delete the
// entire table — is one stale read away from emptying production.

/**
 * One read per request, shared.
 *
 * A page render calls this at least twice — the authenticated layout needs the
 * user and their notifications, then the page itself needs its own data — and
 * each call was fetching every table again. With 27,000 orders that is two
 * full copies of the table for one page view, and the layout does not look at
 * a single order.
 *
 * React's cache() is per-request, so two renders of the same request share the
 * result and two different requests never do. The object is deliberately the
 * SAME object for both callers: actions mutate the shape in place and persist
 * it with writeDb(), so a second reader seeing those mutations is the
 * behaviour that was already assumed.
 */
export const readDb = cache(() => readDbUncached(true));

/**
 * The same shape with `orders` left empty, for callers that never look at one.
 *
 * The authenticated layout is the case that pays for itself immediately: it
 * renders on every page in the app to draw the sidebar and the notification
 * bell, and it was fetching all 27,000 orders to do it.
 *
 * Use this ONLY where the whole call graph is known not to touch db.orders —
 * an empty array reads as "no orders exist", which is silently wrong rather
 * than loudly broken. writeDb() is safe either way: it upserts what it is
 * given and only deletes what an action explicitly queued, so an empty orders
 * array writes nothing at all.
 */
export const readDbLite = cache(() => readDbUncached(false));

async function readDbUncached(withOrders: boolean): Promise<DbShape> {
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
    rolePermsRes,
    leaveRequestsRes,
    notificationsRes,
    schedulesRes,
    suspensionsRes,
    orderSeqRes,
    appSettingsRes,
  ] = await Promise.all([
    selectAll("roles"),
    selectAll("profiles"),
    withOrders ? selectAll("orders") : Promise.resolve({ data: [] as Row[], error: null }),
    selectAll("products"),
    selectAll("attendance"),
    selectAll("call_logs"),
    selectAll("call_log_records"),
    selectAll("role_permissions"),
    selectAll("leave_requests"),
    selectAll("notifications"),
    selectAll("schedules"),
    selectAll("suspensions"),
    // Keyed by seq_date, not id.
    selectAll("order_sequences", "seq_date"),
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

  const shape: DbShape = {
    schema_version: SCHEMA_VERSION,
    attendance_sweep_cursor: settings.attendance_sweep_cursor,
    profiles: (profilesRes.data || []) as unknown as DbShape["profiles"],
    roles: (rolesRes.data || []) as unknown as DbShape["roles"],
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
    })) as unknown as DbShape["orders"],
    products: (productsRes.data || []) as unknown as DbShape["products"],
    attendance: (attendanceRes.data || []).map((a) => ({
      ...a,
      total_hours: numOrNull(a.total_hours),
      overtime_hours: num(a.overtime_hours),
      scheduled_time_in: time5(a.scheduled_time_in),
      scheduled_time_out: time5(a.scheduled_time_out),
    })) as unknown as DbShape["attendance"],
    call_logs: (callLogsRes.data || []) as unknown as DbShape["call_logs"],
    call_log_records: (callLogRecordsRes.data || []) as unknown as DbShape["call_log_records"],
    // Outbox, not history: only what this request logs. See the note above.
    activity_log: [],
    role_permissions: (rolePermsRes.data || []) as unknown as DbShape["role_permissions"],
    leave_requests: (leaveRequestsRes.data || []) as unknown as DbShape["leave_requests"],
    notifications: (notificationsRes.data || []) as unknown as DbShape["notifications"],
    schedules: (schedulesRes.data || []).map((s) => ({
      ...s,
      duty_start: time5OrNull(s.duty_start),
      duty_end: time5OrNull(s.duty_end),
    })) as unknown as DbShape["schedules"],
    suspensions: (suspensionsRes.data || []) as unknown as DbShape["suspensions"],
    order_seq: Object.fromEntries((orderSeqRes.data || []).map((r) => [r.seq_date, r.last_seq])),
    performance_thresholds: {
      top_performer_min_ratio: num(settings.top_performer_min_ratio),
      needs_improvement_max_ratio: num(settings.needs_improvement_max_ratio),
      rts_warning_threshold_pct: num(settings.rts_warning_threshold_pct),
    },
    operations: {
      allow_status_import: Boolean(settings.allow_status_import),
      min_call_seconds: num(settings.min_call_seconds ?? 0),
    },
    work_schedule: {
      work_start: time5(settings.work_start),
      work_end: time5(settings.work_end),
      break_minutes: settings.break_minutes,
      timezone: settings.timezone,
      auto_mark_absent: settings.auto_mark_absent,
      require_attachment_for_sick_leave: settings.require_attachment_for_sick_leave,
    },
    // Empty on read, like activity_log: it carries only what this request asks
    // to delete.
    pending_deletes: [],
    dirty_orders: [],
  };

  return shape;
}

/** Marks a row for deletion. Call it wherever a row is spliced out of one of
 * the DbShape arrays — removing it from the array keeps the rest of this
 * request consistent, and this is what makes the removal reach the database.
 *
 * Both steps are needed. Neither is inferred from the other any more. */
export function queueDelete(db: DbShape, table: string, id: string, key = "id"): void {
  db.pending_deletes.push({ table, id, key });
}

/** Says that this order changed and must be written.
 *
 * writeDb() used to upsert every order it held, so a single status change
 * rewrote the whole table — 57,000 rows through 116 requests for one edit.
 * It now writes only what is marked here. Call this wherever a field on an
 * order is assigned, or a new order is pushed into db.orders; an unmarked
 * change does not reach the database. */
export function markOrderDirty(db: DbShape, orderId: string): void {
  if (!db.dirty_orders.includes(orderId)) db.dirty_orders.push(orderId);
}

export async function writeDb(db: DbShape): Promise<void> {
  const orderSeqRows: Row[] = Object.entries(db.order_seq).map(([seq_date, last_seq]) => ({ seq_date, last_seq }));

  // The outbox: everything in here was logged during this request, so all of it
  // is new. Drained below once written, so a second writeDb() in the same
  // request does not re-send it.
  const newActivity = [...db.activity_log];

  // Phase 1: upsert parent-before-child so every FK target already exists.
  await upsertTable("roles", db.roles as unknown as Row[]);
  await upsertTable("profiles", db.profiles as unknown as Row[]);
  await Promise.all([
    upsertTable("products", db.products as unknown as Row[]),
    upsertTable("role_permissions", db.role_permissions as unknown as Row[]),
  ]);
  // Only the orders this request changed. See markOrderDirty().
  if (db.dirty_orders.length > 0) {
    const dirty = new Set(db.dirty_orders);
    const rows = db.orders.filter((o) => dirty.has(o.id)) as unknown as Row[];
    await upsertTable("orders", rows);
    // Drained, so a second writeDb() in the same request does not rewrite them.
    db.dirty_orders = [];
  }
  await Promise.all([
    upsertTable("attendance", db.attendance as unknown as Row[]),
    upsertTable("call_logs", db.call_logs as unknown as Row[]),
    upsertTable("leave_requests", db.leave_requests as unknown as Row[]),
    upsertTable("suspensions", db.suspensions as unknown as Row[]),
    upsertTable("notifications", db.notifications as unknown as Row[]),
    upsertTable("activity_log", newActivity as unknown as Row[]),
  ]);
  db.activity_log.length = 0;
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
      allow_status_import: db.operations.allow_status_import,
      min_call_seconds: db.operations.min_call_seconds,
    })
    .eq("id", 1);
  if (settingsError) throw new Error(`Supabase app_settings update failed: ${settingsError.message}`);

  // Phase 2: the deletions this request actually asked for.
  //
  // This used to be delete-by-exclusion — every row in the database absent
  // from the in-memory array was removed. That is correct for one request at
  // a time and destructive for two: a row created by a concurrent request
  // after this one read is also absent, and was being deleted on that basis,
  // silently and with nothing in the audit trail. Under twenty agents that is
  // not a rare race, it is a Tuesday.
  //
  // Only queueDelete() puts anything here, so a stale snapshot can no longer
  // remove a row it never knew about. Drained child-before-parent, in the same
  // order the exclusion sweep used, so a delete never strands a foreign key.
  await drainDeletes(db, ["call_log_records", "schedules"]);
  await drainDeletes(db, ["attendance", "call_logs", "leave_requests", "suspensions", "notifications"]);
  await drainDeletes(db, ["orders"]);
  await drainDeletes(db, ["products", "role_permissions"]);
  await drainDeletes(db, ["profiles"]);
  await drainDeletes(db, ["roles", "order_sequences"]);

  // Anything queued against a table not listed above would otherwise be
  // dropped without a word. Better to fail loudly than to acknowledge a
  // deletion that never happened.
  if (db.pending_deletes.length > 0) {
    const tables = Array.from(new Set(db.pending_deletes.map((d) => d.table))).join(", ");
    throw new Error(`writeDb: queued deletes for unhandled table(s): ${tables}`);
  }
}

/** Deletes the queued rows for the given tables and removes them from the
 * outbox, so a second writeDb() in the same request does not repeat them. */
async function drainDeletes(db: DbShape, tables: string[]): Promise<void> {
  const taken = db.pending_deletes.filter((d) => tables.includes(d.table));
  if (taken.length === 0) return;
  db.pending_deletes = db.pending_deletes.filter((d) => !tables.includes(d.table));

  const byTable = new Map<string, { key: string; ids: string[] }>();
  for (const d of taken) {
    const key = d.key || "id";
    const entry = byTable.get(`${d.table}|${key}`) || { key, ids: [] };
    entry.ids.push(d.id);
    byTable.set(`${d.table}|${key}`, entry);
  }

  await Promise.all(
    Array.from(byTable, async ([tableKey, { key, ids }]) => {
      const table = tableKey.split("|")[0];
      const { error } = await supabaseAdmin.from(table).delete().in(key, ids);
      if (error) throw new Error(`Supabase delete failed for ${table}: ${error.message}`);
    })
  );
}

export function nextOrderNumber(db: DbShape, date: Date = new Date()): string {
  const key = date.toISOString().slice(0, 10);
  const seq = (db.order_seq[key] ?? 0) + 1;
  db.order_seq[key] = seq;
  return `ORD-${key.replace(/-/g, "")}-${String(seq).padStart(4, "0")}`;
}

export { uuid, nowIso };
