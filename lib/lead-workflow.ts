import {
  PACKAGING_REQUIRED_FIELDS,
  REQUIRES_PRIOR_PACKAGING,
  LEAD_STATUS_LABELS,
  PACKAGING_STATUS,
  AGENT_EDITABLE_STATUSES,
} from "@/lib/validation";
import { normalizePhone, isValidPhMobile } from "@/lib/utils";
import type { DbShape, Order, OrderStatus, Profile } from "@/lib/types";
import { isFullAccess } from "@/lib/permissions";

export interface PackagingCandidate {
  customer_name: string;
  customer_phone: string;
  purok?: string;
  barangay: string;
  city: string;
  province: string;
  product_id?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
}

export interface PackagingFieldProblem {
  /** Form field name, so the UI can put the message on the field itself. */
  field: string;
  label: string;
  message: string;
}

/** Per-field problems blocking a transition into Packaging. Address codes are
 * checked here for presence only; whether the province/city/barangay actually
 * nest is a database question, answered by validateAddressCodes in lib/psgc.ts. */
export function packagingProblems(candidate: PackagingCandidate): PackagingFieldProblem[] {
  const values: Record<string, unknown> = {
    customer_name: candidate.customer_name,
    customer_phone: candidate.customer_phone,
    purok: candidate.purok,
    barangay: candidate.barangay,
    city: candidate.city,
    province: candidate.province,
    product_id: candidate.product_id,
    quantity: candidate.quantity,
    unit_price: candidate.unit_price,
  };

  const problems: PackagingFieldProblem[] = [];
  for (const { key, label } of PACKAGING_REQUIRED_FIELDS) {
    const v = values[key];
    if (key === "unit_price") {
      // Present AND greater than zero — a free order is not a sale.
      if (v === null || v === undefined || Number(v) <= 0) {
        problems.push({ field: key, label, message: `${label} is required and must be greater than 0.` });
      }
      continue;
    }
    if (key === "quantity") {
      if (v === null || v === undefined || !Number.isFinite(Number(v)) || Number(v) < 1) {
        problems.push({ field: key, label, message: `${label} must be at least 1.` });
      }
      continue;
    }
    if (!String(v ?? "").trim()) {
      problems.push({ field: key, label, message: `${label} is required.` });
      continue;
    }
    // Presence is not enough for the phone: the courier has to be able to call it.
    if (key === "customer_phone" && !isValidPhMobile(String(v))) {
      problems.push({
        field: key,
        label,
        message: "Enter a valid PH mobile number (e.g. 09171234567).",
      });
    }
  }
  return problems;
}

/** Labels only — the shape the existing error strings are built from. */
export function validatePackaging(candidate: PackagingCandidate): string[] {
  return packagingProblems(candidate).map((p) => p.label);
}

/** Who may set orders.tag: Administrators and Team Leads. An agent reads it —
 * it is a supervisor's mark on their order, not theirs to change. Lives here
 * rather than beside the action because a "use server" module may only export
 * async functions. */
export function canSetOrderTag(user: Pick<Profile, "role">): boolean {
  return isFullAccess(user.role) || user.role === "team_lead";
}

/** Every fulfillment stage past Packaging is downstream of it — a lead must
 * already have an order_date (i.e. have passed through Packaging at least once)
 * before it can move into any of them. */
export function pipelineBlockReason(order: Pick<Order, "order_date">, newStatus: OrderStatus): string | null {
  if ((REQUIRES_PRIOR_PACKAGING as readonly string[]).includes(newStatus) && !order.order_date) {
    return `This lead must pass through Packaging before it can be marked as ${LEAD_STATUS_LABELS[newStatus]}.`;
  }
  return null;
}

/** Statuses past Packaging belong to Pancake sync, so only full-access users
 * may set them by hand — at any point in the lead's life, not just after it has
 * been forwarded. Callers turn this into a 403. */
export function restrictedStatusBlockReason(newStatus: OrderStatus, userIsFullAccess: boolean): string | null {
  if (userIsFullAccess) return null;
  if ((AGENT_EDITABLE_STATUSES as readonly string[]).includes(newStatus)) return null;
  return `${LEAD_STATUS_LABELS[newStatus]} is set by fulfillment, not by agents. You can set ${AGENT_EDITABLE_STATUSES.map(
    (s) => LEAD_STATUS_LABELS[s]
  ).join(", ")}.`;
}

/**
 * Once an order has been forwarded to Pancake POS, its status is driven by
 * sync — manual changes are Administrator-only. Pre-forward leads are
 * unaffected.
 *
 * An active Administrator unlock counts as that Administrator's decision.
 *
 * Without this the two rules contradicted each other on screen: the unlock
 * banner said an Administrator had opened the order for editing, and the save
 * was refused directly beneath it with "Only an Administrator can change it
 * manually". Both sentences were true and the pair was useless — an unlock is
 * granted so that somebody else can make the change, and the change people
 * grant it for is the status. Order 24984 was unlocked with the reason "re
 * order", to put a cancelled order back in the pipeline, and then refused.
 *
 * It does not widen what that person may set. restrictedStatusBlockReason still
 * holds them to AGENT_EDITABLE_STATUSES, so Delivered and Returned stay out of
 * reach; the unlock is Administrator-only, needs a written reason, is logged as
 * ORDER_MANUALLY_UNLOCKED, and applyLeadUpdate clears it on the save it paid
 * for. Packaging is on that list and forwards, but forwardOrderToPancake
 * refuses an order that already has a pancake_order_id, so a re-order cannot
 * become a second order in Pancake.
 */
export function fulfillmentOverrideBlockReason(
  order: Pick<Order, "pancake_order_id" | "forwarded_to_pancake_at" | "status" | "manual_unlock_active">,
  newStatus: OrderStatus,
  userIsFullAccess: boolean
): string | null {
  const forwarded = Boolean(order.pancake_order_id || order.forwarded_to_pancake_at);
  if (!forwarded || newStatus === order.status || userIsFullAccess) return null;
  if (order.manual_unlock_active) return null;
  return "This order was forwarded to Pancake POS; its status is managed by sync. Only an Administrator can change it manually.";
}

/** The exact wording shown wherever a synced order blocks an edit. */
export const SYNCED_LOCK_MESSAGE =
  "This order has already been synced to Pancake POS and can no longer be edited.";

/**
 * A synced order is frozen: customer, address, product, price and status are all
 * off-limits, and only Pancake may move it afterwards. An Administrator can lift
 * the lock for a single save via the unlock flow, which sets
 * `manual_unlock_active` and is cleared again as soon as that save lands.
 *
 * Incoming Pancake updates are deliberately NOT routed through this check — they
 * write via lib/pancake/store.ts#updateOrderSyncFields, which is the intended
 * update path for a locked order.
 */
export function isOrderLocked(
  order: Pick<Order, "pancake_sync_status" | "manual_unlock_active">
): boolean {
  return order.pancake_sync_status === "synced" && !order.manual_unlock_active;
}

/** Non-null reason when a manual edit must be rejected. Callers turn this into a
 * 403 as well as disabling the inputs. */
export function lockedEditBlockReason(
  order: Pick<Order, "pancake_sync_status" | "manual_unlock_active">
): string | null {
  return isOrderLocked(order) ? SYNCED_LOCK_MESSAGE : null;
}

/** Order Date is stamped/overwritten only when entering Packaging (including
 * re-entry — the latest Packaging date wins); every other transition leaves it
 * untouched. */
export function computeOrderDate(order: Pick<Order, "order_date">, newStatus: OrderStatus, today: string): string | null {
  if (newStatus === PACKAGING_STATUS) return today;
  return order.order_date;
}

/** Most recent packaged lead for this phone number (normalized), used to
 * auto-fill Previous Order Date/Product/Amount/Note when the file/form doesn't
 * supply them. Any lead with an order_date has reached Packaging, so the date
 * is the marker rather than the current status — an order that has since moved
 * on to Shipped or Delivered still counts as a previous order.
 *
 * The note carried across is that order's own Notes, which is where an agent
 * records what the customer asked for or agreed to. */
export interface PreviousOrderInfo {
  date: string;
  product: string;
  amount: number;
  note: string;
  /** Where that order ended up — delivered, returned, cancelled and so on. */
  status: string;
}

function describePrevious(db: DbShape, best: Order): PreviousOrderInfo {
  const product = best.product_id ? db.products.find((p) => p.id === best.product_id)?.name : best.product_name;
  return {
    date: best.order_date as string,
    product: product || best.product_name || "",
    amount: best.total_amount,
    note: best.notes || "",
    status: best.status,
  };
}

/**
 * The previous-order answer for every phone number at once.
 *
 * This is the definition of record for the rule — only orders that reached
 * Packaging count, matching is on the canonical phone, the latest date wins —
 * and previous_order_for_phone() in SQL is a transcription of it. Change them
 * together.
 *
 * The single-lead form asks the database (previousOrderForPhone in
 * lib/orders-lookup.ts). The index stays for the import, which holds every
 * order in memory for its own dedupe anyway and would otherwise pay a round
 * trip per row. It is built once before the loop: doing it per row walked
 * every order for every line of the file, against an array the loop was
 * growing — quadratic, and the reason a two-thousand-row import ran past the
 * function timeout with the page still saying "Importing…".
 *
 * Rows created BY the import never belong in it anyway — they have no
 * order_date until they reach Packaging — so a snapshot taken up front is not
 * merely a shortcut, it is the same result.
 */
export function buildPreviousOrderIndex(db: DbShape): Map<string, PreviousOrderInfo> {
  const bestByPhone = new Map<string, Order>();
  for (const o of db.orders) {
    if (!o.order_date) continue;
    const phone = normalizePhone(o.customer_phone);
    if (!phone) continue;
    const current = bestByPhone.get(phone);
    if (!current || (o.order_date as string) > (current.order_date as string)) bestByPhone.set(phone, o);
  }

  const index = new Map<string, PreviousOrderInfo>();
  for (const [phone, best] of bestByPhone) index.set(phone, describePrevious(db, best));
  return index;
}

/** Lookup against the index above, with the same normalisation as the walk. */
export function previousOrderFor(index: Map<string, PreviousOrderInfo>, phone: string): PreviousOrderInfo | null {
  const target = normalizePhone(phone);
  if (!target) return null;
  return index.get(target) || null;
}
