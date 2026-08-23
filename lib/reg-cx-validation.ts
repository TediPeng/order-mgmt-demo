import { listAccounts } from "@/lib/pancake/store";
import { pancakeRegCxEvidence, type RegCxEvidence } from "@/lib/pancake/customerHistory";
import { mockMode } from "@/lib/pancake/config";
import type { PancakeAccount, Profile } from "@/lib/types";

/**
 * Whether a customer may be tagged as a Regular Customer.
 *
 * A regular customer is a claim about a person's history, and until now the
 * claim rested on nothing: any agent could tag any number, and the record they
 * created is what later gives them the number exclusively. The evidence lives
 * in Pancake, not here — ROMA has only been forwarding orders since 10 August,
 * while Pancake holds everything that number has ever bought.
 *
 * Two conditions, and the second is an OR:
 *
 *   at least 3 DELIVERED orders in Pancake
 *   AND ( same Order Source OR same Caller )
 *
 * Delivered only. A customer who ordered five times and kept nothing is the
 * opposite of a regular customer; counting attempts would make them one.
 *
 * The attribution half asks whether this agent has a real relationship with
 * those parcels. Either they handled the calls, or the orders came through
 * their Order Source — one is enough, because a team can share a source and an
 * agent can move between them.
 */

export const MIN_DELIVERED_ORDERS = 3;

export type RegCxValidationResult =
  | "QUALIFIED"
  | "INSUFFICIENT_DELIVERED_ORDERS"
  | "ORDER_SOURCE_CALLER_MISMATCH"
  | "NO_PANCAKE_HISTORY"
  | "PANCAKE_UNAVAILABLE";

export interface RegCxDecision {
  result: RegCxValidationResult;
  allowed: boolean;
  /** Shown to the agent. Says what failed and what to do about it. */
  message: string;
  deliveredCount: number;
  totalOrders: number;
  sourceMatched: boolean;
  callerMatched: boolean;
  /** What the agent brings to the comparison, recorded either way. */
  currentOrderSource: string | null;
  currentCallerName: string | null;
  /** What in Pancake it matched, when it did. */
  matchedOrderSource: string | null;
  matchedCallerName: string | null;
}

function norm(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

/**
 * The decision, for one number and one prospective owner.
 *
 * `owner` is the agent the record would be filed under — not necessarily the
 * person pressing the button. A Team Lead tagging on an agent's behalf is
 * asking whether THAT agent has the relationship, and the answer must not
 * change with who happens to be holding the mouse.
 */
export async function validateRegCxTagging(owner: Profile, phone: string): Promise<RegCxDecision> {
  const currentOrderSource = owner.call_name?.trim() || null;
  const currentCallerName = owner.email?.trim() || null;

  const base = {
    deliveredCount: 0,
    totalOrders: 0,
    sourceMatched: false,
    callerMatched: false,
    currentOrderSource,
    currentCallerName,
    matchedOrderSource: null,
    matchedCallerName: null,
  };

  const accounts = (await listAccounts()).filter((a) => a.is_active);
  const account = accounts.find((a) => a.is_default) || accounts[0];
  if (!account && mockMode() === "off") {
    // No account is a configuration problem, not a verdict on the customer —
    // refusing them for it would read as "this customer is not qualified".
    return {
      ...base,
      result: "PANCAKE_UNAVAILABLE",
      allowed: false,
      message:
        "REG CX Validation Failed\n\nPancake POS is not configured, so this customer's order history cannot be checked. Ask an Administrator to set up the Pancake account under Settings → Integrations.",
    };
  }

  const evidence: RegCxEvidence = await pancakeRegCxEvidence(
    account ?? ({ id: "mock" } as unknown as PancakeAccount),
    phone
  );

  if (evidence.error) {
    return {
      ...base,
      result: "PANCAKE_UNAVAILABLE",
      allowed: false,
      message: `REG CX Validation Failed\n\nPancake POS could not be reached, so this customer's order history could not be checked. Try again in a moment.\n\n${evidence.error}`,
    };
  }

  const counted = { ...base, deliveredCount: evidence.deliveredCount, totalOrders: evidence.totalOrders };

  if (evidence.totalOrders === 0) {
    return {
      ...counted,
      result: "NO_PANCAKE_HISTORY",
      allowed: false,
      message:
        "REG CX Validation Failed\n\nNo qualifying previous order history was found in Pancake.\n\nPlease verify the customer's phone number and Pancake order history.",
    };
  }

  if (evidence.deliveredCount < MIN_DELIVERED_ORDERS) {
    return {
      ...counted,
      result: "INSUFFICIENT_DELIVERED_ORDERS",
      allowed: false,
      message:
        `REG CX Validation Failed\n\nThis customer is not yet qualified for REG CX.\n\n` +
        `Pancake Delivered Orders: ${evidence.deliveredCount}\n` +
        `Required Delivered Orders: ${MIN_DELIVERED_ORDERS}\n\n` +
        `Please verify the customer's Pancake order history.`,
    };
  }

  // Either is enough, deliberately. A team shares an Order Source, and an agent
  // moves between them — requiring both would refuse the ordinary case.
  const sourceMatched = Boolean(currentOrderSource) && evidence.sourceNames.includes(norm(currentOrderSource));
  const callerMatched = Boolean(currentCallerName) && evidence.careEmails.includes(norm(currentCallerName));

  const matched = {
    ...counted,
    sourceMatched,
    callerMatched,
    matchedOrderSource: sourceMatched ? currentOrderSource : null,
    matchedCallerName: callerMatched ? currentCallerName : null,
  };

  if (!sourceMatched && !callerMatched) {
    return {
      ...matched,
      result: "ORDER_SOURCE_CALLER_MISMATCH",
      allowed: false,
      message:
        "REG CX Validation Failed\n\nThis customer has at least 3 delivered orders, but the Order Source or Caller Name does not match the previous REG CX processing history.\n\nPlease verify the customer's previous orders in Pancake.",
    };
  }

  return {
    ...matched,
    result: "QUALIFIED",
    allowed: true,
    message:
      `REG CX Qualified\n\n` +
      `Pancake Delivered Orders: ${evidence.deliveredCount}\n` +
      `Order Source Match: ${sourceMatched ? "YES" : "NO"}\n` +
      `Caller Match: ${callerMatched ? "YES" : "NO"}`,
  };
}

/** The audit payload the rule requires, in one place so both tagging paths
 * record the same shape whether they allowed or refused. */
export function regCxAuditDetails(
  decision: RegCxDecision,
  customer: { id?: string | null; name: string; phone: string },
  regCxAgentId: string | null
): Record<string, unknown> {
  return {
    customer_id: customer.id ?? null,
    customer_name: customer.name,
    phone_number: customer.phone,
    pancake_delivered_count: decision.deliveredCount,
    pancake_total_orders: decision.totalOrders,
    current_order_source: decision.currentOrderSource,
    current_caller_name: decision.currentCallerName,
    matched_order_source: decision.matchedOrderSource,
    matched_caller_name: decision.matchedCallerName,
    validation_result: decision.result,
    reg_cx_agent_id: regCxAgentId,
  };
}
