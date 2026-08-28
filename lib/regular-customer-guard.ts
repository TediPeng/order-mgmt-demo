import { sharedCustomerIdsForAgent } from "@/lib/customers";
import { isFullAccess } from "@/lib/permissions";
import { displayCallName } from "@/lib/types";
import type { Customer, Profile, Role } from "@/lib/types";

/**
 * The one place that decides whether somebody else's regular customer stands
 * between an agent and an order.
 *
 * It was written three times before this: once on the server for creating a
 * lead, once again on the server for editing one, and a third time on the Leads
 * page to tell the browser whether to raise the dialog. Three copies of one
 * sentence, and on 2026-08-28 they disagreed — the server was narrowed to
 * ignore records that had been untagged, the browser was not, and an agent on a
 * call was refused a save the server would have accepted, with the name of an
 * agent who had given the customer up minutes earlier. Nothing in the app could
 * clear it, because the copy doing the refusing was not the copy that had been
 * fixed.
 *
 * So the decision lives here and the callers ask. What they MATCH on may still
 * differ — the page has already run findDuplicates() for its warnings panel,
 * the actions run it for one candidate — but what COUNTS as blocking may not.
 *
 * Deliberately NOT the same rule as foreignRegularOwnerReason in
 * lib/actions/regular-customers.ts, which looks similar and is a different
 * question. That one asks whether a SECOND regular-customer record is about to
 * be created for one person, blocks Team Leads and Administrators too (with a
 * different sentence, telling them to share or reassign instead), and knows
 * nothing about sharing. This one asks whether an agent may work an order, and
 * a Team Lead is exempt because they are who the agent is being sent to.
 * Merging them would break one or the other.
 */

/**
 * Roles this guard never applies to.
 *
 * A Team Lead is who the agent is told to escalate to. Refusing them as well
 * would leave the pair with nobody able to act on it.
 */
export function guardExemptRole(role: Role): boolean {
  return isFullAccess(role) || role === "team_lead";
}

/**
 * Whether one matched customer record blocks this actor.
 *
 * Pure, so both the server action and the page render can reach the same
 * verdict without a round trip each.
 *
 * `sharedToActor` is the set of customer ids the owner has deliberately handed
 * to this actor. A shared customer is not foreign to them, and refusing the
 * order would make the share look broken rather than granted.
 */
export function isBlockingMatch(
  matched: Customer,
  actor: { id: string; role: Role },
  sharedToActor: ReadonlySet<string>
): boolean {
  if (guardExemptRole(actor.role)) return false;
  // Untagging leaves the record and its owner in place and only clears this
  // flag. It is what an agent does to release a number, so it has to be what
  // this reads.
  if (!matched.is_regular_customer) return false;
  if (matched.owner_agent_id === actor.id) return false;
  return !sharedToActor.has(matched.id);
}

/**
 * Which of these matches block, resolving sharing in one query for the batch.
 *
 * Nothing is asked of the database when the actor is exempt or nothing is
 * flagged, which is the ordinary case — a page of twenty-five leads should not
 * pay for a shares lookup to decide that a Team Lead is not being blocked.
 */
export async function blockingMatches(
  matches: Customer[],
  actor: { id: string; role: Role }
): Promise<Customer[]> {
  if (guardExemptRole(actor.role)) return [];

  const candidates = matches.filter((c) => c.is_regular_customer && c.owner_agent_id !== actor.id);
  if (candidates.length === 0) return [];

  const shared = new Set(await sharedCustomerIdsForAgent(candidates.map((c) => c.id), actor.id));
  return candidates.filter((c) => isBlockingMatch(c, actor, shared));
}

/** The sentence an agent is shown when one does. Here so the wording cannot
 * drift between the two actions that raise it. */
export function foreignRegularCustomerMessage(owner: Profile | undefined): string {
  return (
    `This customer is already a regular customer of ${owner ? displayCallName(owner) : "another agent"}. ` +
    `Please contact your Team Lead for this concern.`
  );
}
