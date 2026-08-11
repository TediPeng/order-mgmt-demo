import type { Profile } from "./types";

// matchAgentByName() lived here and matched on full name or username. Its only
// caller was the call-log import's Agent Name column, which is gone: a call log
// belongs to whoever uploads it. Deleted rather than left for someone to find
// and reuse — it was the loosest of the three matchers, and the reason
// matchAgentByCallName below refuses full names is that two people can share
// one.

/** Leads import matches strictly on registered username (case-insensitive, trimmed) — not full name. */
export function matchAgentByUsername(username: string, profiles: Profile[]): Profile | undefined {
  const q = username.trim().toLowerCase();
  if (!q) return undefined;
  return profiles.find((p) => p.username.toLowerCase() === q);
}

/** Resolves the agent a distributed lead belongs to.
 *
 * Call Name first, because that is what the caller column in a supplied file
 * actually holds — the label the campaign knows the agent by. Username is kept
 * as a fallback so files exported before Call Names existed still import.
 * Never falls back to full name: two people can share one, and silently
 * handing a lead to the wrong agent is worse than rejecting the row. */
export function matchAgentByCallName(value: string, profiles: Profile[]): Profile | undefined {
  const q = value.trim().toLowerCase();
  if (!q) return undefined;
  return (
    profiles.find((p) => (p.call_name || "").trim().toLowerCase() === q) ||
    matchAgentByUsername(value, profiles)
  );
}
