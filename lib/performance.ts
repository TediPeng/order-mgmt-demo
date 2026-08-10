import type { DbShape, Order, Profile } from "./types";
import { todayInTz, dateInTz } from "./utils";
import { isFullAccess } from "./permissions";
import { FULFILLMENT_STATUSES } from "./validation";
import type { DailyOrderStat } from "./performance-query";

// The sale-status filter moved into agent_daily_order_stats(), which is handed
// SALE_STATUSES by lib/performance-query.ts rather than keeping a copy of the
// list. lib/validation.ts is still the only place the rule is written down.

export type Granularity = "daily" | "weekly" | "monthly";

export interface AgentDailyRow {
  agent_id: string;
  date: string; // YYYY-MM-DD, bucket start for weekly/monthly
  /** Completed calling sessions — the basis for Calls Made and Conversion Rate.
   * Work actually done in the system, which a spreadsheet cannot inflate. */
  calls: number;
  /** Rows from uploaded call logs. Kept as a separate compliance figure, NOT
   * used in any rate, so the two numbers can be compared rather than conflated. */
  uploaded_call_logs: number;
  orders: number;
  quantity: number; // sum of order.quantity for sale-status orders -- AOV's denominator (Section 0.3)
  amount: number;
  returned: number;
  time_in: string | null;
  time_out: string | null;
  total_hours: number | null;
}

export interface AgentAggRow extends AgentDailyRow {
  conversion_rate: number | null; // percent, null = "—"
  aov: number | null;
}

function callEffectiveDate(callDate: string, uploadedAt: string): string {
  if (callDate) {
    const parsed = new Date(callDate);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return uploadedAt.slice(0, 10);
}

export function eligibleAgents(db: DbShape): Profile[] {
  return db.profiles.filter((p) => !isFullAccess(p.role));
}

/** Restricts the visible agent set based on the viewer's role: management/administrator
 * sees all, team leads see their assigned agents plus themselves, everyone else sees only themselves. */
export function scopeAgentsForUser(db: DbShape, user: Profile): Profile[] {
  const all = eligibleAgents(db);
  if (isFullAccess(user.role)) return all;
  if (user.role === "team_lead") return all.filter((a) => a.id === user.id || a.team_lead_id === user.id);
  return all.filter((a) => a.id === user.id);
}

/** Section 0.7: an intentional exception to "own data only" for Agent Ranking --
 * an agent (with the ranking:view permission) sees their own team-lead's whole
 * group, not just themselves, so the ranking chart is meaningful. Every other
 * view keeps using scopeAgentsForUser's strict per-agent scoping. */
export function scopeAgentsForRanking(db: DbShape, user: Profile): Profile[] {
  const all = eligibleAgents(db);
  if (isFullAccess(user.role)) return all;
  if (user.role === "team_lead") return all.filter((a) => a.id === user.id || a.team_lead_id === user.id);
  return all.filter((a) => a.id === user.id || (user.team_lead_id && a.team_lead_id === user.team_lead_id));
}

/** One row per agent per calendar date, for the given date range (inclusive, YYYY-MM-DD). */
export function computeDailyAgentStats(
  db: DbShape,
  agentIds: string[],
  from: string,
  to: string,
  /** Completed sessions keyed `agentId|YYYY-MM-DD`, from lib/call-sessions.
   * Passed in because sessions live outside DbShape; omitted, Calls Made is 0
   * rather than silently falling back to uploaded logs. */
  sessionCounts?: Map<string, number>,
  /** Sales keyed the same way, from lib/performance-query.ts. Passed in for
   * the same reason and with the same consequence: omitted, this reads as "no
   * orders" rather than falling back to a scan of db.orders — which is what it
   * used to do, on four pages, over every order in the system. */
  orderStats?: Map<string, DailyOrderStat>
): AgentDailyRow[] {
  const rowMap = new Map<string, AgentDailyRow>();
  const key = (agentId: string, date: string) => `${agentId}|${date}`;
  const agentIdSet = new Set(agentIds);

  const callLogById = new Map(db.call_logs.map((c) => [c.id, c]));
  for (const rec of db.call_log_records) {
    if (!rec.agent_id || !agentIdSet.has(rec.agent_id)) continue;
    const callLog = callLogById.get(rec.call_log_id);
    const date = callEffectiveDate(rec.call_date, callLog?.uploaded_at || "");
    if (date < from || date > to) continue;
    const k = key(rec.agent_id, date);
    const row = rowMap.get(k) || {
      agent_id: rec.agent_id,
      date,
      calls: 0,
      uploaded_call_logs: 0,
      orders: 0,
      quantity: 0,
      amount: 0,
      returned: 0,
      time_in: null,
      time_out: null,
      total_hours: null,
    };
    row.uploaded_call_logs++;
    rowMap.set(k, row);
  }

  if (sessionCounts) {
    for (const [k, count] of sessionCounts) {
      const [agentId, date] = k.split("|");
      if (!agentIdSet.has(agentId) || date < from || date > to) continue;
      const row = rowMap.get(k) || {
        agent_id: agentId,
        date,
        calls: 0,
        uploaded_call_logs: 0,
        orders: 0,
        quantity: 0,
        amount: 0,
        returned: 0,
        time_in: null,
        time_out: null,
        total_hours: null,
      };
      row.calls = count;
      rowMap.set(k, row);
    }
  }

  // Performance dates key off order_date (the Ready-to-Ship date) — a lead
  // that never became a sale has no order_date and doesn't appear here. The
  // grouping, the sale-status filter and the returned count all happen in
  // agent_daily_order_stats(); what arrives is already one figure per day.
  if (orderStats) {
    for (const [k, stat] of orderStats) {
      const [agentId, date] = k.split("|");
      if (!agentIdSet.has(agentId) || date < from || date > to) continue;
      const row = rowMap.get(k) || {
        agent_id: agentId,
        date,
        calls: 0,
        uploaded_call_logs: 0,
        orders: 0,
        quantity: 0,
        amount: 0,
        returned: 0,
        time_in: null,
        time_out: null,
        total_hours: null,
      };
      row.orders = stat.orders;
      row.quantity = stat.quantity;
      row.amount = stat.amount;
      row.returned = stat.returned;
      rowMap.set(k, row);
    }
  }

  for (const att of db.attendance) {
    if (!agentIdSet.has(att.user_id)) continue;
    if (att.work_date < from || att.work_date > to) continue;
    const k = key(att.user_id, att.work_date);
    const row = rowMap.get(k) || {
      agent_id: att.user_id,
      date: att.work_date,
      calls: 0,
      uploaded_call_logs: 0,
      orders: 0,
      quantity: 0,
      amount: 0,
      returned: 0,
      time_in: null,
      time_out: null,
      total_hours: null,
    };
    row.time_in = att.time_in;
    row.time_out = att.time_out;
    row.total_hours = att.total_hours;
    rowMap.set(k, row);
  }

  return Array.from(rowMap.values());
}

function withRates(row: AgentDailyRow): AgentAggRow {
  return {
    ...row,
    conversion_rate: row.calls > 0 ? Math.round((row.orders / row.calls) * 10000) / 100 : null,
    aov: row.orders > 0 ? Math.round((row.amount / row.orders) * 100) / 100 : null,
  };
}

export function withComputedRates(rows: AgentDailyRow[]): AgentAggRow[] {
  return rows.map(withRates);
}

function periodBucket(date: string, granularity: Granularity): string {
  if (granularity === "daily") return date;
  const d = new Date(date + "T00:00:00Z");
  if (granularity === "monthly") {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }
  // weekly: Monday as start of week
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

/** Sums daily rows into period buckets per agent, then recomputes rates from the summed totals. */
export function aggregateByPeriod(rows: AgentDailyRow[], granularity: Granularity): AgentAggRow[] {
  if (granularity === "daily") return withComputedRates(rows);

  const map = new Map<string, AgentDailyRow>();
  for (const row of rows) {
    const bucket = periodBucket(row.date, granularity);
    const k = `${row.agent_id}|${bucket}`;
    const acc = map.get(k) || {
      agent_id: row.agent_id,
      date: bucket,
      calls: 0,
      uploaded_call_logs: 0,
      orders: 0,
      quantity: 0,
      amount: 0,
      returned: 0,
      time_in: null,
      time_out: null,
      total_hours: 0,
    };
    acc.calls += row.calls;
    acc.uploaded_call_logs += row.uploaded_call_logs;
    acc.orders += row.orders;
    acc.quantity += row.quantity;
    acc.amount += row.amount;
    acc.returned += row.returned;
    acc.total_hours = (acc.total_hours || 0) + (row.total_hours || 0);
    map.set(k, acc);
  }
  return withComputedRates(Array.from(map.values()));
}

export interface AgentTotals {
  agent_id: string;
  calls: number;
  orders: number;
  quantity: number;
  amount: number;
  returned: number;
  total_hours: number;
  conversion_rate: number | null;
  aov: number | null;
  return_rate: number | null;
}

export function totalsByAgent(rows: AgentDailyRow[]): AgentTotals[] {
  const map = new Map<string, AgentTotals>();
  for (const row of rows) {
    const acc = map.get(row.agent_id) || {
      agent_id: row.agent_id,
      calls: 0,
      uploaded_call_logs: 0,
      orders: 0,
      quantity: 0,
      amount: 0,
      returned: 0,
      total_hours: 0,
      conversion_rate: null,
      aov: null,
      return_rate: null,
    };
    acc.calls += row.calls;
    acc.orders += row.orders;
    acc.quantity += row.quantity;
    acc.amount += row.amount;
    acc.returned += row.returned;
    acc.total_hours += row.total_hours || 0;
    map.set(row.agent_id, acc);
  }
  for (const acc of map.values()) {
    acc.conversion_rate = acc.calls > 0 ? Math.round((acc.orders / acc.calls) * 10000) / 100 : null;
    acc.aov = acc.orders > 0 ? Math.round((acc.amount / acc.orders) * 100) / 100 : null;
    acc.return_rate = acc.orders > 0 ? Math.round((acc.returned / acc.orders) * 10000) / 100 : null;
  }
  return Array.from(map.values());
}

export interface AgentDashboardStats {
  totalLeads: number;
  newLeads: number;
  ringingLeads: number;
  /** Leads that reached Packaging in the period (i.e. have an Order Date). */
  totalOrders: number;
  /** Value of those orders. */
  salesAmount: number;
  /** Sales / Total Orders — an order-count basis, consistent system-wide. */
  aov: number | null;
  delivered: { count: number; quantity: number; amount: number };
  returned: { count: number; quantity: number; amount: number };
  rtsPercentage: number;
}

export interface QtyAmount {
  count: number;
  quantity: number;
  amount: number;
}

/** order_date-bucketed count/quantity/amount for orders currently in `status`. */
function aggregateByStatusAndOrderDate(orders: Order[], status: Order["status"], from: string, to: string): QtyAmount {
  const matched = orders.filter((o) => o.status === status && o.order_date && o.order_date >= from && o.order_date <= to);
  return {
    count: matched.length,
    quantity: matched.reduce((s, o) => s + o.quantity, 0),
    amount: matched.reduce((s, o) => s + o.total_amount, 0),
  };
}

/** RTS % — Returned Orders / Delivered Orders x 100, a return-to-sender rate on
 * an order-count basis. Reports 0 rather than "no data" when nothing has been
 * delivered, so every screen shows a number. Lower is better. */
export function computeRtsPercentage(deliveredOrders: number, returnedOrders: number): number {
  if (deliveredOrders <= 0) return 0;
  return Math.round((returnedOrders / deliveredOrders) * 10000) / 100;
}

/** Stats for the Agent dashboard cards, scoped to one agent's own leads and a
 * date range (inclusive, YYYY-MM-DD). Total Leads/New/Ringing bucket by
 * created_at — the only date a lead has before Packaging. Total Orders, Sales,
 * Delivered and Returned bucket by order_date, the Packaging date, which later
 * status changes never rewrite. */
export function computeAgentDashboardStats(db: DbShape, agentId: string, from: string, to: string): AgentDashboardStats {
  const own = db.orders.filter((o) => o.agent_id === agentId);

  const cohort = own.filter((o) => {
    const d = dateInTz(new Date(o.created_at));
    return d >= from && d <= to;
  });
  const totalLeads = cohort.length;
  const newLeads = cohort.filter((o) => o.status === "new").length;
  const ringingLeads = cohort.filter((o) => o.status === "ringing").length;

  // Total Orders = reached Packaging in the period. Keyed off order_date, not
  // the current status, so an order that has since shipped still counts.
  const packagedInPeriod = own.filter((o) => o.order_date && o.order_date >= from && o.order_date <= to);
  const totalOrders = packagedInPeriod.length;
  const salesAmount = packagedInPeriod.reduce((s, o) => s + o.total_amount, 0);

  const delivered = aggregateByStatusAndOrderDate(own, "delivered", from, to);
  const returned = aggregateByStatusAndOrderDate(own, "returned", from, to);

  return {
    totalLeads,
    newLeads,
    ringingLeads,
    totalOrders,
    salesAmount,
    aov: totalOrders > 0 ? Math.round((salesAmount / totalOrders) * 100) / 100 : null,
    delivered,
    returned,
    rtsPercentage: computeRtsPercentage(delivered.count, returned.count),
  };
}

/** Per-status counts for the "In Fulfillment" dashboard card: fulfillment
 * stages that don't already have their own card (Delivered/Returned do).
 * Bucketed by order_date like the other fulfillment aggregations. */
export function computeFulfillmentBreakdown(
  orders: Order[],
  from: string,
  to: string
): { status: Order["status"]; count: number }[] {
  // Derived from the shared list so a change to the Pancake-aligned statuses
  // shows up here automatically. Delivered and Returned have their own cards.
  const statuses = FULFILLMENT_STATUSES.filter(
    (s) => s !== "delivered" && s !== "returned"
  ) as unknown as Order["status"][];
  return statuses
    .map((status) => ({ status, count: aggregateByStatusAndOrderDate(orders, status, from, to).count }))
    .filter((r) => r.count > 0);
}

export interface ManagementKpiStats {
  totalLeads: number;
  newOrders: number;
  sales: QtyAmount;
  delivered: QtyAmount;
  returned: QtyAmount;
  aov: number | null;
  rtsPercentage: number;
}

/** Stats for the Management/Team Lead KPI dashboard (Section 1), over an
 * already-scoped order list and a date range. "Sales" = leads that reached
 * Ready to Ship, identified by having an Order Date in the period (Section
 * 0.2) -- independent of their current status, so a lead later Delivered or
 * Returned still counts as a sale. */
export function computeManagementKpiStats(orders: Order[], from: string, to: string): ManagementKpiStats {
  const cohort = orders.filter((o) => {
    const d = dateInTz(new Date(o.created_at));
    return d >= from && d <= to;
  });
  const totalLeads = cohort.length;
  const newOrders = cohort.filter((o) => o.status === "new").length;

  const salesLeads = orders.filter((o) => !!o.order_date && o.order_date >= from && o.order_date <= to);
  const salesQuantity = salesLeads.reduce((s, o) => s + o.quantity, 0);
  const salesAmount = salesLeads.reduce((s, o) => s + o.total_amount, 0);
  const sales: QtyAmount = { count: salesLeads.length, quantity: salesQuantity, amount: salesAmount };

  const delivered = aggregateByStatusAndOrderDate(orders, "delivered", from, to);
  const returned = aggregateByStatusAndOrderDate(orders, "returned", from, to);

  return {
    totalLeads,
    newOrders,
    sales,
    delivered,
    returned,
    aov: sales.count > 0 ? Math.round((salesAmount / sales.count) * 100) / 100 : null,
    rtsPercentage: computeRtsPercentage(delivered.count, returned.count),
  };
}

export type ChartMetric = "sales" | "orders" | "calls" | "conversion";

export interface SeriesGroup {
  key: string;
  label: string;
  agentIds: string[];
}

export interface ChartPoint {
  date: string;
  [key: string]: number | string;
}

/** Builds one row per date with a value per series group for the chosen metric,
 * plus per-series calls/orders/amount breakdown (for rich tooltips), keyed as
 * `${seriesKey}__calls`, `${seriesKey}__orders`, `${seriesKey}__amount`. */
export function buildChartSeries(daily: AgentDailyRow[], groups: SeriesGroup[], metric: ChartMetric): ChartPoint[] {
  const dates = Array.from(new Set(daily.map((d) => d.date))).sort();
  return dates.map((date) => {
    const point: ChartPoint = { date };
    for (const group of groups) {
      const rows = daily.filter((d) => d.date === date && group.agentIds.includes(d.agent_id));
      const calls = rows.reduce((s, r) => s + r.calls, 0);
      const orders = rows.reduce((s, r) => s + r.orders, 0);
      const amount = rows.reduce((s, r) => s + r.amount, 0);
      let value: number;
      if (metric === "sales") value = amount;
      else if (metric === "orders") value = orders;
      else if (metric === "calls") value = calls;
      else value = calls > 0 ? Math.round((orders / calls) * 10000) / 100 : 0;
      point[group.key] = value;
      point[`${group.key}__calls`] = calls;
      point[`${group.key}__orders`] = orders;
      point[`${group.key}__amount`] = amount;
    }
    return point;
  });
}

export interface DateRange {
  from: string;
  to: string;
  label: string;
}

export function resolveDateRange(preset: string | undefined, customFrom?: string, customTo?: string): DateRange {
  const today = todayInTz();
  if (preset === "custom" && customFrom && customTo) {
    return { from: customFrom, to: customTo, label: `${customFrom} to ${customTo}` };
  }
  if (preset === "yesterday") {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    const y = d.toISOString().slice(0, 10);
    return { from: y, to: y, label: "Yesterday" };
  }
  if (preset === "this_week") {
    const d = new Date(today + "T00:00:00Z");
    const day = d.getUTCDay();
    const diff = (day === 0 ? -6 : 1) - day;
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() + diff);
    return { from: monday.toISOString().slice(0, 10), to: today, label: "This Week" };
  }
  if (preset === "this_month") {
    const d = new Date(today + "T00:00:00Z");
    const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    return { from: first.toISOString().slice(0, 10), to: today, label: "This Month" };
  }
  // default "today"
  return { from: today, to: today, label: "Today" };
}
