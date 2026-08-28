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
  UserCheck,
  UserPlus,
} from "lucide-react";
import { readDbLite } from "@/lib/db";
import { recentActivity as fetchRecentActivity } from "@/lib/audit-log";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDate, formatDateTime } from "@/lib/utils";
import { StatGrid, StatWidget } from "@/components/StatCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { AttendanceWidget } from "@/components/AttendanceWidget";
import { portalOwnsAttendance } from "@/lib/portal-attendance";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { RankingBars, type RankingRow } from "@/components/RankingBars";
import { scopeAgentsForUser, scopeAgentsForRanking, resolveDateRange } from "@/lib/performance";
import { leadScopeFor, leadStatusCounts } from "@/lib/leads-query";
import { LeadStatusCards, QUICK_FILTER_STATUSES } from "@/components/LeadStatusCards";
import { agentKpis, managementKpis, fulfillmentCounts, agentOrderTotals } from "@/lib/dashboard-query";
import { countCompletedSessions } from "@/lib/call-sessions";
import { LEAD_STATUS_LABELS, FULFILLMENT_STATUSES } from "@/lib/validation";
import { formatCurrency, todayInTz } from "@/lib/utils";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  // Lite: every figure below is counted by the database. Fetching all 57,000
  // orders to produce eight numbers is what made this page take twenty
  // seconds.
  const db = await readDbLite();

  const isAgent = user.role === "agent";
  const scope = leadScopeFor(user, db);

  const canImport = can(user.role, "orders", "upload", db.role_permissions);
  const canViewCallLogs = !isAgent && can(user.role, "call_logs", "view", db.role_permissions);
  const canUploadCallLogs = can(user.role, "call_logs", "upload", db.role_permissions);
  const canViewRegularCustomers = can(user.role, "regular_customers", "view", db.role_permissions);
  const canAddRegularCustomer = can(user.role, "regular_customers", "create", db.role_permissions);
  const canViewPerformance = can(user.role, "performance", "view", db.role_permissions);

  // All Time unless a preset is chosen.
  //
  // It opened on Today, which answered a question nobody was asking of a
  // dashboard: Total Leads read 509 against the Leads page's 51,986 and looked
  // broken, and after a day's import it reads a fraction of the floor's actual
  // book. The presets are still one click away for anyone who wants a period —
  // the point is that the number you land on is the whole of what is there.
  const dashboardRange = resolveDateRange(sp.range ?? "all", sp.from, sp.to);
  // Delivered and Returned have cards of their own, so the In Fulfillment card
  // shows the stages between.
  const inFulfilmentStatuses = FULFILLMENT_STATUSES.filter((s) => s !== "delivered" && s !== "returned");
  const [agentStats, kpiStats, fulfillmentBreakdown, statusCountsByStatus] = await Promise.all([
    isAgent ? agentKpis(user.id, dashboardRange.from, dashboardRange.to) : Promise.resolve(null),
    !isAgent ? managementKpis(scope, dashboardRange.from, dashboardRange.to) : Promise.resolve(null),
    fulfillmentCounts(scope, dashboardRange.from, dashboardRange.to, inFulfilmentStatuses),
    // Where the agent's leads are sitting right now. Deliberately not date
    // ranged: "how many of mine are on Cannot Be Reached" is a question about
    // the present, not about a period, and the same figures back the cards on
    // the Leads page.
    leadStatusCounts(scope),
  ]);
  const statusCounts = QUICK_FILTER_STATUSES.map((s) => ({
    status: s,
    count: statusCountsByStatus.get(s) ?? 0,
  }));
  const statusTotal = Array.from(statusCountsByStatus.values()).reduce((n, c) => n + c, 0);
  const fulfillmentTotal = fulfillmentBreakdown.reduce((s, r) => s + r.count, 0);
  const rtsWarn = (pct: number | null) => pct !== null && pct > db.performance_thresholds.rts_warning_threshold_pct;

  const canViewRanking = isAgent && can(user.role, "ranking", "view", db.role_permissions);
  let rankingWidget: { rows: RankingRow[]; topValue: number } | null = null;
  if (canViewRanking) {
    const rankedAgentIds = scopeAgentsForRanking(db, user).map((a) => a.id);
    const profileById = new Map(db.profiles.map((p) => [p.id, p]));
    const [totals, sessions] = await Promise.all([
      agentOrderTotals(rankedAgentIds, dashboardRange.from, dashboardRange.to),
      countCompletedSessions(rankedAgentIds, dashboardRange.from, dashboardRange.to, db.operations.min_call_seconds),
    ]);
    // Calls are keyed agentId|date by the session query; the ranking wants one
    // number per agent for the whole range.
    const callsByAgent = new Map<string, number>();
    for (const [key, count] of sessions) {
      const agentId = key.split("|")[0];
      callsByAgent.set(agentId, (callsByAgent.get(agentId) ?? 0) + count);
    }
    const rankedTotals = [...totals].sort((a, b) => b.amount - a.amount).slice(0, 5);
    rankingWidget = {
      rows: rankedTotals.map((t) => {
        const calls = callsByAgent.get(t.agent_id) ?? 0;
        return {
          agent_id: t.agent_id,
          full_name: profileById.get(t.agent_id)?.full_name || "Unknown",
          avatar_url: profileById.get(t.agent_id)?.avatar_url ?? null,
          amount: t.amount,
          orders: t.orders,
          // Same definition as totalsByAgent(): orders over calls made, and
          // null rather than a division by zero when nobody called.
          conversion_rate: calls > 0 ? Math.round((t.orders / calls) * 10000) / 100 : null,
          barValue: t.amount,
        };
      }),
      topValue: rankedTotals[0]?.amount ?? 0,
    };
  }

  let teamToday: { calls: number; orders: number; amount: number; activeAgents: number } | null = null;
  if (!isAgent && canViewPerformance) {
    const today = todayInTz();
    const scoped = scopeAgentsForUser(db, user).map((a) => a.id);
    const [totals, sessions] = await Promise.all([
      agentOrderTotals(scoped, today, today),
      countCompletedSessions(scoped, today, today, db.operations.min_call_seconds),
    ]);
    const callsByAgent = new Map<string, number>();
    for (const [key, count] of sessions) {
      const agentId = key.split("|")[0];
      callsByAgent.set(agentId, (callsByAgent.get(agentId) ?? 0) + count);
    }
    // An agent counts as active on either measure, so the set is the union of
    // "made a call" and "took an order" — not just those with an order row.
    const active = new Set<string>();
    for (const [agentId, calls] of callsByAgent) if (calls > 0) active.add(agentId);
    for (const t of totals) if (t.orders > 0) active.add(t.agent_id);
    teamToday = {
      calls: Array.from(callsByAgent.values()).reduce((s, c) => s + c, 0),
      orders: totals.reduce((s, t) => s + t.orders, 0),
      amount: totals.reduce((s, t) => s + t.amount, 0),
      activeAgents: active.size,
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
    const [totals, sessions] = await Promise.all([
      agentOrderTotals([user.id], today, today),
      countCompletedSessions([user.id], today, today, db.operations.min_call_seconds),
    ]);
    myToday = {
      calls: Array.from(sessions.values()).reduce((s, c) => s + c, 0),
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
      {/* The quick actions ride in the title row rather than in a card further
          down. They are the first thing anybody opens this page to do, and a
          card below the statistics meant scrolling past the numbers to reach
          the buttons that act on them. */}
      <PageHeader
        title={`Welcome back, ${user.full_name.split(" ")[0]}`}
        description={today}
        actions={
          <>
            {/* Two separate actions on purpose: one creates a lead, the other a
                regular customer. They are not the same thing.

                Not offered to agents. Leads reach an agent by assignment, and
                one they typed in themselves is a row nobody handed them —
                counted in their queue, in their conversion, and traceable to no
                source. Everyone else keeps it. */}
            {!isAgent && (
              <LinkButton href="/leads/new" variant="outline" size="sm">
                <PlusCircle className="h-4 w-4" /> New Lead
              </LinkButton>
            )}
            {/* Opens their own Regular Customers list, where each row can raise
                an order from the customer's saved details. */}
            {canViewRegularCustomers && (
              <LinkButton href="/regular-customers" variant="outline" size="sm">
                <UserCheck className="h-4 w-4" /> Regular Customers
              </LinkButton>
            )}
            {canAddRegularCustomer && (
              <LinkButton href="/regular-customers/new" variant="outline" size="sm">
                <UserPlus className="h-4 w-4" /> Add Regular Customer
              </LinkButton>
            )}
            {canImport && (
              <LinkButton href="/leads/import" variant="outline" size="sm">
                <FileSpreadsheet className="h-4 w-4" /> Import Excel
              </LinkButton>
            )}
            {canUploadCallLogs && (
              <LinkButton href="/call-logs" variant="outline" size="sm">
                <PhoneCall className="h-4 w-4" /> Upload Call Log
              </LinkButton>
            )}
            {/* Which numbers have already been rung today. Every other calling
                figure in the app is a count; this is the list. */}
            <LinkButton href="/calls" variant="outline" size="sm">
              <PhoneCall className="h-4 w-4" /> Numbers Called
            </LinkButton>
            <LinkButton href="/attendance" variant="outline" size="sm">
              <Clock3 className="h-4 w-4" /> View Attendance
            </LinkButton>
          </>
        }
      />

      {isAgent && agentStats ? (
        <>
          <DateRangeFilter defaultPreset="all" />
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

          {/* Where their leads are sitting, every status of it. The cards
              above answer "how did the period go"; this answers "what is on my
              desk", which is the question an agent starts the shift with. */}
          <div>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-section-title text-slate-900">My leads by status</h2>
              <p className="text-xs text-slate-400">
                Where your leads stand right now — not affected by the date range above.
              </p>
            </div>
            <LeadStatusCards
              counts={statusCounts}
              total={statusTotal}
              hrefFor={(status) => (status ? `/leads?status=${status}` : "/leads")}
            />
          </div>
        </>
      ) : (
        kpiStats && (
          <>
            <DateRangeFilter defaultPreset="all" />
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
          {/* Gone from the dashboard once the portal keeps the time. The card
              was a clock, and a clock that cannot be set is decoration -- worse
              than decoration on the first screen of the day, where it is the
              thing an agent reaches for and it would send them somewhere else
              every morning. The Attendance page still carries it, for reading
              back the day the portal recorded. */}
          {!portalOwnsAttendance() && <AttendanceWidget user={user} showClock />}

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
