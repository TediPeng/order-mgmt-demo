import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { SALE_STATUSES } from "@/lib/validation";

/**
 * The order side of the performance rows, asked of the database.
 *
 * computeDailyAgentStats() in lib/performance.ts remains the definition of
 * record: it merges call logs, calling sessions, attendance and these into one
 * row per agent per day, and every rate is still computed there. What moved is
 * the scan — four pages and an export were reading all 57,000 orders to add up
 * a few hundred days.
 *
 * Passed in rather than fetched inside, following countCompletedSessions():
 * that file is pure, and the data it merges comes from its callers.
 */

/**
 * How many leads each agent has never called, keyed by agent id.
 *
 * Unranged on purpose. A backlog is a standing quantity: how much work is
 * waiting does not become a different question because a date filter moved,
 * and a queue that shrank when the dates narrowed would read as progress.
 *
 * Only agents with something waiting come back.
 */
export async function agentRemainingLeads(agentIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (agentIds.length === 0) return counts;

  const { data, error } = await supabaseAdmin.rpc("agent_remaining_leads", { p_agent_ids: agentIds });
  if (error) throw new Error(`Remaining leads query failed: ${error.message}`);

  for (const row of (data || []) as { agent_id: string; leads: number | string }[]) {
    counts.set(row.agent_id, Number(row.leads));
  }
  return counts;
}

/**
 * How many leads each agent holds at each status, over a date range.
 *
 * Ranged on created_at rather than order_date, unlike everything else in this
 * file. order_date is set when a lead becomes an order, and most leads never
 * get that far -- in production 51,907 of 52,344 rows have none, including
 * every one of the 47,263 sitting at `new`. Ranging on it would answer "how
 * many sales" while claiming to answer "how many leads".
 *
 * Keyed `agentId|status`. Only pairs that actually have leads come back: there
 * are 26 statuses and no agent is in more than a handful, so a zero for every
 * combination would be mostly noise to send and mostly noise to render.
 */
export async function agentLeadStatusCounts(
  agentIds: string[],
  from: string,
  to: string,
  timezone: string
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (agentIds.length === 0) return counts;

  const { data, error } = await supabaseAdmin.rpc("agent_lead_status_counts", {
    p_agent_ids: agentIds,
    p_from: from,
    p_to: to,
    // The company timezone decides which day a lead was taken on, the same way
    // it decides what a scheduled time means.
    p_timezone: timezone,
  });
  if (error) throw new Error(`Agent lead status query failed: ${error.message}`);

  for (const row of (data || []) as { agent_id: string; status: string; leads: number | string }[]) {
    counts.set(`${row.agent_id}|${row.status}`, Number(row.leads));
  }
  return counts;
}

export interface DailyOrderStat {
  orders: number;
  quantity: number;
  amount: number;
  returned: number;
}

/** Keyed `agentId|YYYY-MM-DD`, the same key computeDailyAgentStats() uses. */
export async function agentDailyOrderStats(
  agentIds: string[],
  from: string,
  to: string
): Promise<Map<string, DailyOrderStat>> {
  const stats = new Map<string, DailyOrderStat>();
  if (agentIds.length === 0) return stats;

  const { data, error } = await supabaseAdmin.rpc("agent_daily_order_stats", {
    p_agent_ids: agentIds,
    p_from: from,
    p_to: to,
    // The rule lives in lib/validation.ts and is sent to the query, so there is
    // no second copy of it in SQL to fall out of step.
    p_sale_statuses: [...SALE_STATUSES],
  });
  if (error) throw new Error(`Agent performance query failed: ${error.message}`);

  for (const row of (data || []) as {
    agent_id: string;
    date: string;
    orders: number | string;
    quantity: number | string;
    amount: number | string;
    returned: number | string;
  }[]) {
    stats.set(`${row.agent_id}|${row.date}`, {
      orders: Number(row.orders),
      quantity: Number(row.quantity),
      amount: Number(row.amount),
      returned: Number(row.returned),
    });
  }
  return stats;
}
