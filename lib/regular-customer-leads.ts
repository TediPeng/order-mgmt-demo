import { allCustomers } from "@/lib/customers";
import { ordersForPhones } from "@/lib/orders-lookup";
import { normalizePhone } from "@/lib/utils";
import { PRE_SALE_STATUSES } from "@/lib/validation";
import type { AgentScope } from "@/lib/leads-query";
import type { Order } from "@/lib/types";

/**
 * Why this lead may not be swept, or null.
 *
 * Deliberately NOT `protectedReason` from lib/duplicate-leads.ts, which also
 * protects every status past Ringing. That rule is right for the page beside
 * this one: there both rows are leads, and choosing between two recorded call
 * outcomes is a person's job — the sweep cannot know which of two agents' notes
 * to keep.
 *
 * Here there is nothing to choose. The customer record already holds the
 * history, the ownership and the sharing; the lead is a second copy of a person
 * somebody already keeps, and a call outcome written on it — Cannot Be Reached,
 * Reject Offer, Hung Up — is a note about a call that should not have been made
 * from this row. Protecting those left almost nothing sweepable: every lead
 * anyone had actually rung was out of reach, which is most of them.
 *
 * What stays protected is work that left the building. An order that reached
 * Packaging stamped an order date and counts as a sale. One that reached Pancake
 * exists in a system this database cannot cancel, so deleting the row here would
 * not cancel the parcel — it would only lose our side of it. And any fulfillment
 * status at all means the order is somewhere in that pipeline.
 */
export function sweepBlockReason(order: Order): string | null {
  if (order.pancake_order_id || order.forwarded_to_pancake_at) return "Sent to Pancake POS";
  if (order.order_date) return "Reached Packaging (counts as a sale)";
  if (!(PRE_SALE_STATUSES as readonly string[]).includes(order.status)) {
    return `In fulfillment — status is ${order.status.replace(/_/g, " ")}`;
  }
  return null;
}

/**
 * Leads sitting on a number that is already somebody's regular customer.
 *
 * A different collision from the Duplicate Leads page above it. That one is
 * lead-against-lead: the same number typed twice into the active list. This is
 * lead-against-customer, and it is invisible to that page by construction — a
 * regular customer's own orders are flagged and filtered out of Leads, so the
 * two rows never appear in the same list to be compared.
 *
 * It happens because the two records are made in different places. Tagging a
 * customer moves that agent's orders onto them, but a lead somebody else holds
 * on the same number is untouched, and an upload of a customer list re-created
 * them wholesale until the importer learned to check. So the floor ends up
 * working a person twice: once as a repeat buyer with their history, once as a
 * fresh lead with none of it.
 *
 * The customer record is the one that survives. It carries the order history,
 * the ownership and the sharing; the lead is the accident.
 */
export interface RegularCustomerLead {
  order: Order;
  /** The regular customer whose number this is. */
  customerName: string;
  customerOwnerId: string | null;
  /** Why this lead may not be swept, or null if it may. */
  protectedReason: string | null;
}

export interface RegularCustomerLeadReport {
  rows: RegularCustomerLead[];
  removableIds: string[];
  protectedCount: number;
}

/**
 * Every such lead in scope, with the ones that cannot be swept marked.
 *
 * Driven from the customers table rather than from orders: regular customers
 * are a few thousand at most while orders are tens of thousands, and
 * `orders_for_phone_keys` takes the whole key set in one call. Reading every
 * order and asking each whether it matches would be the wrong way round.
 *
 * What may be swept is `sweepBlockReason` above, not the Duplicate Leads page's
 * own rule — a call outcome on one of these leads is a note about a call that
 * should not have been made from this row, and protecting those left almost
 * nothing sweepable.
 */
export async function regularCustomerLeads(scope: AgentScope): Promise<RegularCustomerLeadReport> {
  const customers = (await allCustomers()).filter((c) => c.is_regular_customer && c.phone_normalized);
  if (customers.length === 0) return { rows: [], removableIds: [], protectedCount: 0 };

  // `phone_normalized` is canonical ("+639171234567"); the order lookup keys on
  // lead_phone_key ("9171234567"). Converting here rather than trusting the two
  // to look alike — they do not, and a comparison across them matches nothing.
  const byKey = new Map<string, { name: string; ownerId: string | null }>();
  for (const c of customers) {
    const key = normalizePhone(c.phone_normalized);
    if (key && !byKey.has(key)) byKey.set(key, { name: c.full_name, ownerId: c.owner_agent_id || null });
  }

  const orders = await ordersForPhones(Array.from(byKey.keys()));
  const allowed = scope ? new Set(scope) : null;

  const rows: RegularCustomerLead[] = [];
  for (const order of orders) {
    // Their own orders are the customer record's history, not a duplicate of
    // it — the flag is what moved them out of Leads in the first place.
    if (order.is_regular_customer) continue;
    if (allowed && !allowed.has(order.agent_id)) continue;
    const match = byKey.get(normalizePhone(order.customer_phone || ""));
    if (!match) continue;
    rows.push({
      order,
      customerName: match.name,
      customerOwnerId: match.ownerId,
      protectedReason: sweepBlockReason(order),
    });
  }

  rows.sort((a, b) => a.order.created_at.localeCompare(b.order.created_at));
  const removableIds = rows.filter((r) => !r.protectedReason).map((r) => r.order.id);
  return { rows, removableIds, protectedCount: rows.length - removableIds.length };
}
