import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { dayRangeUtc } from "@/lib/utils";

/**
 * What the PBX saw, per agent, for one day.
 *
 * Deliberately separate from lib/call-sessions.ts, which measures a different
 * thing and must keep saying so. A call session is the agent pressing Calling
 * and pressing stop: it measures attention on a lead. A pbx_calls row is a call
 * Asterisk actually placed: it measures the telephone.
 *
 * They disagree, and the disagreement is the point. A session with no matching
 * call is an agent who pressed the button and never dialled. A call with no
 * session is an agent who dialled without opening the lead. Neither is visible
 * while only one of the two is counted, and both are worth seeing during the
 * rollout — an agent still on their mobile has sessions and no calls, and that
 * is exactly how a supervisor can tell who has actually moved to the softphone.
 *
 * Rows are attributed by profiles.sip_extension and nothing else, so an agent
 * without one has their calls recorded against nobody. See lib/pbx/ingest.ts.
 */
export interface PbxDayTotals {
  /** Every call the PBX placed for this agent, answered or not. */
  calls: number;
  /** Of those, the ones somebody picked up. */
  answered: number;
  /** Talk seconds after pickup — billsec, not duration. Ringing is not talking. */
  talkSeconds: number;
}

export const EMPTY_PBX_TOTALS: PbxDayTotals = { calls: 0, answered: 0, talkSeconds: 0 };

/**
 * Totals for a set of agents on one local day.
 *
 * Bounded on the Manila day rather than the UTC one, the same way
 * callTotalsForDay is: bounding a Manila date with UTC midnight opens the
 * window at 08:00 and silently drops every call before it.
 */
export async function pbxTotalsForDay(
  agentIds: string[],
  workDate: string
): Promise<Map<string, PbxDayTotals>> {
  const out = new Map<string, PbxDayTotals>();
  if (agentIds.length === 0) return out;

  const range = dayRangeUtc(workDate);
  const { data, error } = await supabaseAdmin
    .from("pbx_calls")
    .select("agent_id, disposition, billsec")
    .in("agent_id", agentIds)
    .gte("started_at", range.start)
    .lt("started_at", range.endExclusive);

  // A read failure here must not take the board down with it. The monitor's
  // reason for existing is attendance and live call state; these columns are an
  // addition, and an empty column is a smaller lie than an error page.
  if (error) {
    console.error("[pbx-calls] totals read failed: %s", error.message);
    return out;
  }

  for (const row of data || []) {
    const key = String(row.agent_id);
    const current = out.get(key) || { ...EMPTY_PBX_TOTALS };
    current.calls += 1;
    if (String(row.disposition || "").toUpperCase() === "ANSWERED") {
      current.answered += 1;
      // billsec is zero on an unanswered call, so this is safe either way — but
      // it is added only under ANSWERED to keep the meaning exact rather than
      // relying on the zero.
      current.talkSeconds += Math.max(0, Number(row.billsec ?? 0));
    }
    out.set(key, current);
  }
  return out;
}


/**
 * What the PBX is doing this second, per extension.
 *
 * Written by the PBX every few seconds as a whole snapshot; see
 * /api/pbx/channels. Read here with an age check, because the interesting
 * failure is not a wrong answer but a stopped one: a sender that has died
 * leaves the last busy moment on screen for ever, and three agents frozen
 * mid-call reads as information when it is silence.
 */
export interface LiveChannel {
  extension: string;
  state: string;
  dialed: string | null;
  seconds: number;
}

/**
 * Older than this and the snapshot is not shown at all.
 *
 * The sender posts every ten seconds, so a minute is six missed turns — long
 * enough to ride out a slow request or a restart, short enough that nobody is
 * looking at a picture of the past.
 */
export const LIVE_STALE_AFTER_MS = 60_000;

export interface LiveState {
  /** Keyed by extension. Empty when the snapshot is stale or missing. */
  byExtension: Map<string, LiveChannel>;
  /** When the PBX last spoke, or null if it never has. */
  updatedAt: string | null;
  /** True when the PBX has stopped reporting — the board must say so. */
  stale: boolean;
}

export const NO_LIVE_STATE: LiveState = { byExtension: new Map(), updatedAt: null, stale: true };

export async function liveChannels(): Promise<LiveState> {
  const { data, error } = await supabaseAdmin
    .from("pbx_live_state")
    .select("channels, updated_at")
    .eq("id", 1)
    .maybeSingle();

  // Same reasoning as pbxTotalsForDay: this is an addition to the board, not
  // the reason it exists, and it must not be able to take the page down.
  if (error || !data) {
    if (error) console.error("[pbx-calls] live state read failed: %s", error.message);
    return NO_LIVE_STATE;
  }

  const updatedAt = data.updated_at ? String(data.updated_at) : null;
  const age = updatedAt ? Date.now() - new Date(updatedAt).getTime() : Infinity;
  if (age > LIVE_STALE_AFTER_MS) return { byExtension: new Map(), updatedAt, stale: true };

  const byExtension = new Map<string, LiveChannel>();
  for (const raw of (data.channels as LiveChannel[]) || []) {
    const ext = String(raw?.extension ?? "").trim();
    if (!ext) continue;
    // If an extension somehow appears twice, the one that has been up longest
    // wins: that is the call the agent is actually on, not a second leg that
    // is still ringing.
    const existing = byExtension.get(ext);
    if (!existing || Number(raw.seconds ?? 0) > existing.seconds) {
      byExtension.set(ext, {
        extension: ext,
        state: String(raw.state ?? "unknown"),
        dialed: raw.dialed ? String(raw.dialed) : null,
        seconds: Math.max(0, Number(raw.seconds ?? 0)),
      });
    }
  }
  return { byExtension, updatedAt, stale: false };
}
