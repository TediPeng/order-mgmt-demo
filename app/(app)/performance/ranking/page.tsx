import Link from "next/link";
import { redirect } from "next/navigation";
import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeAgentsForRanking, computeDailyAgentStats, totalsByAgent, resolveDateRange, type AgentTotals } from "@/lib/performance";
import { countCompletedSessions } from "@/lib/call-sessions";
import { formatCurrency } from "@/lib/utils";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { RankingBars } from "@/components/RankingBars";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Field";

const RANK_OPTIONS = [
  { key: "sales", label: "Highest Sales", field: "amount", dir: -1 as const, direction: "higher_better" as const },
  { key: "orders", label: "Highest Order Qty", field: "orders", dir: -1 as const, direction: "higher_better" as const },
  { key: "conversion", label: "Highest Conversion Rate", field: "conversion_rate", dir: -1 as const, direction: "higher_better" as const },
  { key: "aov", label: "Highest AOV", field: "aov", dir: -1 as const, direction: "higher_better" as const },
  { key: "return_rate", label: "Lowest Return Rate", field: "return_rate", dir: 1 as const, direction: "lower_better" as const },
];

function statusBadge(value: number | null, average: number, direction: "higher_better" | "lower_better", topRatio: number, lowRatio: number) {
  if (value === null || average === 0) return <Badge className="bg-slate-100 text-slate-500">No data</Badge>;
  const ratio = value / average;
  const isTop = direction === "higher_better" ? ratio >= topRatio : ratio <= 1 / topRatio;
  const isLow = direction === "higher_better" ? ratio <= lowRatio : ratio >= 1 / lowRatio;
  if (isTop) return <Badge className="bg-green-100 text-green-700">Top Performer</Badge>;
  if (isLow) return <Badge className="bg-amber-100 text-amber-700">Needs Improvement</Badge>;
  return <Badge className="bg-blue-100 text-blue-700">On Track</Badge>;
}

export default async function RankingPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; rank_by?: string; view?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDb();

  if (!can(user.role, "ranking", "view", db.role_permissions)) redirect("/dashboard");

  const scopedAgents = scopeAgentsForRanking(db, user);
  const agentIds = scopedAgents.map((a) => a.id);
  const range = resolveDateRange(sp.range, sp.from, sp.to);
  const daily = computeDailyAgentStats(db, agentIds, range.from, range.to, await countCompletedSessions(agentIds, range.from, range.to, db.operations.min_call_seconds));
  const totals = totalsByAgent(daily);
  const profileById = new Map(db.profiles.map((p) => [p.id, p]));

  const rankOption = RANK_OPTIONS.find((r) => r.key === sp.rank_by) || RANK_OPTIONS[0];
  const field = rankOption.field as keyof AgentTotals;
  const isTableView = sp.view === "table";

  const sorted = [...totals].sort((a, b) => {
    const av = a[field] as number | null;
    const bv = b[field] as number | null;
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return rankOption.dir * ((av as number) - (bv as number));
  });

  const validValues = sorted.map((t) => t[field] as number | null).filter((v): v is number => v !== null);
  const average = validValues.length > 0 ? validValues.reduce((s, v) => s + v, 0) / validValues.length : 0;
  const { top_performer_min_ratio, needs_improvement_max_ratio } = db.performance_thresholds;

  // Bar length = agent's value / top agent's value (Section 3). sorted[0] is
  // always "best" per the current direction, so its value anchors 100% --
  // this keeps the top-ranked bar full regardless of higher/lower-is-better.
  const topValue = (sorted[0]?.[field] as number | null) ?? 0;
  const barRows = sorted.map((t) => ({
    agent_id: t.agent_id,
    full_name: profileById.get(t.agent_id)?.full_name || "Unknown",
    avatar_url: profileById.get(t.agent_id)?.avatar_url ?? null,
    amount: t.amount,
    orders: t.orders,
    conversion_rate: t.conversion_rate,
    barValue: (t[field] as number | null) ?? 0,
  }));

  const qs = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { ...sp, ...overrides };
    Object.entries(merged).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    return `?${params.toString()}`;
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Agent Ranking</h1>
        <div className="flex rounded-md border border-slate-200 bg-white p-1 text-xs">
          <Link
            href={qs({ view: undefined })}
            className={`rounded px-2.5 py-1 font-medium ${!isTableView ? "bg-[var(--brand-primary)] text-white" : "text-slate-500 hover:bg-slate-100"}`}
          >
            Bar Chart
          </Link>
          <Link
            href={qs({ view: "table" })}
            className={`rounded px-2.5 py-1 font-medium ${isTableView ? "bg-[var(--brand-primary)] text-white" : "text-slate-500 hover:bg-slate-100"}`}
          >
            Table
          </Link>
        </div>
      </div>
      <div className="mb-4">
        <DateRangeFilter />
      </div>

      <form className="mb-4 flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <label className="text-sm font-medium text-slate-600">Rank by</label>
        <input type="hidden" name="range" value={sp.range || ""} />
        <input type="hidden" name="from" value={sp.from || ""} />
        <input type="hidden" name="to" value={sp.to || ""} />
        <input type="hidden" name="view" value={sp.view || ""} />
        <Select name="rank_by" defaultValue={rankOption.key} className="w-64">
          {RANK_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </Select>
        <button type="submit" className="rounded-md bg-[var(--brand-primary)] px-3 py-1.5 text-sm font-medium text-white">
          Apply
        </button>
      </form>

      {isTableView ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Rank</th>
                <th className="px-4 py-3">Agent Name</th>
                <th className="px-4 py-3">Calls Made</th>
                <th className="px-4 py-3">Order Qty</th>
                <th className="px-4 py-3">Total Order Amount</th>
                <th className="px-4 py-3">Conversion Rate</th>
                <th className="px-4 py-3">AOV</th>
                <th className="px-4 py-3">Return Rate</th>
                <th className="px-4 py-3">Performance Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((t, idx) => (
                <tr key={t.agent_id} className={t.agent_id === user.id ? "bg-[var(--brand-primary-10)]" : ""}>
                  <td className="px-4 py-3 font-semibold text-slate-700">#{idx + 1}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {profileById.get(t.agent_id)?.full_name || "Unknown"}
                    {t.agent_id === user.id && (
                      <span className="ml-1.5 rounded-full bg-[var(--brand-primary)] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        You
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{t.calls}</td>
                  <td className="px-4 py-3">{t.orders}</td>
                  <td className="px-4 py-3">{formatCurrency(t.amount)}</td>
                  <td className="px-4 py-3">{t.conversion_rate === null ? "—" : `${t.conversion_rate}%`}</td>
                  <td className="px-4 py-3">{t.aov === null ? "—" : formatCurrency(t.aov)}</td>
                  <td className="px-4 py-3">{t.return_rate === null ? "—" : `${t.return_rate}%`}</td>
                  <td className="px-4 py-3">
                    {statusBadge(t[field] as number | null, average, rankOption.direction, top_performer_min_ratio, needs_improvement_max_ratio)}
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                    No agents in scope for this range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <RankingBars rows={barRows} topValue={topValue} currentUserId={user.id} />
      )}
    </div>
  );
}
