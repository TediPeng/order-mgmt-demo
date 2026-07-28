import { z } from "zod";

// Pre-sale statuses are agent-driven; fulfillment statuses are normally set by
// Pancake POS sync after the order is forwarded on Ready to Ship (Management
// can override manually — enforced in lib/lead-workflow.ts).
export const PRE_SALE_STATUSES = ["new", "ringing", "hung_up", "cbr", "rsrv", "ready_to_ship"] as const;

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
] as const;

export const LEAD_STATUSES = [...PRE_SALE_STATUSES, ...FULFILLMENT_STATUSES] as const;

export const LEAD_STATUS_LABELS: Record<(typeof LEAD_STATUSES)[number], string> = {
  new: "New",
  ringing: "Ringing",
  hung_up: "Hung Up",
  cbr: "CBR",
  rsrv: "RSRV",
  ready_to_ship: "Ready to Ship",
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
};

// Statuses that represent a converted sale: Ready to Ship plus every stage
// where the sale is still standing. The return path and cancellations are
// failed sales and stay excluded, so Sales figures don't count them.
export const SALE_STATUSES = [
  "ready_to_ship",
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
] as const;

// Every fulfillment status is downstream of Ready to Ship; a lead must have
// passed through it at least once (i.e. already have an order_date) before it
// can move into any of these.
export const REQUIRES_PRIOR_READY_TO_SHIP = FULFILLMENT_STATUSES;

// Terminal fulfillment statuses: Pancake sync never moves these backward
// automatically; terminal-to-terminal changes are allowed with a full log.
export const TERMINAL_STATUSES = ["delivered", "collected_money", "returned", "cancelled", "deleted"] as const;

/** Statuses a user may pick by hand. Fulfillment statuses belong to Pancake
 * sync, so only full-access users get them in a dropdown — everyone else works
 * the pre-sale pipeline and lets Ready to Ship hand the order over. The server
 * enforces the same rule (lead-workflow.ts), this just stops the UI offering
 * choices that would be rejected. `current` is always included so an order
 * already in a fulfillment status still displays its own value. */
export function selectableStatuses(
  userIsFullAccess: boolean,
  current?: string
): readonly (typeof LEAD_STATUSES)[number][] {
  if (userIsFullAccess) return LEAD_STATUSES;
  const base = PRE_SALE_STATUSES as readonly (typeof LEAD_STATUSES)[number][];
  if (current && !base.includes(current as (typeof LEAD_STATUSES)[number])) {
    return [current as (typeof LEAD_STATUSES)[number], ...base];
  }
  return base;
}

export const leadFormSchema = z.object({
  customer_name: z.string().trim().min(1, "Customer name is required"),
  customer_phone: z.string().trim().optional().default(""),
  purok: z.string().trim().optional().default(""),
  barangay: z.string().trim().optional().default(""),
  city: z.string().trim().optional().default(""),
  province: z.string().trim().optional().default(""),
  landmark: z.string().trim().optional().default(""),
  previous_order_date: z.string().trim().optional().default(""),
  previous_order_product: z.string().trim().optional().default(""),
  previous_order_amount: z.coerce.number().nonnegative().optional().nullable(),
  product_id: z.string().trim().optional().default(""),
  unit_price: z.coerce.number().nonnegative("Unit price must be zero or more").optional().nullable(),
  status: z.enum(LEAD_STATUSES).default("new"),
  notes: z.string().trim().optional().default(""),
  agent_id: z.string().trim().min(1, "Agent is required"),
  // Optional Pancake-forward fields (Section 0.2) — NOT required for Ready to Ship.
  shipping_fee: z.coerce.number().nonnegative("Shipping fee must be zero or more").optional().nullable(),
  courier: z.string().trim().optional().default(""),
  payment_method: z.string().trim().optional().default(""),
  order_source: z.string().trim().optional().default(""),
  discount: z.coerce.number().nonnegative("Discount must be zero or more").optional().nullable(),
  variant: z.string().trim().optional().default(""),
});

// Suggested values for the free-text Payment Method field (not enforced).
export const PAYMENT_METHOD_SUGGESTIONS = ["COD", "GCash", "Bank Transfer"] as const;

export type LeadFormInput = z.infer<typeof leadFormSchema>;

export const READY_TO_SHIP_REQUIRED_FIELDS: { key: keyof LeadFormInput; label: string }[] = [
  { key: "customer_name", label: "Customer Name" },
  { key: "customer_phone", label: "Phone Number" },
  { key: "barangay", label: "Barangay" },
  { key: "city", label: "City" },
  { key: "province", label: "Province" },
  { key: "product_id", label: "New Product Order" },
  { key: "unit_price", label: "Unit Price" },
];

export const leadImportRowSchema = z.object({
  agent_name: z.string().trim().optional().default(""),
  customer_name: z.string().trim().min(1, "Customer Name is required"),
  customer_phone: z.string().trim().optional().default(""),
  purok: z.string().trim().optional().default(""),
  barangay: z.string().trim().optional().default(""),
  city: z.string().trim().optional().default(""),
  province: z.string().trim().optional().default(""),
  landmark: z.string().trim().optional().default(""),
  previous_order_date: z.string().trim().optional().default(""),
  previous_order_product: z.string().trim().optional().default(""),
  previous_order_amount: z.number().nonnegative("Previous Order Amount must be zero or more").optional().nullable(),
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

export const productFormSchema = z.object({
  name: z.string().trim().min(1, "Product name is required"),
  code: z.string().trim().optional().default(""),
  pancake_variation_id: z.string().trim().optional().default(""),
  is_active: z.coerce.boolean().default(true),
});

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

export const userFormSchema = z.object({
  username: z.string().trim().min(3, "Username must be at least 3 characters"),
  full_name: z.string().trim().min(1, "Full name is required"),
  email: z.string().trim().email("Enter a valid email"),
  role: z.string().trim().min(1, "Role is required"),
  team_lead_id: z.string().trim().optional().default(""),
  temp_password: z.string().min(8, "Temporary password must be at least 8 characters"),
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
