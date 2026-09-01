import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Calls as the PBX saw them.
 *
 * ROMA has never known whether a customer picked up. A call_session is the
 * agent pressing Calling and pressing stop, so it measures time spent on a
 * lead — 30,264 sessions averaging 115 seconds says nothing about whether
 * anybody answered. Every question about answer rate has been unanswerable,
 * which also means no change to the dialling setup can be judged.
 *
 * Asterisk knows. This is how it tells us.
 *
 * The connector lives on the PBX and posts here; nothing in ROMA holds a
 * connection to Asterisk. That is not a preference — this app runs on
 * serverless functions that live for seconds, and AMI is a socket that has to
 * stay open for days. A push from the side that can hold the socket is the only
 * shape that works.
 */

/** What Asterisk reports at the end of a call. Kept as its own words rather
 * than mapped on the way in: the mapping is a decision, and decisions change. */
export const PBX_DISPOSITIONS = ["ANSWERED", "NO ANSWER", "BUSY", "FAILED", "CONGESTION"] as const;
export type PbxDisposition = (typeof PBX_DISPOSITIONS)[number];

export interface PbxCallInput {
  /** Asterisk's uniqueid. The idempotency key. */
  unique_id: string;
  /** The agent's extension, matched against profiles.sip_extension. */
  extension?: string | null;
  /** The number as dialled, in whatever shape the dialplan saw. */
  dialed?: string | null;
  started_at: string;
  answered_at?: string | null;
  ended_at?: string | null;
  disposition?: string | null;
  /** Talk seconds, after pickup. */
  billsec?: number | null;
  /** Total seconds including ringing. */
  duration?: number | null;
}

export interface PbxCallResult {
  unique_id: string;
  ok: boolean;
  agent_matched?: boolean;
  session_matched?: boolean;
  error?: string;
}

/** A timestamp Postgres will accept, or null. Rejecting here rather than
 * letting the database raise keeps one bad row from failing a whole batch. */
function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function intOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
}

/**
 * Records one call. Idempotent on the Asterisk uniqueid.
 *
 * A retry after a timeout updates rather than duplicating, which the connector
 * depends on: it runs on somebody else's machine over somebody else's network,
 * and "did that POST land" is not a question it can always answer.
 */
export async function recordPbxCall(input: PbxCallInput): Promise<PbxCallResult> {
  const uniqueId = String(input.unique_id || "").trim();
  if (!uniqueId) return { unique_id: "", ok: false, error: "unique_id is required" };

  const startedAt = isoOrNull(input.started_at);
  if (!startedAt) return { unique_id: uniqueId, ok: false, error: "started_at is required and must be a date" };

  const { data, error } = await supabaseAdmin.rpc("record_pbx_call", {
    p_unique_id: uniqueId,
    p_extension: input.extension ? String(input.extension).trim() : null,
    p_dialed: input.dialed ? String(input.dialed).trim() : null,
    p_started_at: startedAt,
    p_answered_at: isoOrNull(input.answered_at),
    p_ended_at: isoOrNull(input.ended_at),
    p_disposition: input.disposition ? String(input.disposition).trim().toUpperCase() : null,
    p_billsec: intOrNull(input.billsec),
    p_duration: intOrNull(input.duration),
  });

  if (error) return { unique_id: uniqueId, ok: false, error: error.message };

  const answer = (data || {}) as { ok?: boolean; agent_matched?: boolean; session_matched?: boolean; error?: string };
  return {
    unique_id: uniqueId,
    ok: Boolean(answer.ok),
    agent_matched: answer.agent_matched,
    session_matched: answer.session_matched,
    ...(answer.error ? { error: answer.error } : {}),
  };
}

/**
 * A batch, reported per call.
 *
 * Serial rather than parallel: the connector catches up after an outage by
 * sending everything it missed, and twenty concurrent writes from a machine
 * nobody is watching is how a database gets a burst it did not need.
 *
 * One bad call does not fail the batch. The connector is retrying against a
 * list it holds; telling it "the whole batch failed" would make it resend the
 * good ones forever alongside the one it can never fix.
 */
export async function recordPbxCalls(calls: PbxCallInput[]): Promise<PbxCallResult[]> {
  const out: PbxCallResult[] = [];
  for (const call of calls) {
    try {
      out.push(await recordPbxCall(call));
    } catch (e) {
      out.push({
        unique_id: String(call?.unique_id || ""),
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return out;
}
