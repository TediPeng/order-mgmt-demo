import { readDb, writeDb, uuid, nowIso } from "./db";
import type { DbShape } from "./types";

export interface AuditExtra {
  module?: string | null;
  previous_value?: unknown;
  updated_value?: unknown;
  ip_address?: string | null;
  device_info?: string | null;
}

export function logActivity(
  db: DbShape,
  userId: string | null,
  action: string,
  entityType: string | null = null,
  entityId: string | null = null,
  details: Record<string, unknown> | null = null,
  extra: AuditExtra = {}
) {
  const userEmail = userId ? db.profiles.find((p) => p.id === userId)?.email ?? null : null;
  db.activity_log.unshift({
    id: uuid(),
    user_id: userId,
    user_email: userEmail,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
    module: extra.module ?? null,
    previous_value: extra.previous_value ?? null,
    updated_value: extra.updated_value ?? null,
    ip_address: extra.ip_address ?? null,
    device_info: extra.device_info ?? null,
    created_at: nowIso(),
  });
}

export async function logActivityStandalone(
  userId: string | null,
  action: string,
  entityType: string | null = null,
  entityId: string | null = null,
  details: Record<string, unknown> | null = null,
  extra: AuditExtra = {}
) {
  const db = await readDb();
  logActivity(db, userId, action, entityType, entityId, details, extra);
  await writeDb(db);
}
