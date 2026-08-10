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
