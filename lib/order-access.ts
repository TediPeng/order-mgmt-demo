import type { DbShape, Order, Profile } from "./types";
import { isFullAccess } from "./permissions";

/**
 * Whether this viewer may act on this order. `agent_id` decides it, and nothing
 * else.
 *
 * It used to require `assigned_agent_email` to agree as well, as a guard against
 * a row whose two agent fields disagreed. The guard cost more than it caught.
 * `queryLeads` — the SQL behind the Leads list — cannot express a join against
 * another table in one query and has always scoped by `agent_id` alone, so the
 * list and the actions were answering two different questions. On 2026-08-11
 * they gave two different answers: changing one agent's email left the email on
 * her orders stale, and she was shown all 2,283 of her leads and refused every
 * one of them with "You do not have access to that lead". A list you cannot act
 * on is worse than either rule on its own.
 *
 * `agent_id` is the column every write sets, the one the database has a foreign
 * key on, and the one every report and every query already treats as the owner.
 * The email beside it is a denormalized label for display and for Pancake; it
 * is kept in step when a profile's email changes (updateUserProfileAction), but
 * it no longer decides who may open a lead.
 */
export function orderInScope(user: Profile, order: Order, db: DbShape): boolean {
  if (isFullAccess(user.role)) return true;

  if (user.role === "team_lead") {
    const owner = db.profiles.find((p) => p.id === order.agent_id);
    return order.agent_id === user.id || owner?.team_lead_id === user.id;
  }

  // Everyone else (agents, custom roles): their own orders.
  return order.agent_id === user.id;
}

export function scopeOrders(user: Profile, orders: Order[], db: DbShape): Order[] {
  if (isFullAccess(user.role)) return orders;
  return orders.filter((o) => orderInScope(user, o, db));
}

/** Which agents a user may attribute a NEW order to. */
export function allowedAssigneeIds(user: Profile, db: DbShape): string[] {
  if (isFullAccess(user.role)) return db.profiles.filter((p) => p.is_active).map((p) => p.id);
  if (user.role === "team_lead") {
    return db.profiles.filter((p) => p.is_active && (p.id === user.id || p.team_lead_id === user.id)).map((p) => p.id);
  }
  return [user.id];
}
