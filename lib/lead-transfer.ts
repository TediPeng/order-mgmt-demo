/**
 * Moving a lead that has already become a sale.
 *
 * Ordinarily a transfer refuses these: a lead with an order_date, or one already
 * sent to Pancake POS, stayed on the first agent's name for good. That was the
 * right rule while `agent_id` was also the answer to "who earns this", because
 * moving the lead moved the commission with it.
 *
 * `orders.sold_by_agent_id` separates the two, so the refusal is now an override
 * rather than a wall — the lead follows the customer, the sale stays with whoever
 * made it. What the override costs is a reason, recorded in the activity log
 * against the order ids it moved.
 */
export const TRANSFER_OVERRIDE_REASONS = [
  "Customer called this agent directly",
  "Previous agent has left the company",
  "Reassigned by management",
  "Wrong agent recorded on the order",
  "Customer asked for a different agent",
  "Other (explain below)",
] as const;

export type TransferOverrideReason = (typeof TRANSFER_OVERRIDE_REASONS)[number];

/** The one that needs the free-text box filled in. */
export const OTHER_REASON: TransferOverrideReason = "Other (explain below)";

/** What the log should record, or a message saying what is missing. Shared so
 * the screen cannot offer a transfer the route would refuse. */
export function overrideReasonProblem(reason: string, detail: string): string | null {
  const picked = reason.trim();
  if (!picked) return "Pick a reason for the override.";
  if (!(TRANSFER_OVERRIDE_REASONS as readonly string[]).includes(picked)) {
    return "That is not one of the override reasons.";
  }
  if (picked === OTHER_REASON && detail.trim().length < 4) {
    return "Say what the reason is.";
  }
  return null;
}

/** One line for the audit entry: the reason, and the explanation when there is one. */
export function overrideReasonText(reason: string, detail: string): string {
  const d = detail.trim();
  return d ? `${reason.trim()} — ${d}` : reason.trim();
}
