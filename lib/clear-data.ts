/**
 * Shared definition of the company data reset — what it clears and what has to
 * be typed to authorise it.
 *
 * A plain module, deliberately NOT "use server": those files may only export
 * async functions, and both the confirmation phrase and the table list are
 * needed by the form as well as by the action that carries it out.
 *
 * The list mirrors scripts/reset-company-data.mjs, child-before-parent.
 * Reference and configuration tables are absent on purpose: roles,
 * role_permissions, products, psgc_*, pancake_accounts, pancake_status_map,
 * app_settings, update_logs and profiles all survive.
 */

export const CLEAR_DATA_PHRASE = "CLEAR ALL DATA";

export interface ClearStep {
  table: string;
  /** `except_kept_customers` exists because orders.customer_id references
   * customers with ON DELETE NO ACTION: a preserved Pancake order still points
   * at its customer, so wiping the table wholesale raises a foreign key error
   * — and it would raise it at the very end, after orders had already gone. */
  scope: "all" | "except_kept_orders" | "except_kept_customers";
  /** Column linking the row to an order, for except_kept_orders. */
  column?: string;
  /** Primary key, where it is not `id`. */
  idColumn?: string;
}

export const CLEAR_PLAN: ClearStep[] = [
  { table: "customer_duplicate_matches", scope: "all" },
  { table: "call_log_images", scope: "all" },
  { table: "agent_call_log_records", scope: "all" },
  { table: "agent_call_log_uploads", scope: "all" },
  { table: "call_log_records", scope: "all" },
  { table: "call_logs", scope: "all" },
  { table: "notifications", scope: "all" },
  { table: "activity_log", scope: "all" },
  { table: "pancake_sync_logs", scope: "except_kept_orders", column: "order_id" },
  { table: "call_sessions", scope: "except_kept_orders", column: "order_id" },
  { table: "product_uploads", scope: "all" },
  { table: "account_deletions", scope: "all" },
  { table: "leave_requests", scope: "all" },
  { table: "schedules", scope: "all" },
  { table: "suspensions", scope: "all" },
  { table: "attendance", scope: "all" },
  { table: "orders", scope: "except_kept_orders", column: "id" },
  { table: "customers", scope: "except_kept_customers" },
  // Keyed by seq_date, not id — clearing it restarts the ORD-YYYYMMDD-####
  // counter from the next order.
  { table: "order_sequences", scope: "all", idColumn: "seq_date" },
];

/** What the confirmation dialog tells the administrator will go, in their
 * words rather than table names. */
export const CLEARED_SUMMARY = [
  "All orders and leads (except those already sent to Pancake)",
  "All customers and duplicate-match history",
  "All call logs, call sessions and uploaded call-log images",
  "All attendance records, leave requests, schedules and suspensions",
  "All notifications and the entire audit log",
  "The daily order-number counter",
];

export const PRESERVED_SUMMARY = [
  "Every user account, role and permission",
  "The product catalogue and address (PSGC) data",
  "Pancake accounts, status mappings and credentials",
  "System settings, thresholds and update logs",
];
