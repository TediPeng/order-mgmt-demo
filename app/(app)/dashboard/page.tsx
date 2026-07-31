import Link from "next/link";
import {
  PlusCircle,
  FileSpreadsheet,
  PhoneCall,
  Clock3,
  ShoppingCart,
  PackageCheck,
  Wallet,
  Calculator,
  Undo2,
  Percent,
  Sparkles,
} from "lucide-react";
import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDate, formatDateTime } from "@/lib/utils";
import { StatCard, StatGrid } from "@/components/StatCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { AttendanceWidget } from "@/components/AttendanceWidget";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { RankingBars, type RankingRow } from "@/components/RankingBars";
import {
  scopeAgentsForUser,
  scopeAgentsForRanking,
  computeDailyAgentStats,
  totalsByAgent,
  computeAgentDashboardStats,
  computeManagementKpiStats,
  computeFulfillmentBreakdown,
  resolveDateRange,
} from "@/lib/performance";
import { countCompletedSessions } from "@/lib/call-sessions";
import { LEAD_STATUS_LABELS } from "@/lib/validation";
import { scopeOrders } from "@/lib/order-access";
import { formatCurrency, todayInTz } from "@/lib/utils";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDb();

  const isAgent = user.role === "agent";
  const orders = scopeOrders(user, db.orders, db);

  const canImport = can(user.role, "orders", "upload", db.role_permissions);
  const canViewCallLogs = !isAgent && can(user.role, "call_logs", "view", db.role_permissions);
  const canUploadCallLogs = can(user.role, "call_logs", "upload", db.role_permissions);
  const canViewPerformance = can(user.role, "performance", "view", db.role_permissions);

  const dashboardRange = resolveDateRange(sp.range, sp.from, sp.to);
  const agentStats = isAgent ? computeAgentDashboardStats(db, user.id, dashboardRange.from, dashboardRange.to) : null;
  const kpiStats = !isAgent ? computeManagementKpiStats(orders, dashboardRange.from, dashboardRange.to) : null;
  const fulfillmentBreakdown = computeFulfillmentBreakdown(orders, dashboardRange.from, dashboardRange.to);
  const fulfillmentTotal = fulfillmentBreakdown.reduce((s, r) => s + r.count, 0);
  const rtsWarn = (pct: number | null) => pct !== null && pct > db.performance_thresholds.rts_warning_threshold_pct;

  const canViewRanking = isAgent && can(user.role, "ranking", "view", db.role_permissions);
  let rankingWidget: { rows: RankingRow[]; topValue: number } | null = null;
  if (canViewRanking) {
    const rankedAgentIds = scopeAgentsForRanking(db, user).map((a) => a.id);
    const profileById = new Map(db.profiles.map((p) => [p.id, p]));
    const rankedTotals = totalsByAgent(computeDailyAgentStats(db, rankedAgentIds, dashboardRange.from, dashboardRange.to, await countCompletedSessions(rankedAgentIds, dashboardRange.from, dashboardRange.to, db.operations.min_call_seconds)))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
    rankingWidget = {
      rows: rankedTotals.map((t) => ({
        agent_id: t.agent_id,
        full_name: profileById.get(t.agent_id)?.full_name || "Unknown",
        avatar_url: profileById.get(t.agent_id)?.avatar_url ?? null,
        amount: t.amount,
        orders: t.orders,
        conversion_rate: t.conversion_rate,
        barValue: t.amount,
      })),
      topValue: rankedTotals[0]?.amount ?? 0,
    };
  }

  let teamToday: { calls: number; orders: number; amount: number; activeAgents: number } | null = null;
  if (!isAgent && canViewPerformance) {
    const today = todayInTz();
    const scoped = scopeAgentsForUser(db, user).map((a) => a.id);
    const totals = totalsByAgent(computeDailyAgentStats(db, scoped, today, today, await countCompletedSessions(scoped, today, today, db.operations.min_call_seconds)));
    teamToday = {
      calls: totals.reduce((s, t) => s + t.calls, 0),
      orders: totals.reduce((s, t) => s + t.orders, 0),
      amount: totals.reduce((s, t) => s + t.amount, 0),
      activeAgents: totals.filter((t) => t.calls > 0 || t.orders > 0).length,
    };
  }

  const recentCallLogs = [...db.call_logs].sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at)).slice(0, 5);
  const byId = new Map(db.profiles.map((p) => [p.id, p.full_name]));

  const activity = isAgent ? db.activity_log.filter((e) => e.user_id === user.id) : db.activity_log;
  const recentActivity = [...activity].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 10);

  const today = new Intl.DateTimeFormat("en-PH", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: process.env.APP_TIMEZONE || "Asia/Manila",
  }).format(new Date());

  return (
    <div className="space-y-6">
      <PageHeader title={`Welcome back, ${user.full_name.split(" ")[0]}`} description={today} />

      {isAgent && agentStats ? (
        <>
          <DateRangeFilter />
          {/* Row 1: volume and value. Row 2: outcomes. Every card links to the
              matching filtered leads view. */}
          <StatGrid>
            <StatCard label="Total Leads" value={agentStats.totalLeads} href="/leads" tone="brand" icon={ShoppingCart} />
            <StatCard
              label="Total Orders"
              value={agentStats.totalOrders}
              href="/leads?status=packaging"
              tone="blue"
              icon={PackageCheck}
            />
            <StatCard
              label="Overall Sales"
              value={formatCurrency(agentStats.salesAmount)}
              href="/leads?status=packaging"
              tone="green"
              icon={Wallet}
            />
            <StatCard
              label="AOV"
              value={agentStats.aov === null ? formatCurrency(0) : formatCurrency(agentStats.aov)}
              tone="slate"
              icon={Calculator}
            />
          </StatGrid>
          <StatGrid>
            <StatCard
              label="Delivered"
              value={agentStats.delivered.count}
              href="/leads?status=delivered"
              tone="green"
              icon={PackageCheck}
              extra={<p>{formatCurrency(agentStats.delivered.amount)}</p>}
            />
            <StatCard
              label="Returned"
              value={agentStats.returned.count}
              href="/leads?status=returned"
              tone="maroon"
              icon={Undo2}
              extra={<p>{formatCurrency(agentStats.returned.amount)}</p>}
            />
            <StatCard
              label="RTS %"
              value={`${agentStats.rtsPercentage}%`}
              href="/leads?status=returned"
              tone="amber"
              icon={Percent}
            />
            <StatCard label="New Leads" value={agentStats.newLeads} href="/leads?status=new" tone="blue" icon={Sparkles} />
          </StatGrid>
        </>
      ) : (
        kpiStats && (
          <>
            <DateRangeFilter />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Total Leads" value={kpiStats.totalLeads} href="/leads" />
              <StatCard label="Total New Orders" value={kpiStats.newOrders} href="/leads?status=new" />
              <StatCard
                label="Overall Sales"
                value={formatCurrency(kpiStats.sales.amount)}
                href="/leads?status=packaging"
                extra={<p>Qty: {kpiStats.sales.quantity}</p>}
              />
              <StatCard
                label="Overall Returned Orders"
                value={formatCurrency(kpiStats.returned.amount)}
                href="/leads?status=returned"
                accent="text-red-900"
                extra={<p>Qty: {kpiStats.returned.quantity}</p>}
              />
              <StatCard
                label="Overall Delivered Orders"
                value={formatCurrency(kpiStats.delivered.amount)}
                href="/leads?status=delivered"
                accent="text-teal-700"
                extra={<p>Qty: {kpiStats.delivered.quantity}</p>}
              />
              <StatCard
                label="In Fulfillment"
                value={fulfillmentTotal}
                href="/leads"
                accent="text-indigo-700"
                extra={fulfillmentBreakdown.map((r) => (
                  <p key={r.status}>
                    {LEAD_STATUS_LABELS[r.status]}: {r.count}
                  </p>
                ))}
              />
              <StatCard label="Overall AOV" value={kpiStats.aov === null ? "—" : formatCurrency(kpiStats.aov)} />
              <StatCard
                label="Overall RTS Percentage"
                value={kpiStats.rtsPercentage === null ? "—" : `${kpiStats.rtsPercentage}%`}
                accent={rtsWarn(kpiStats.rtsPercentage) ? "text-red-600" : undefined}
              />
            </div>
          </>
        )
      )}

      {teamToday && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Team Performance Today</CardTitle>
            <Link href="/performance/team" className="text-xs font-medium text-[var(--brand-primary)] hover:underline">
              View details
            </Link>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs uppercase text-slate-400">Calls Made</p>
              <p className="text-page-title text-slate-900">{teamToday.calls}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-400">Orders</p>
              <p className="text-page-title text-slate-900">{teamToday.orders}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-400">Sales</p>
              <p className="text-page-title text-slate-900">{formatCurrency(teamToday.amount)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-400">Active Agents</p>
              <p className="text-page-title text-slate-900">{teamToday.activeAgents}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <LinkButton href="/leads/new" variant="outline">
                <PlusCircle className="h-4 w-4" /> Regular Customer
              </LinkButton>
              {canImport && (
                <LinkButton href="/leads/import" variant="outline">
                  <FileSpreadsheet className="h-4 w-4" /> Import Excel
                </LinkButton>
              )}
              {canUploadCallLogs && (
                <LinkButton href="/call-logs" variant="outline">
                  <PhoneCall className="h-4 w-4" /> Upload Call Log
                </LinkButton>
              )}
              <LinkButton href="/attendance" variant="outline">
                <Clock3 className="h-4 w-4" /> View Attendance
              </LinkButton>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y divide-slate-100">
                {recentActivity.map((e) => (
                  <li key={e.id} className="flex items-center justify-between px-5 py-3 text-sm">
                    <div>
                      <span className="font-medium text-slate-700">
                        {e.user_id ? byId.get(e.user_id) || "Unknown" : "System"}
                      </span>{" "}
                      <span className="text-slate-500">{e.action.replaceAll("_", " ").toLowerCase()}</span>
                    </div>
                    <span className="shrink-0 text-xs text-slate-400">{formatDateTime(e.created_at)}</span>
                  </li>
                ))}
                {recentActivity.length === 0 && (
                  <li className="px-5 py-6 text-center text-sm text-slate-400">No recent activity.</li>
                )}
              </ul>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <AttendanceWidget user={user} showClock />

          {rankingWidget && (
            <Card>
              <CardHeader className="flex items-center justify-between">
                <CardTitle>Team Ranking</CardTitle>
                <Link href="/performance/ranking" className="text-xs font-medium text-[var(--brand-primary)] hover:underline">
                  View full ranking
                </Link>
              </CardHeader>
              <CardContent>
                <RankingBars rows={rankingWidget.rows} topValue={rankingWidget.topValue} currentUserId={user.id} compact />
              </CardContent>
            </Card>
          )}

          {canViewCallLogs && (
            <Card>
              <CardHeader>
                <CardTitle>Recent Call Log Uploads</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-slate-100">
                  {recentCallLogs.map((c) => (
                    <li key={c.id} className="px-5 py-3 text-sm">
                      <Link href={`/call-logs/${c.id}`} className="font-medium text-[var(--brand-primary)] hover:underline">
                        {c.file_name}
                      </Link>
                      <p className="text-xs text-slate-400">
                        {byId.get(c.uploaded_by) || "—"} · {formatDate(c.uploaded_at)}
                      </p>
                    </li>
                  ))}
                  {recentCallLogs.length === 0 && (
                    <li className="px-5 py-6 text-center text-sm text-slate-400">No uploads yet.</li>
                  )}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
