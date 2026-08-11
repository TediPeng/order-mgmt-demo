import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { computeRtsPercentage } from "@/lib/performance";
import type { AgentScope } from "@/lib/leads-query";
import type { AgentDashboardStats, ManagementKpiStats } from "@/lib/performance";
import type { Order } from "@/lib/types";

/**
 * Dashboard figures, counted by the database.
 *
 * The cards used to be derived from every order this viewer can see — 57,000
 * rows fetched to produce eight numbers. The definitions live in SQL now
 * (lib/../migrations: dashboard_kpis and friends) and are deliberately the
 * same ones lib/performance.ts documents: leads bucket by created_at in the
 * app's timezone, sales and fulfillment bucket by order_date, and RTS is
 * Returned over Delivered on an order-count basis.
 *
 * The lead counts (total/new/ringing) exclude regular customers, matching
 * lead_status_counts() and the Leads list; the order-dated figures include
 * them, because those orders are sales. Both halves of that rule live in
 * dashboard_kpis and in computeManagementKpiStats, and must change together.
 *
 * computeManagementKpiStats / computeAgentDashboardStats remain in
 * lib/performance.ts: they are still the definition of record, still used
 * where a list of orders is already in hand, and they are what these results
 * were checked against.
 */

const TZ = process.env.APP_TIMEZONE || "Asia/Manila";

interface KpiRow {
  total_leads: number;
  new_leads: number;
  ringing_leads: number;
  sales_count: number;
  sales_qty: number;
  sales_amount: number;
  delivered_count: number;
  delivered_qty: number;
  delivered_amount: number;
  returned_count: number;
  returned_qty: number;
  returned_amount: number;
}

async function fetchKpis(scope: AgentScope, from: string, to: string): Promise<KpiRow> {
  const { data, error } = await supabaseAdmin.rpc("dashboard_kpis", {
    p_agent_ids: scope,
    p_from: from,
    p_to: to,
    p_tz: TZ,
  });
  if (error) throw new Error(`Dashboard KPIs failed: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as KpiRow | undefined;
  return (
    row ?? {
      total_leads: 0,
      new_leads: 0,
      ringing_leads: 0,
      sales_count: 0,
      sales_qty: 0,
      sales_amount: 0,
      delivered_count: 0,
      delivered_qty: 0,
      delivered_amount: 0,
      returned_count: 0,
      returned_qty: 0,
      returned_amount: 0,
    }
  );
}

const num = (v: unknown) => Number(v ?? 0);

/** The Management/Team Lead KPI cards. */
export async function managementKpis(scope: AgentScope, from: string, to: string): Promise<ManagementKpiStats> {
  const r = await fetchKpis(scope, from, to);
  const salesCount = num(r.sales_count);
  const salesAmount = num(r.sales_amount);
  return {
    totalLeads: num(r.total_leads),
    newOrders: num(r.new_leads),
    sales: { count: salesCount, quantity: num(r.sales_qty), amount: salesAmount },
    delivered: { count: num(r.delivered_count), quantity: num(r.delivered_qty), amount: num(r.delivered_amount) },
    returned: { count: num(r.returned_count), quantity: num(r.returned_qty), amount: num(r.returned_amount) },
    aov: salesCount > 0 ? Math.round((salesAmount / salesCount) * 100) / 100 : null,
    rtsPercentage: computeRtsPercentage(num(r.delivered_count), num(r.returned_count)),
  };
}

/** The agent's own version of the same cards. */
export async function agentKpis(agentId: string, from: string, to: string): Promise<AgentDashboardStats> {
  const r = await fetchKpis([agentId], from, to);
  const totalOrders = num(r.sales_count);
  const salesAmount = num(r.sales_amount);
  return {
    totalLeads: num(r.total_leads),
    newLeads: num(r.new_leads),
    ringingLeads: num(r.ringing_leads),
    totalOrders,
    salesAmount,
    aov: totalOrders > 0 ? Math.round((salesAmount / totalOrders) * 100) / 100 : null,
    delivered: { count: num(r.delivered_count), quantity: num(r.delivered_qty), amount: num(r.delivered_amount) },
    returned: { count: num(r.returned_count), quantity: num(r.returned_qty), amount: num(r.returned_amount) },
    rtsPercentage: computeRtsPercentage(num(r.delivered_count), num(r.returned_count)),
  };
}

/** Counts for the In Fulfillment card, already filtered to non-zero statuses
 * by the caller's status list. */
export async function fulfillmentCounts(
  scope: AgentScope,
  from: string,
  to: string,
  statuses: readonly string[]
): Promise<{ status: Order["status"]; count: number }[]> {
  const { data, error } = await supabaseAdmin.rpc("dashboard_fulfillment_counts", {
    p_agent_ids: scope,
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(`Fulfillment counts failed: ${error.message}`);
  const byStatus = new Map<string, number>(
    ((data || []) as { status: string; n: number }[]).map((r) => [r.status, Number(r.n)])
  );
  return statuses
    .map((status) => ({ status: status as Order["status"], count: byStatus.get(status) ?? 0 }))
    .filter((r) => r.count > 0);
}

export interface AgentTotalsRow {
  agent_id: string;
  orders: number;
  quantity: number;
  amount: number;
  returned: number;
}

/** Per-agent order totals for a range — the Team/My Performance Today cards
 * and the ranking widget. Calls Made comes from call sessions, which are their
 * own targeted query already. */
export async function agentOrderTotals(scope: AgentScope, from: string, to: string): Promise<AgentTotalsRow[]> {
  const { data, error } = await supabaseAdmin.rpc("dashboard_agent_totals", {
    p_agent_ids: scope,
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(`Agent totals failed: ${error.message}`);
  return ((data || []) as Record<string, unknown>[]).map((r) => ({
    agent_id: String(r.agent_id),
    orders: num(r.orders),
    quantity: num(r.quantity),
    amount: num(r.amount),
    returned: num(r.returned),
  }));
}
