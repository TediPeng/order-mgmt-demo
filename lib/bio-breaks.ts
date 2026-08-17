import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getActiveSession } from "@/lib/call-sessions";
import type { BioBreak } from "@/lib/types";

/** Bio breaks — the short, repeatable ones.
 *
 * Deliberately not the same thing as attendance.break_start/break_end, which is
 * one lunch break a day and refuses a second ("Break already used today"). These
 * are taken as often as needed and every one is timed.
 *
 * Built like call-sessions.ts for the same reasons: `started_at` is the only
 * source of truth for elapsed time, so a refresh or a second tab shows the same
 * figure; duration is computed on close from the stored start, so a drifting or
 * tampered client clock cannot shorten a break; and one open break per agent is
 * a partial unique index rather than a check here, because two simultaneous
 * clicks would both pass a check.
 */

/** Postgres unique-violation, raised by one_active_bio_break_per_agent. */
const UNIQUE_VIOLATION = "23505";

function map(row: Record<string, unknown>): BioBreak {
  return {
    ...(row as unknown as BioBreak),
    duration_seconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
  };
}

export async function getActiveBioBreak(agentId: string): Promise<BioBreak | null> {
  const { data, error } = await supabaseAdmin
    .from("bio_breaks")
    .select("*")
    .eq("agent_id", agentId)
    .is("ended_at", null)
    .maybeSingle();
  if (error) throw new Error(`bio_breaks read failed: ${error.message}`);
  return data ? map(data) : null;
}

/** Every agent currently on a bio break, keyed by agent id — one query for the
 * whole monitor rather than one per row. */
export async function getActiveBioBreaks(agentIds: string[]): Promise<Map<string, BioBreak>> {
  const out = new Map<string, BioBreak>();
  if (agentIds.length === 0) return out;
  const { data, error } = await supabaseAdmin
    .from("bio_breaks")
    .select("*")
    .in("agent_id", agentIds)
    .is("ended_at", null);
  if (error) throw new Error(`bio_breaks read failed: ${error.message}`);
  for (const row of data || []) out.set(String(row.agent_id), map(row));
  return out;
}

export type StartBioBreakResult =
  | { ok: true; bioBreak: BioBreak }
  | { ok: false; reason: "already_active" | "on_call"; message: string };

/** Opens a bio break. Refused while a call is open: the two are mutually
 * exclusive, so an agent can never read as On Call and On Break at once and the
 * standby arithmetic has no overlapping intervals to reconcile. */
export async function startBioBreak(agentId: string, workDate: string): Promise<StartBioBreakResult> {
  const activeCall = await getActiveSession(agentId);
  if (activeCall) {
    return { ok: false, reason: "on_call", message: "End your current call before starting a bio break." };
  }

  const { data, error } = await supabaseAdmin
    .from("bio_breaks")
    .insert({ agent_id: agentId, work_date: workDate })
    .select("*")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { ok: false, reason: "already_active", message: "A bio break is already in progress." };
    }
    throw new Error(`Could not start the bio break: ${error.message}`);
  }
  return { ok: true, bioBreak: map(data) };
}

/** Closes the agent's open bio break. Scoped by agent_id as well as the null
 * ended_at so one agent can never close another's. */
export async function endBioBreak(agentId: string): Promise<BioBreak | null> {
  const active = await getActiveBioBreak(agentId);
  if (!active) return null;

  const endedAt = new Date();
  const startedAt = new Date(active.started_at);
  const duration = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));

  const { data, error } = await supabaseAdmin
    .from("bio_breaks")
    .update({ ended_at: endedAt.toISOString(), duration_seconds: duration })
    .eq("id", active.id)
    .eq("agent_id", agentId)
    .is("ended_at", null)
    .select("*")
    .single();
  if (error) throw new Error(`Could not end the bio break: ${error.message}`);
  return map(data);
}

export interface BioBreakDayTotals {
  /** Completed bio breaks taken today. */
  count: number;
  /** Seconds across completed breaks. The one in progress is excluded — the
   * monitor adds its live elapsed time separately so the figure keeps ticking. */
  seconds: number;
  /** When the last completed bio break ended, ISO. Null when there were none.
   * Used the same way as CallDayTotals.lastEndedAt: to date the start of the
   * standby that followed it. */
  lastEndedAt: string | null;
}

/** Completed bio break totals for one day, per agent. */
export async function bioBreakTotalsForDay(agentIds: string[], workDate: string): Promise<Map<string, BioBreakDayTotals>> {
  const out = new Map<string, BioBreakDayTotals>();
  if (agentIds.length === 0) return out;

  const { data, error } = await supabaseAdmin
    .from("bio_breaks")
    .select("agent_id, duration_seconds, ended_at")
    .in("agent_id", agentIds)
    .eq("work_date", workDate)
    .not("ended_at", "is", null);
  if (error) throw new Error(`bio_breaks read failed: ${error.message}`);

  for (const row of data || []) {
    const key = String(row.agent_id);
    const current = out.get(key) || { count: 0, seconds: 0, lastEndedAt: null };
    current.count += 1;
    current.seconds += Number(row.duration_seconds ?? 0);
    const ended = row.ended_at ? String(row.ended_at) : null;
    if (ended && (!current.lastEndedAt || ended > current.lastEndedAt)) current.lastEndedAt = ended;
    out.set(key, current);
  }
  return out;
}

/** The same totals across a date range, for the activity report. One query
 * rather than a loop over the days -- see callTotalsForRange for why. */
export async function bioBreakTotalsForRange(
  agentIds: string[],
  from: string,
  to: string
): Promise<Map<string, BioBreakDayTotals>> {
  const out = new Map<string, BioBreakDayTotals>();
  if (agentIds.length === 0) return out;

  const { data, error } = await supabaseAdmin
    .from("bio_breaks")
    .select("agent_id, duration_seconds")
    .in("agent_id", agentIds)
    .gte("work_date", from)
    .lte("work_date", to)
    .not("ended_at", "is", null);
  if (error) throw new Error(`bio_breaks read failed: ${error.message}`);

  for (const row of data || []) {
    const key = String(row.agent_id);
    const current = out.get(key) || { count: 0, seconds: 0, lastEndedAt: null };
    current.count += 1;
    current.seconds += Number(row.duration_seconds ?? 0);
    out.set(key, current);
  }
  return out;
}

/** One agent's bio breaks for a day, newest first — the personal history shown
 * under their own timer. */
export async function listBioBreaksForDay(agentId: string, workDate: string): Promise<BioBreak[]> {
  const { data, error } = await supabaseAdmin
    .from("bio_breaks")
    .select("*")
    .eq("agent_id", agentId)
    .eq("work_date", workDate)
    .order("started_at", { ascending: false });
  if (error) throw new Error(`bio_breaks read failed: ${error.message}`);
  return (data || []).map(map);
}
