import type { DbShape, Order, Profile } from "./types";
import { isFullAccess } from "./permissions";

/** Returns the order ids/scope an agent may see: own orders matched by BOTH
 * agent_id and assigned_agent_email. A mismatch between the two is treated as
 * no access and logged, since they should always agree. */
export function orderInScope(user: Profile, order: Order, db: DbShape): boolean {
  if (isFullAccess(user.role)) return true;

  if (user.role === "team_lead") {
    const owner = db.profiles.find((p) => p.id === order.agent_id);
    return order.agent_id === user.id || owner?.team_lead_id === user.id;
  }

  // Everyone else (agents, custom roles): must match on both id and email.
  const idMatches = order.agent_id === user.id;
  const emailMatches = order.assigned_agent_email?.toLowerCase() === user.email.toLowerCase();

  if (idMatches !== emailMatches) {
    // Data integrity issue: agent_id and assigned_agent_email disagree. This
    // should be unreachable since both are always synced together on
    // create/reassign, but if it ever happens, fail closed and surface it —
    // this runs on read paths, so it only warns rather than writing to the DB.
    console.warn(
      `Order ${order.id} has mismatched agent_id/assigned_agent_email for viewer ${user.email}:`,
      { agent_id: order.agent_id, assigned_agent_email: order.assigned_agent_email }
    );
    return false;
  }

  return idMatches && emailMatches;
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
