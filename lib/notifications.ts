import { uuid, nowIso } from "./db";
import { isFullAccess } from "./permissions";
import type { DbShape } from "./types";

export function notify(
  db: DbShape,
  recipientIds: string[],
  type: string,
  title: string,
  body: string | null = null,
  link: string | null = null
) {
  const unique = Array.from(new Set(recipientIds.filter(Boolean)));
  for (const recipientId of unique) {
    db.notifications.unshift({
      id: uuid(),
      recipient_id: recipientId,
      type,
      title,
      body,
      link,
      is_read: false,
      created_at: nowIso(),
    });
  }
}

/** Resolves the standard recipient set for an agent-related event: the agent
 * themself, their team lead (if assigned), and every active Management/Administrator user. */
export function agentEventRecipients(db: DbShape, agentId: string): string[] {
  const agent = db.profiles.find((p) => p.id === agentId);
  const managementIds = db.profiles.filter((p) => isFullAccess(p.role) && p.is_active).map((p) => p.id);
  const recipients = [agentId, ...managementIds];
  if (agent?.team_lead_id) recipients.push(agent.team_lead_id);
  return Array.from(new Set(recipients));
}

/** Recipients for a leave request's supervisor chain: the assigned supervisor
 * (team lead) plus all active Management/Administrator users — used when a new request is filed. */
export function supervisorRecipients(db: DbShape, supervisorId: string | null): string[] {
  const managementIds = db.profiles.filter((p) => isFullAccess(p.role) && p.is_active).map((p) => p.id);
  const recipients = [...managementIds];
  if (supervisorId) recipients.push(supervisorId);
  return Array.from(new Set(recipients));
}
