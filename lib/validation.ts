import { z } from "zod";
import { PRODUCT_STATUSES, type ProductStatus } from "./types";

// Pre-sale statuses cover the call workflow. `new` sits here because a lead
// starts there, but agents cannot set it back — see AGENT_EDITABLE_STATUSES.
export const PRE_SALE_STATUSES = ["new", "ringing", "hung_up", "cbr", "rsrv"] as const;

// Fulfillment statuses mirror Pancake POS's own order statuses one-for-one, in
// Pancake's pipeline order, so what an agent sees here is what the fulfillment
// team sees there. The Pancake code each one maps to lives in the editable
// pancake_status_map table (seeded to match); PANCAKE_STATUS_HINTS in
// lib/pancake/config.ts carries Pancake's own wording for each code.
// `delivered` keeps its internal name even though Pancake calls it "Received",
// because Delivered Orders and RTS % are defined against it.
export const FULFILLMENT_STATUSES = [
  "waiting_confirmation",
  "confirmed",
  "restocking",
  "purchased",
  "wait_for_printing",
  "printed",
  "packaging",
  "waiting_pickup",
  "shipped",
  "delivered",
  "collected_money",
  "returning",
  "partial_return",
  "returned",
  "cancelled",
  "deleted",
  // Not a Pancake status: set by the ODZ tag rule (lib/pancake/receive.ts) when
  // Pancake reports an `ODZ` tag on the order. Listed last so it doesn't
  // disturb Pancake's own pipeline ordering above.
  "odz",
] as const;

export const LEAD_STATUSES = [...PRE_SALE_STATUSES, ...FULFILLMENT_STATUSES] as const;

export const LEAD_STATUS_LABELS: Record<(typeof LEAD_STATUSES)[number], string> = {
  new: "New",
  ringing: "Ringing",
  hung_up: "Hung Up",
  cbr: "CBR",
  rsrv: "RSRV",
  waiting_confirmation: "Waiting for Confirmation",
  confirmed: "Confirmed",
  restocking: "Restocking",
  purchased: "Purchased",
  wait_for_printing: "Waiting for Printing",
  printed: "Printed",
  packaging: "Packaging",
  waiting_pickup: "Waiting for Pick Up",
  shipped: "Shipped",
  delivered: "Delivered",
  collected_money: "Collected Money",
  returning: "Returning",
  partial_return: "Partial Return",
  returned: "Returned",
  cancelled: "Cancelled",
  deleted: "Deleted in Pancake",
  odz: "ODZ",
};

// Statuses that represent a converted sale: Packaging plus every stage where
// the sale is still standing. The return path and cancellations are failed
// sales and stay excluded, so Sales figures don't count them.
// ODZ is included: the order reached Packaging and is not Returned, so it stays
// in Total Orders and Sales while being excluded from RTS % (which compares
// Delivered against Returned only).
export const SALE_STATUSES = [
  "waiting_confirmation",
  "confirmed",
  "restocking",
  "purchased",
  "wait_for_printing",
  "printed",
  "packaging",
  "waiting_pickup",
  "shipped",
  "delivered",
  "collected_money",
  "odz",
] as const;

/** Packaging is the single "order is ready" status: agents set it, it stamps
 * the Order Date and it triggers the Pancake forward. Pancake creates the
 * order at its own Packaging (code 8), so both systems read the same word. */
export const PACKAGING_STATUS = "packaging" as const;

/** The only statuses a non-full-access user may set. Everything else after
 * Packaging belongs to Pancake, and `new` is the system's own starting point.
 * Enforced server-side in lib/lead-workflow.ts — the UI merely matches it. */
export const AGENT_EDITABLE_STATUSES = ["packaging", "ringing", "hung_up", "cbr", "rsrv"] as const;

// Every fulfillment stage past Packaging is downstream of it; a lead must have
// passed through Packaging at least once (i.e. already have an order_date)
// before it can move into any of them.
export const REQUIRES_PRIOR_PACKAGING = FULFILLMENT_STATUSES.filter((s) => s !== PACKAGING_STATUS);

// Terminal fulfillment statuses: Pancake sync never moves these backward
// automatically; terminal-to-terminal changes are allowed with a full log.
export const TERMINAL_STATUSES = ["delivered", "collected_money", "returned", "cancelled", "deleted"] as const;

/** Statuses Pancake could still move on, so the polling fallback keeps asking
 * about them. Derived rather than listed, so a new fulfillment status is
 * covered automatically. */
export const POLLABLE_STATUSES = FULFILLMENT_STATUSES.filter(
  (s) => !(TERMINAL_STATUSES as readonly string[]).includes(s)
);

/** Statuses a user may pick by hand. Everything past Packaging belongs to
 * Pancake sync, so only full-access users get those in a dropdown — everyone
 * else works the call pipeline and lets Packaging hand the order over. The
 * server enforces the same rule (lead-workflow.ts); this just stops the UI
 * offering choices that would be rejected with a 403. `current` is always
 * included so an order already in a fulfillment status still shows its value. */
/** Statuses a brand-new lead may be created in. Every fulfillment stage past
 * Packaging requires a prior Packaging (there is no order_date yet), so only the
 * pre-sale set plus Packaging is offered. `new` is the system's own starting
 * point and is withheld from agents entirely (Section 3) — a full-access user
 * may still create a lead sitting in New. */
export function creatableStatuses(userIsFullAccess: boolean): readonly (typeof LEAD_STATUSES)[number][] {
  const base = AGENT_EDITABLE_STATUSES as readonly (typeof LEAD_STATUSES)[number][];
  return userIsFullAccess ? (["new", ...base] as (typeof LEAD_STATUSES)[number][]) : base;
}

export function selectableStatuses(
  userIsFullAccess: boolean,
  current?: string
): readonly (typeof LEAD_STATUSES)[number][] {
  if (userIsFullAccess) return LEAD_STATUSES;
  const base = AGENT_EDITABLE_STATUSES as readonly (typeof LEAD_STATUSES)[number][];
  if (current && !base.includes(current as (typeof LEAD_STATUSES)[number])) {
    return [current as (typeof LEAD_STATUSES)[number], ...base];
  }
  return base;
}

/** A date value, normalised to YYYY-MM-DD, shared by the lead form and the
 * Excel import.
 *
 * Postgres owns the `date` type behind previous_order_date, so a value that is
 * not a date has to be refused HERE. Treating it as free text let a stray
 * product description ("1 AVOCADO COFFEE x 1", from a file whose columns were
 * shifted) travel all the way to the upsert, where Postgres rejected the entire
 * batch — every other row of that import was lost with it and the page 500'd.
 * Rejected at the schema it becomes a row-level "invalid" in the import summary
 * and the error report instead, naming the row that needs fixing; on the modal's
 * PATCH route it becomes a 400 rather than a crash.
 *
 * Accepts what the sources actually hand over: "" for blank, a real Date from
 * Excel, ISO (2026-07-15) from <input type="date">, and the M/D/YYYY a
 * PH-locale spreadsheet writes. */
const DATE_MESSAGE = "Previous Order Date must be a date (e.g. 2026-07-15)";

/** The calendar day an Excel date cell shows, as YYYY-MM-DD.
 *
 * Excel stores a date-only cell as a timezone-naive serial; the reader turns it
 * into a local Date, and float rounding lands some a few seconds BEFORE local
 * midnight — a cell Excel displays as 30-Nov arrives as Nov 29 23:59:35. Both
 * toISOString() and a plain getDate() would then store the 29th. Rounding to
 * the nearest local midnight recovers the day the user actually sees. UTC is
 * deliberately not used: every PH date would shift a day back on its own. */
export function excelDateToYmd(d: Date): string {
  const rounded = new Date(d.getTime() + 12 * 60 * 60 * 1000);
  return [
    rounded.getFullYear(),
    String(rounded.getMonth() + 1).padStart(2, "0"),
    String(rounded.getDate()).padStart(2, "0"),
  ].join("-");
}

function quoteCellValue(v: unknown): string {
  const s = String(v ?? "").trim();
  if (s === "") return "an empty cell";
  return `"${s.length > 40 ? `${s.slice(0, 40)}…` : s}"`;
}

function normalizeDateValue(s: string): string | null {
  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  const slashed = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  let year: number, month: number, day: number;
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (slashed) {
    [year, month, day] = [Number(slashed[3]), Number(slashed[1]), Number(slashed[2])];
  } else {
    return null;
  }
  // new Date() rolls 2026-02-30 over into March rather than failing, so the
  // parts are compared back against what came out.
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const dateCell = z.preprocess(
  (v) => {
    if (v === null || v === undefined) return "";
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? "Invalid Date" : excelDateToYmd(v);
    return String(v).trim();
  },
  z
    .string()
    // The same normaliser decides and converts, so a value can never pass the
    // check in one form and be stored in another.
    .refine((v) => v === "" || normalizeDateValue(v) !== null, {
      // Quoting the value is what makes a swapped column self-evident: the
      // report says the Date column holds "1 AVOCADO COFFEE" rather than
      // leaving the reader to guess which cell the row means.
      error: (issue) => `${DATE_MESSAGE} — got ${quoteCellValue(issue.input)}`,
    })
    .transform((v) => (v === "" ? "" : normalizeDateValue(v)!))
);

export const leadFormSchema = z.object({
  customer_name: z.string().trim().min(1, "Customer name is required"),
  customer_phone: z.string().trim().optional().default(""),
  purok: z.string().trim().optional().default(""),
  barangay: z.string().trim().optional().default(""),
  city: z.string().trim().optional().default(""),
  province: z.string().trim().optional().default(""),
  landmark: z.string().trim().optional().default(""),
  previous_order_date: dateCell,
  previous_order_product: z.string().trim().optional().default(""),
  previous_order_amount: z.coerce.number().nonnegative().optional().nullable(),
  product_id: z.string().trim().optional().default(""),
  // Section 0.6: back on the agent form, so it is part of the schema rather than
  // being read straight off the raw body.
  quantity: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? 1 : v),
    z.coerce.number().int("Quantity must be a whole number").min(1, "Quantity must be at least 1").default(1)
  ),
  unit_price: z.coerce.number().nonnegative("Unit price must be zero or more").optional().nullable(),
  status: z.enum(LEAD_STATUSES).default("new"),
  notes: z.string().trim().optional().default(""),
  agent_id: z.string().trim().min(1, "Agent is required"),
  // Optional Pancake-forward fields (Section 0.2) — NOT required for Ready to Ship.
  shipping_fee: z.coerce.number().nonnegative("Shipping fee must be zero or more").optional().nullable(),
  courier: z.string().trim().optional().default(""),
  payment_method: z.string().trim().optional().default(""),
  order_source: z.string().trim().optional().default(""),
  province_code: z.string().trim().optional().default(""),
  city_code: z.string().trim().optional().default(""),
  barangay_code: z.string().trim().optional().default(""),
  // Pancake POS address IDs from the Select Address picker — what actually
  // gets sent to Pancake.
  pancake_province_id: z.string().trim().optional().default(""),
  pancake_district_id: z.string().trim().optional().default(""),
  pancake_commune_id: z.string().trim().optional().default(""),
  discount: z.coerce.number().nonnegative("Discount must be zero or more").optional().nullable(),
  variant: z.string().trim().optional().default(""),
});

// Suggested values for the free-text Payment Method field (not enforced).
export const PAYMENT_METHOD_SUGGESTIONS = ["COD", "GCash", "Bank Transfer"] as const;

export type LeadFormInput = z.infer<typeof leadFormSchema>;

/** Everything that must be present before a lead can move to Packaging (and
 * therefore be sent to Pancake). Fields the agent cannot see — shipping fee,
 * payment method, courier — are deliberately absent: they come from the
 * integration defaults at forward time, and a missing default is a Management
 * problem raised as Needs Review, never a blocker on the agent's action. */
export const PACKAGING_REQUIRED_FIELDS: { key: keyof LeadFormInput; label: string }[] = [
  { key: "customer_name", label: "Customer Name" },
  { key: "customer_phone", label: "Phone Number" },
  { key: "purok", label: "Address / Purok" },
  { key: "province", label: "Province" },
  { key: "city", label: "City / Municipality" },
  { key: "barangay", label: "Barangay" },
  { key: "product_id", label: "Product" },
  { key: "quantity", label: "Quantity" },
  { key: "unit_price", label: "Unit Price" },
];

/** A spreadsheet cell as text.
 *
 * Excel decides a cell's type for itself: a phone number typed as digits
 * arrives as a `number`, an empty cell as `null`, a date as a `Date`. Requiring
 * a string here rejected such rows with a bare "Invalid input" — blaming a file
 * that was in fact filled in correctly. Coerce instead, and let the per-field
 * rules below decide what is actually missing. */
const textCell = z.preprocess((v) => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return excelDateToYmd(v);
  return String(v).trim();
}, z.string());

/** A numeric cell, tolerant of the number arriving as text ("399", "1,299"). */
const numberCell = z.preprocess((v) => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : v;
}, z.number({ message: "Previous Order Amount must be a number" }).nonnegative("Previous Order Amount must be zero or more").nullable());

export const leadImportRowSchema = z.object({
  agent_name: textCell,
  customer_name: textCell.refine((v) => v.length > 0, "Customer Name is required"),
  customer_phone: textCell,
  purok: textCell,
  barangay: textCell,
  city: textCell,
  province: textCell,
  landmark: textCell,
  previous_order_date: dateCell,
  previous_order_product: textCell,
  previous_order_amount: numberCell,
});

export const LEAD_IMPORT_HEADERS = [
  "Agent",
  "Customer Name",
  "Phone Number",
  "Purok",
  "Barangay",
  "City",
  "Province",
  "Landmark",
  "Previous Order Date",
  "Previous Order Product",
  "Previous Order Amount",
];

// Columns the template must NOT contain — they're generated/completed inside
// the system, not supplied by the uploader.
export const LEAD_IMPORT_FORBIDDEN_HEADERS = ["Order Number", "Order Date", "New Product Order", "Unit Price", "Status"];

const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

export const productFormSchema = z.object({
  name: z.string().trim().min(1, "Product name is required"),
  code: z.string().trim().optional().default(""),
  sku: z.string().trim().optional().default(""),
  unit: z.string().trim().optional().default(""),
  selling_price: z.preprocess(
    emptyToNull,
    z.coerce.number().nonnegative("Selling price must be zero or more").nullable().default(null)
  ),
  stock_quantity: z.preprocess(
    emptyToNull,
    z.coerce.number().int("Stock quantity must be a whole number").nonnegative("Stock quantity must be zero or more").nullable().default(null)
  ),
  status: z.enum(PRODUCT_STATUSES).default("active"),
  pancake_variation_id: z.string().trim().optional().default(""),
});

// --- Product list upload ----------------------------------------------------

export const PRODUCT_UPLOAD_HEADERS = [
  "Product Name",
  "SKU",
  "Unit",
  "Selling Price",
  "Stock Quantity",
  "Status",
  "Date Added",
] as const;

/** Accepts the label an uploader would actually type, in any casing. */
export function parseProductStatus(raw: string): ProductStatus | null {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!key) return "active";
  if (key === "out_of_stock" || key === "outofstock") return "out_of_stock";
  if (key === "active" || key === "inactive") return key;
  return null;
}

export const MAX_PRODUCT_UPLOAD_BYTES = 10 * 1024 * 1024;

export const CALL_LOG_HEADERS = [
  "Caller Name",
  "Phone Number",
  "Call Date",
  "Duration (seconds)",
  "Call Type",
  "Notes",
  "Agent Name",
];

export const callLogRowSchema = z.object({
  caller_name: z.string().trim().optional().default(""),
  phone_number: z.string().trim().optional().default(""),
  call_date: z.string().trim().optional().default(""),
  duration_seconds: z.number().nonnegative("Duration must be zero or more").default(0),
  call_type: z.string().trim().optional().default(""),
  notes: z.string().trim().optional().default(""),
  agent_name: z.string().trim().optional().default(""),
});

export const userFormSchema = z
  .object({
    username: z.string().trim().min(3, "Username must be at least 3 characters"),
    full_name: z.string().trim().min(1, "Full name is required"),
    email: z.string().trim().email("Enter a valid email"),
    role: z.string().trim().min(1, "Role is required"),
    team_lead_id: z.string().trim().optional().default(""),
    // The label an agent's orders are attributed to; becomes orders.order_source.
    call_name: z.string().trim().optional().default(""),
    contact_number: z.string().trim().optional().default(""),
    permission_profile: z.string().trim().optional().default(""),
  })
  // Required for agents specifically: every order they create is stamped with
  // it, so an agent without one would produce orders with no source.
  .refine((d) => d.role !== "agent" || d.call_name.length > 0, {
    message: "Call Name is required for agents",
    path: ["call_name"],
  });

export const passwordChangeSchema = z
  .object({
    current_password: z.string().min(1, "Current password is required"),
    new_password: z.string().min(8, "New password must be at least 8 characters"),
    confirm_password: z.string().min(1, "Please confirm the new password"),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    message: "Passwords do not match",
    path: ["confirm_password"],
  });

export const roleFormSchema = z.object({
  name: z.string().trim().min(2, "Role name is required"),
  description: z.string().trim().optional().default(""),
});

export const attendanceOverrideSchema = z.object({
  user_id: z.string().trim().min(1, "Agent is required"),
  work_date: z.string().trim().min(1, "Date is required"),
  time_in: z.string().trim().min(1, "Time in is required"),
  time_out: z.string().trim().optional().default(""),
  reason: z.string().trim().min(5, "A reason of at least 5 characters is required"),
});

export const ATTENDANCE_STATUSES = [
  "on_time",
  "late",
  "absent",
  "on_leave",
  "half_day",
  "over_break",
  "timed_out",
  "wfh",
  "rest_day",
  "suspended",
] as const;

export const LEAVE_TYPES = ["sick", "emergency", "unpaid"] as const;

export const leaveRequestSchema = z.object({
  leave_start: z.string().trim().min(1, "Start date is required"),
  leave_end: z.string().trim().min(1, "End date is required"),
  leave_type: z.enum(LEAVE_TYPES),
  reason: z.string().trim().min(5, "Please provide a reason (at least 5 characters)"),
});

export const leaveReviewSchema = z.object({
  id: z.string().trim().min(1),
  decision: z.enum(["approved", "rejected", "returned_for_revision", "cancelled"]),
  management_remarks: z.string().trim().optional().default(""),
});

export const attendanceManageSchema = z.object({
  id: z.string().trim().optional().default(""),
  user_id: z.string().trim().min(1, "Employee is required"),
  work_date: z.string().trim().min(1, "Date is required"),
  scheduled_time_in: z.string().trim().min(1, "Scheduled time in is required"),
  scheduled_time_out: z.string().trim().min(1, "Scheduled time out is required"),
  time_in: z.string().trim().optional().default(""),
  time_out: z.string().trim().optional().default(""),
  break_start: z.string().trim().optional().default(""),
  break_end: z.string().trim().optional().default(""),
  status: z.enum(ATTENDANCE_STATUSES),
  remarks: z.string().trim().optional().default(""),
});
