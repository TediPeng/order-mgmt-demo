import type { Profile } from "./types";

export function matchAgentByName(name: string, profiles: Profile[]): Profile | undefined {
  const q = name.trim().toLowerCase();
  if (!q) return undefined;
  return profiles.find((p) => p.full_name.toLowerCase() === q || p.username.toLowerCase() === q);
}

/** Leads import matches strictly on registered username (case-insensitive, trimmed) — not full name. */
export function matchAgentByUsername(username: string, profiles: Profile[]): Profile | undefined {
  const q = username.trim().toLowerCase();
  if (!q) return undefined;
  return profiles.find((p) => p.username.toLowerCase() === q);
}
