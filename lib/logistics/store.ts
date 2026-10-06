import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type {
  LogisticsConnection,
  LogisticsConnectionHealth,
  LogisticsSyncRun,
} from "@/lib/types";

// Targeted supabaseAdmin access for the logistics tables. Deliberately NOT part
// of the whole-DbShape read/write cycle: these tables grow with every parcel
// every shop ships, and putting them in readDb() would load them on every page
// render in the app.

const CONNECTION_COLUMNS = "*";

export async function listConnections(opts: { includeArchived?: boolean } = {}): Promise<LogisticsConnection[]> {
  let q = supabaseAdmin.from("logistics_connections").select(CONNECTION_COLUMNS);
  if (!opts.includeArchived) q = q.is("archived_at", null);
  const { data, error } = await q.order("connection_name", { ascending: true });
  if (error) throw new Error(`logistics_connections read failed: ${error.message}`);
  return (data || []) as LogisticsConnection[];
}

/** Connections a sync run should touch: enabled and not archived. */
export async function listSyncableConnections(): Promise<LogisticsConnection[]> {
  const { data, error } = await supabaseAdmin
    .from("logistics_connections")
    .select(CONNECTION_COLUMNS)
    .is("archived_at", null)
    .eq("is_enabled", true)
    .order("connection_name", { ascending: true });
  if (error) throw new Error(`logistics_connections read failed: ${error.message}`);
  return (data || []) as LogisticsConnection[];
}

export async function getConnection(id: string): Promise<LogisticsConnection | null> {
  const { data, error } = await supabaseAdmin
    .from("logistics_connections")
    .select(CONNECTION_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`logistics_connections read failed: ${error.message}`);
  return (data as LogisticsConnection) || null;
}

export async function insertConnection(row: Partial<LogisticsConnection>): Promise<LogisticsConnection> {
  const { data, error } = await supabaseAdmin
    .from("logistics_connections")
    .insert(row)
    .select(CONNECTION_COLUMNS)
    .single();
  if (error) throw new Error(`logistics_connections insert failed: ${error.message}`);
  return data as LogisticsConnection;
}

export async function updateConnection(id: string, fields: Partial<LogisticsConnection>): Promise<void> {
  const { error } = await supabaseAdmin
    .from("logistics_connections")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`logistics_connections update failed: ${error.message}`);
}

/**
 * Archive, not delete (SPEC §9).
 *
 * The orders and status history a connection produced are the record of what
 * the couriers did, and they outlive the credential that fetched them — a
 * foreign key with ON DELETE RESTRICT enforces that even from raw SQL. An
 * archived connection disappears from the module and stops syncing.
 */
export async function archiveConnection(id: string): Promise<void> {
  await updateConnection(id, { archived_at: new Date().toISOString(), is_enabled: false });
}

/** How many orders a connection has contributed. Shown before archiving, so
 * the person doing it can see what stays behind. */
export async function countOrdersForConnection(id: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("logistics_orders")
    .select("id", { count: "exact", head: true })
    .eq("connection_id", id);
  if (error) throw new Error(`logistics_orders count failed: ${error.message}`);
  return count || 0;
}

// --- sync runs --------------------------------------------------------------

export async function listSyncRuns(opts: { connectionId?: string; limit?: number } = {}): Promise<LogisticsSyncRun[]> {
  let q = supabaseAdmin.from("logistics_sync_runs").select("*");
  if (opts.connectionId) q = q.eq("connection_id", opts.connectionId);
  const { data, error } = await q.order("started_at", { ascending: false }).limit(opts.limit ?? 50);
  if (error) throw new Error(`logistics_sync_runs read failed: ${error.message}`);
  return (data || []) as LogisticsSyncRun[];
}

/** The newest run per connection, for the health strip. One query rather than
 * one per connection: a shop count that grows does not grow the query count. */
export async function latestRunByConnection(): Promise<Record<string, LogisticsSyncRun>> {
  const { data, error } = await supabaseAdmin
    .from("logistics_sync_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`logistics_sync_runs read failed: ${error.message}`);
  const newest: Record<string, LogisticsSyncRun> = {};
  for (const run of (data || []) as LogisticsSyncRun[]) {
    if (!newest[run.connection_id]) newest[run.connection_id] = run;
  }
  return newest;
}

// --- health -----------------------------------------------------------------

/** A sync older than this is stale enough to call the connection degraded. The
 * cron runs every 5 minutes, so this is several missed runs, not one. */
const STALE_AFTER_MINUTES = 30;

/**
 * A connection's state, derived rather than stored (SPEC §31).
 *
 * The distinction that matters: ERROR is "the last attempt failed", DEGRADED is
 * "nothing has failed but nothing has succeeded recently either" — a sync that
 * silently stopped running looks healthy under any check that only reads the
 * last error.
 */
export function connectionHealth(
  conn: LogisticsConnection,
  latestRun?: LogisticsSyncRun | null
): LogisticsConnectionHealth {
  if (!conn.is_enabled || conn.archived_at) return "disabled";
  if (latestRun && latestRun.status === "running") return "syncing";
  const lastErrorAt = conn.last_error_at ? Date.parse(conn.last_error_at) : 0;
  const lastOkAt = conn.last_successful_sync_at ? Date.parse(conn.last_successful_sync_at) : 0;
  if (lastErrorAt && lastErrorAt > lastOkAt) return "error";
  if (!lastOkAt) return "degraded"; // never synced successfully
  if (Date.now() - lastOkAt > STALE_AFTER_MINUTES * 60_000) return "degraded";
  return "connected";
}

/**
 * True when any enabled connection is not currently healthy.
 *
 * The whole point of SPEC §31: zero On Delivery orders must never be read as
 * "nothing is out for delivery" when it might mean "the sync is broken". Every
 * screen that shows a count asks this first.
 */
export function anyConnectionUnhealthy(
  connections: LogisticsConnection[],
  runs: Record<string, LogisticsSyncRun>
): boolean {
  return connections.some((c) => {
    const health = connectionHealth(c, runs[c.id]);
    return health === "error" || health === "degraded";
  });
}
