import { redirect } from "next/navigation";
import { Download, PhoneCall, ShoppingCart, Wallet, Calculator, Percent } from "lucide-react";
import { readDbLite } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { scopeAgentsForUser, computeDailyAgentStats, aggregateByPeriod, resolveDateRange, type Granularity } from "@/lib/performance";
import { agentDailyOrderStats, agentLeadStatusCounts } from "@/lib/performance-query";
import { LEAD_STATUSES, LEAD_STATUS_LABELS } from "@/lib/validation";
import { countCompletedSessions } from "@/lib/call-sessions";
import { formatCurrency, formatDate, formatTime } from "@/lib/utils";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { StatWidget } from "@/components/StatCard";

type SP = Record<string, string | undefined>;

function qs(sp: SP, overrides: SP = {}): string {
  const params = new URLSearchParams();
  Object.entries({ ...sp, ...overrides }).forEach(([k, v]) => {
    if (v) params.set(k, v);
  });
  return `?${params.toString()}`;
}

export default async function AgentPerformancePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDbLite();

  if (!can(user.role, "performance", "view", db.role_permissions)) redirect("/dashboard");
  const canExport = can(user.role, "performance", "export", db.role_permissions);

  const scopedAgents = scopeAgentsForUser(db, user);
  const agentFilterAllowed = isFullAccess(user.role) || user.role === "team_lead";
  let agentIds = scopedAgents.map((a) => a.id);
  if (agentFilterAllowed && sp.agent) {
    agentIds = agentIds.filter((id) => id === sp.agent);
  }

  const range = resolveDateRange(sp.range, sp.from, sp.to);
  const granularity: Granularity = (sp.view as Granularity) || "daily";

  // Sessions and sales both come from the database; the merge and every rate
  // still happen in lib/performance.ts.
  const [sessionCounts, orderStats] = await Promise.all([
    countCompletedSessions(agentIds, range.from, range.to, db.operations.min_call_seconds),
    agentDailyOrderStats(agentIds, range.from, range.to),
  ]);
  // Administrators and Management only. A Team Lead's page stops at their own
  // team's performance; this is the whole floor's book of work, counted by
  // where each lead currently stands, and that is a management view.
  const canSeeLeadBreakdown = isFullAccess(user.role);
  const leadCounts = canSeeLeadBreakdown
    ? await agentLeadStatusCounts(agentIds, range.from, range.to, db.work_schedule.timezone)
    : new Map<string, number>();

  // Only the statuses this range actually reached. There are 26 of them and a
  // real range reaches perhaps two thirds — columns of zeros for the rest would
  // push the ones that matter off the side of the screen.
  const liveStatuses = LEAD_STATUSES.filter((s) => scopedAgents.some((a) => (leadCounts.get(`${a.id}|${s}`) || 0) > 0));
  const leadRows = scopedAgents
    .map((a) => {
      const byStatus = liveStatuses.map((s) => leadCounts.get(`${a.id}|${s}`) || 0);
      return { id: a.id, name: a.full_name, byStatus, total: byStatus.reduce((sum, n) => sum + n, 0) };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const leadTotals = liveStatuses.map((_, i) => leadRows.reduce((sum, r) => sum + r.byStatus[i], 0));

  const daily = computeDailyAgentStats(db, agentIds, range.from, range.to, sessionCounts, orderStats);
  const rows = aggregateByPeriod(daily, granularity);

  const byId = new Map(db.profiles.map((p) => [p.id, p.full_name]));
  let table = rows.map((r) => ({ ...r, agent_name: byId.get(r.agent_id) || "Unknown" }));

  if (sp.q) {
    const q = sp.q.toLowerCase();
    table = table.filter((r) => r.agent_name.toLowerCase().includes(q));
  }

  const sortKey = sp.sort || "date";
  const dir = sp.dir === "asc" ? 1 : -1;
  table.sort((a, b) => {
    const av = (a as unknown as Record<string, unknown>)[sortKey];
    const bv = (b as unknown as Record<string, unknown>)[sortKey];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (typeof av === "string" && typeof bv === "string") return dir * av.localeCompare(bv);
    return dir * ((av as number) - (bv as number));
  });

  const sortLink = (key: string) => qs(sp, { sort: key, dir: sp.sort === key && sp.dir !== "asc" ? "asc" : "desc" });

  // Totals for the rows actually on screen, so the widgets agree with the
  // table beneath them -- including when the name search has narrowed it. A
  // summary that ignored the filter would quietly contradict what it sits on.
  // Rates are recomputed from the totals rather than averaged from the rows:
  // the mean of per-row conversion rates is not the conversion rate.
  const sum = (pick: (r: (typeof table)[number]) => number) => table.reduce((acc, r) => acc + pick(r), 0);
  const totalCalls = sum((r) => r.calls);
  const totalOrders = sum((r) => r.orders);
  const totalAmount = sum((r) => r.amount);
  const conversion = totalCalls > 0 ? Math.round((totalOrders / totalCalls) * 10000) / 100 : null;
  const aov = totalOrders > 0 ? totalAmount / totalOrders : null;

  return (
    <div>
      <h1 className="mb-4 text-page-title text-slate-900">Agent Performance</h1>

      <div className="mb-4">
        <DateRangeFilter />
      </div>

      {canSeeLeadBreakdown && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-3">
            <h2 className="text-section-title text-slate-900">Leads by Agent</h2>
            <p className="text-xs text-slate-500">
              {formatDate(range.from)} – {formatDate(range.to)} · counted by the status each lead stands at now
            </p>
          </div>
          {leadRows.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500">No leads fall in this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-table">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="sticky left-0 z-10 bg-slate-50 px-4 py-2 font-semibold">Agent</th>
                    <th className="px-3 py-2 text-right font-semibold">Total</th>
                    {liveStatuses.map((s) => (
                      <th key={s} className="whitespace-nowrap px-3 py-2 text-right font-semibold">
                        {LEAD_STATUS_LABELS[s]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {leadRows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <th className="sticky left-0 z-10 whitespace-nowrap bg-white px-4 py-2 text-left font-medium text-slate-700">
                        {r.name}
                      </th>
                      <td className="num px-3 py-2 font-semibold text-slate-900">{r.total.toLocaleString()}</td>
                      {r.byStatus.map((n, i) => (
                        // A zero in a column somebody else has leads in is worth
                        // seeing, but not worth reading as hard as a real count.
                        <td key={liveStatuses[i]} className={`num px-3 py-2 ${n === 0 ? "text-slate-300" : "text-slate-700"}`}>
                          {n === 0 ? "—" : n.toLocaleString()}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold text-slate-900">
                  <tr>
                    <th className="sticky left-0 z-10 bg-slate-50 px-4 py-2 text-left">All agents</th>
                    <td className="num px-3 py-2">{leadTotals.reduce((s, n) => s + n, 0).toLocaleString()}</td>
                    {leadTotals.map((n, i) => (
                      <td key={liveStatuses[i]} className="num px-3 py-2">
                        {n.toLocaleString()}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      <form className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="range" value={sp.range || ""} />
          <input type="hidden" name="from" value={sp.from || ""} />
          <input type="hidden" name="to" value={sp.to || ""} />
          <input type="hidden" name="view" value={granularity} />
          <Input name="q" placeholder="Search agent name" defaultValue={sp.q} className="w-56" />
          {agentFilterAllowed && (
            <Select name="agent" defaultValue={sp.agent || ""} className="w-56">
              <option value="">All agents</option>
              {scopedAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.full_name}
                </option>
              ))}
            </Select>
          )}
          <Button type="submit" variant="secondary" size="sm">
            Apply
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-md border border-slate-200 bg-white p-1 text-xs">
            {(["daily", "weekly", "monthly"] as Granularity[]).map((g) => (
              <a
                key={g}
                href={qs(sp, { view: g })}
                className={`rounded px-2.5 py-1 font-medium capitalize ${
                  granularity === g ? "bg-[var(--brand-primary)] text-white" : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                {g}
              </a>
            ))}
          </div>
          {canExport && (
            <a href={`/api/performance/export${qs(sp)}`}>
              <Button type="button" variant="outline" size="sm">
                <Download className="h-4 w-4" /> Export
              </Button>
            </a>
          )}
        </div>
      </form>

      {/* Below the filters, above the table it summarises — the totals move
          when the search does, so they read as belonging to the rows rather
          than to the page. */}
      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        <StatWidget label="Calls Made" value={totalCalls} tone="brand" icon={PhoneCall} />
        <StatWidget label="Orders" value={totalOrders} tone="blue" icon={ShoppingCart} />
        <StatWidget label="Sales" value={formatCurrency(totalAmount)} tone="green" icon={Wallet} />
        <StatWidget
          label="Conversion Rate"
          value={conversion === null ? "—" : `${conversion}%`}
          tone="amber"
          icon={Percent}
        />
        <StatWidget label="AOV" value={aov === null ? "—" : formatCurrency(aov)} tone="slate" icon={Calculator} />
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead className="sticky top-0 z-20 bg-slate-50 shadow-sm text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Agent Name</th>
              <th className="px-4 py-3">
                <a href={sortLink("date")}>Performance Date</a>
              </th>
              <th className="px-4 py-3">
                <a href={sortLink("calls")}>Calls Made</a>
              </th>
              <th className="px-4 py-3">
                <a href={sortLink("orders")}>Order Qty</a>
              </th>
              <th className="px-4 py-3">
                <a href={sortLink("amount")}>Total Order Amount</a>
              </th>
              <th className="px-4 py-3">
                <a href={sortLink("conversion_rate")}>Conversion Rate</a>
              </th>
              <th className="px-4 py-3">
                <a href={sortLink("aov")}>AOV</a>
              </th>
              {granularity === "daily" && (
                <>
                  <th className="px-4 py-3">Time In</th>
                  <th className="px-4 py-3">Time Out</th>
                </>
              )}
              <th className="px-4 py-3">Total Hours</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {table.map((r, idx) => (
              <tr key={`${r.agent_id}-${r.date}-${idx}`}>
                <td className="px-4 py-3 font-medium text-slate-800">{r.agent_name}</td>
                <td className="px-4 py-3 text-slate-500">{formatDate(r.date)}</td>
                <td className="px-4 py-3">{r.calls}</td>
                <td className="px-4 py-3">{r.orders}</td>
                <td className="px-4 py-3">{formatCurrency(r.amount)}</td>
                <td className="px-4 py-3">{r.conversion_rate === null ? "—" : `${r.conversion_rate}%`}</td>
                <td className="px-4 py-3">{r.aov === null ? "—" : formatCurrency(r.aov)}</td>
                {granularity === "daily" && (
                  <>
                    <td className="px-4 py-3">{formatTime(r.time_in)}</td>
                    <td className="px-4 py-3">{formatTime(r.time_out)}</td>
                  </>
                )}
                <td className="px-4 py-3">{r.total_hours ?? "—"}</td>
              </tr>
            ))}
            {table.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                  No performance data for this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
