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
import { recentActivity as fetchRecentActivity } from "@/lib/audit-log";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDate, formatDateTime } from "@/lib/utils";
import { StatGrid, StatWidget } from "@/components/StatCard";
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

  // The agent's own version of the card above, off the same helpers with the
  // agent set narrowed to themselves. Not gated on performance:view -- these
  // are the agent's own numbers, like every other card on their dashboard;
  // that permission decides whether the /performance pages open, so it gates
  // the "View details" link instead.
  let myToday: { calls: number; orders: number; amount: number } | null = null;
  if (isAgent) {
    const today = todayInTz();
    const totals = totalsByAgent(
      computeDailyAgentStats(db, [user.id], today, today, await countCompletedSessions([user.id], today, today, db.operations.min_call_seconds))
    );
    myToday = {
      calls: totals.reduce((s, t) => s + t.calls, 0),
      orders: totals.reduce((s, t) => s + t.orders, 0),
      amount: totals.reduce((s, t) => s + t.amount, 0),
    };
  }

  // One card, two audiences. Active Agents only means something across a team,
  // so the agent's card carries three measures and sizes its grid to match.
  const todayCard: { title: string; href: string | null; stats: { label: string; value: string | number }[] } | null = teamToday
    ? {
        title: "Team Performance Today",
        href: "/performance/team",
        stats: [
          { label: "Calls Made", value: teamToday.calls },
          { label: "Orders", value: teamToday.orders },
          { label: "Sales", value: formatCurrency(teamToday.amount) },
          { label: "Active Agents", value: teamToday.activeAgents },
        ],
      }
    : myToday
      ? {
          title: "My Performance Today",
          href: canViewPerformance ? "/performance/agents" : null,
          stats: [
            { label: "Calls Made", value: myToday.calls },
            { label: "Orders", value: myToday.orders },
            { label: "Sales", value: formatCurrency(myToday.amount) },
          ],
        }
      : null;

  const recentCallLogs = [...db.call_logs].sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at)).slice(0, 5);
  const byId = new Map(db.profiles.map((p) => [p.id, p.full_name]));

  // Agents only ever see their own entries, so the scoping is pushed into the
  // query rather than filtering a full copy of the trail.
  const canViewAuditLogs = can(user.role, "audit_logs", "view", db.role_permissions);
  const recentActivity = canViewAuditLogs ? await fetchRecentActivity(10, isAgent ? user.id : null) : [];

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
            <StatWidget label="Total Leads" value={agentStats.totalLeads} href="/leads" tone="brand" icon={ShoppingCart} />
            <StatWidget
              label="Total Orders"
              value={agentStats.totalOrders}
              href="/leads?status=packaging"
              tone="blue"
              icon={PackageCheck}
            />
            <StatWidget
              label="Overall Sales"
              value={formatCurrency(agentStats.salesAmount)}
              href="/leads?status=packaging"
              tone="green"
              icon={Wallet}
            />
            <StatWidget
              label="AOV"
              value={agentStats.aov === null ? formatCurrency(0) : formatCurrency(agentStats.aov)}
              tone="slate"
              icon={Calculator}
            />
          </StatGrid>
          <StatGrid>
            <StatWidget
              label="Delivered"
              value={agentStats.delivered.count}
              href="/leads?status=delivered"
              tone="green"
              icon={PackageCheck}
              sub={<p>{formatCurrency(agentStats.delivered.amount)}</p>}
            />
            <StatWidget
              label="Returned"
              value={agentStats.returned.count}
              href="/leads?status=returned"
              tone="maroon"
              icon={Undo2}
              sub={<p>{formatCurrency(agentStats.returned.amount)}</p>}
            />
            <StatWidget
              label="RTS %"
              value={`${agentStats.rtsPercentage}%`}
              href="/leads?status=returned"
              tone="amber"
              icon={Percent}
            />
            <StatWidget
              label="New Leads"
              value={agentStats.newLeads}
              href="/leads?status=new"
              tone="blue"
              icon={Sparkles}
            />
          </StatGrid>
        </>
      ) : (
        kpiStats && (
          <>
            <DateRangeFilter />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* The accent colours these carried as text now become the tile
                  itself, so the palette says the same thing it did before:
                  returned reads red, delivered teal-green, fulfilment indigo. */}
              <StatWidget label="Total Leads" value={kpiStats.totalLeads} href="/leads" tone="brand" icon={ShoppingCart} />
              <StatWidget
                label="Total New Orders"
                value={kpiStats.newOrders}
                href="/leads?status=new"
                tone="blue"
                icon={Sparkles}
              />
              <StatWidget
                label="Overall Sales"
                value={formatCurrency(kpiStats.sales.amount)}
                href="/leads?status=packaging"
                tone="green"
                icon={Wallet}
                sub={<p>Qty: {kpiStats.sales.quantity}</p>}
              />
              <StatWidget
                label="Overall Returned Orders"
                value={formatCurrency(kpiStats.returned.amount)}
                href="/leads?status=returned"
                tone="maroon"
                icon={Undo2}
                sub={<p>Qty: {kpiStats.returned.quantity}</p>}
              />
              <StatWidget
                label="Overall Delivered Orders"
                value={formatCurrency(kpiStats.delivered.amount)}
                href="/leads?status=delivered"
                tone="green"
                icon={PackageCheck}
                sub={<p>Qty: {kpiStats.delivered.quantity}</p>}
              />
              <StatWidget
                label="In Fulfillment"
                value={fulfillmentTotal}
                href="/leads"
                tone="blue"
                icon={ShoppingCart}
                sub={fulfillmentBreakdown.map((r) => (
                  <p key={r.status}>
                    {LEAD_STATUS_LABELS[r.status]}: {r.count}
                  </p>
                ))}
              />
              <StatWidget
                label="Overall AOV"
                value={kpiStats.aov === null ? "—" : formatCurrency(kpiStats.aov)}
                tone="slate"
                icon={Calculator}
              />
              {/* RTS keeps its warning behaviour: over the configured threshold
                  the whole tile goes red rather than just the number. */}
              <StatWidget
                label="Overall RTS Percentage"
                value={kpiStats.rtsPercentage === null ? "—" : `${kpiStats.rtsPercentage}%`}
                tone={rtsWarn(kpiStats.rtsPercentage) ? "maroon" : "amber"}
                icon={Percent}
              />
            </div>
          </>
        )
      )}

      {todayCard && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>{todayCard.title}</CardTitle>
            {todayCard.href && (
              <Link href={todayCard.href} className="text-xs font-medium text-[var(--brand-primary)] hover:underline">
                View details
              </Link>
            )}
          </CardHeader>
          <CardContent
            className={`grid grid-cols-2 gap-4 ${todayCard.stats.length === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}
          >
            {todayCard.stats.map((s) => (
              <div key={s.label}>
                <p className="text-xs uppercase text-slate-400">{s.label}</p>
                <p className="text-page-title text-slate-900">{s.value}</p>
              </div>
            ))}
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

          {/* Audit-derived, so it follows audit_logs:view like every other
              audit surface. Agents were shown their own entries only, which is
              not a leak — but it is still the audit trail wearing a different
              title, and an agent has no use for reading their own actions back
              to themselves. */}
          {canViewAuditLogs && (
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
          )}
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
