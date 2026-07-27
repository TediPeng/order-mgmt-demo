import type { PancakeStatusMapEntry } from "@/lib/types";
import { LEAD_STATUSES } from "@/lib/validation";

/** Resolves a raw Pancake status code through the editable mapping table.
 * Returns the internal status, or null when the code is unmapped/inactive or
 * maps to something that is not a valid lead status — callers must then log
 * needs_review and leave the lead untouched (Section 5). */
export function mapStatus(rawStatus: string, map: PancakeStatusMapEntry[]): string | null {
  const entry = map.find((m) => m.is_active && m.pancake_status === rawStatus);
  if (!entry) return null;
  return (LEAD_STATUSES as readonly string[]).includes(entry.internal_status) ? entry.internal_status : null;
}
