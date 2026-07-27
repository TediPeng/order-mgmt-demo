import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { scopeAgentsForUser, computeDailyAgentStats, aggregateByPeriod, resolveDateRange, type Granularity } from "@/lib/performance";
import { formatCurrency, formatDate, formatTime } from "@/lib/utils";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

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
  const db = readDb();

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

  const daily = computeDailyAgentStats(db, agentIds, range.from, range.to);
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

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Agent Performance</h1>

      <div className="mb-4">
        <DateRangeFilter />
      </div>

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

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
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
