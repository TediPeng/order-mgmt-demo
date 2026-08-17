import type { Order } from "@/lib/types";

/**
 * Duplicate leads are grouped by CONTACT NUMBER.
 *
 * The phone number is the one field that identifies a person across two rows
 * typed by different people on different days: names arrive as "JOSE B
 * MARADDAG" and "Jose Maraddag", addresses get abbreviated, but the number is
 * either the same number or it is somebody else. A lead with no phone number
 * is not a duplicate of every other lead with no phone number — those are
 * simply unidentified, and they are excluded.
 *
 * The grouping itself is SQL now (lib/duplicates-query.ts and the functions
 * lead_phone_key / lead_duplicate_rows): doing it here meant reading every
 * order in the system to render fifty numbers.
 */

/** An order that must never be deleted from the duplicate cleanup, and why.
 *
 * The rule is about work already done, not about age: an order that reached
 * Packaging stamped an order date and counts as a sale, and one that reached
 * Pancake exists in another system where deleting this row would not cancel
 * the parcel. Those are reconciled by a human, not swept up by a cleanup.
 *
 * This is the definition of record. lead_protected_reason() in SQL is a
 * transcription of it and must be changed with it — the page and the sweep ask
 * the database, and this function guards the single-row delete.
 *
 * These are now the ONLY protections. lead_duplicate_rows() used to add a
 * group-level one — 'Another agent holds the lead being kept' — which meant a
 * duplicate group spanning two agents could never be cleaned, and that is the
 * shape nearly all of them have. One number is one lead across the whole floor,
 * so the group collapses to its keeper (the oldest row) whoever holds the rest.
 * What stops a freshly assigned batch from being swept away is importLeadsAction
 * refusing a number anybody already holds, rather than a protection here.
 *
 * Callers should still ask duplicateRemovable() rather than treat a null from
 * this function as permission: it answers for the group, and it is what the
 * page and the sweep agree on. */
export function protectedReason(order: Order): string | null {
  if (order.pancake_order_id || order.forwarded_to_pancake_at) return "Sent to Pancake POS";
  if (order.order_date) return "Reached Packaging (counts as a sale)";
  if (order.status !== "new" && order.status !== "ringing") return `Status is ${order.status.replace(/_/g, " ")}`;
  return null;
}
