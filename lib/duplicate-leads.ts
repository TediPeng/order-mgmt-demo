import { canonicalPhone } from "@/lib/utils";
import type { Order } from "@/lib/types";

/**
 * Duplicate leads, grouped by CONTACT NUMBER.
 *
 * The phone number is the one field that identifies a person across two rows
 * typed by different people on different days: names arrive as "JOSE B
 * MARADDAG" and "Jose Maraddag", addresses get abbreviated, but the number is
 * either the same number or it is somebody else. Comparison is on the
 * canonical form, so 0917…, +63917… and 917… are one group.
 *
 * A lead with no phone number is not a duplicate of every other lead with no
 * phone number — those are simply unidentified, and they are excluded.
 */

/** An order that must never be deleted from here, and why.
 *
 * The rule is about work already done, not about age: an order that reached
 * Packaging stamped an order date and counts as a sale, and one that reached
 * Pancake exists in another system where deleting this row would not cancel
 * the parcel. Those are reconciled by a human, not swept up by a cleanup. */
export function protectedReason(order: Order): string | null {
  if (order.pancake_order_id || order.forwarded_to_pancake_at) return "Sent to Pancake POS";
  if (order.order_date) return "Reached Packaging (counts as a sale)";
  if (order.status !== "new" && order.status !== "ringing") return `Status is ${order.status.replace(/_/g, " ")}`;
  return null;
}

export interface DuplicateGroup {
  /** Canonical phone, the group's identity. */
  phone: string;
  /** What the agent typed, from the earliest row — for display. */
  phone_display: string;
  orders: Order[];
  /** The row the group keeps by default: the earliest created. It is the one
   * an agent has had longest and the one any call history hangs off. */
  keep: Order;
  /** Everything else, minus anything protected — what a cleanup would remove. */
  removable: Order[];
  /** Rows that are duplicates but must not be swept up. */
  protectedOrders: { order: Order; reason: string }[];
}

export function findDuplicateGroups(orders: Order[]): DuplicateGroup[] {
  const byPhone = new Map<string, Order[]>();
  for (const order of orders) {
    const phone = canonicalPhone(order.customer_phone);
    if (!phone) continue;
    const list = byPhone.get(phone);
    if (list) list.push(order);
    else byPhone.set(phone, [order]);
  }

  const groups: DuplicateGroup[] = [];
  for (const [phone, list] of byPhone) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const keep = sorted[0];
    const rest = sorted.slice(1);
    const removable: Order[] = [];
    const protectedOrders: { order: Order; reason: string }[] = [];
    for (const order of rest) {
      const reason = protectedReason(order);
      if (reason) protectedOrders.push({ order, reason });
      else removable.push(order);
    }
    groups.push({ phone, phone_display: keep.customer_phone, orders: sorted, keep, removable, protectedOrders });
  }

  // Worst first: the number with four copies is the one worth looking at
  // before the two hundred with two.
  return groups.sort((a, b) => b.orders.length - a.orders.length || a.phone.localeCompare(b.phone));
}

export interface DuplicateSummary {
  groups: number;
  duplicateRows: number;
  removableRows: number;
  protectedRows: number;
}

export function summarizeDuplicates(groups: DuplicateGroup[]): DuplicateSummary {
  return {
    groups: groups.length,
    duplicateRows: groups.reduce((n, g) => n + g.orders.length - 1, 0),
    removableRows: groups.reduce((n, g) => n + g.removable.length, 0),
    protectedRows: groups.reduce((n, g) => n + g.protectedOrders.length, 0),
  };
}
