import { redirect } from "next/navigation";
import { readDbLite } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeAgentsForUser, computeDailyAgentStats, totalsByAgent, resolveDateRange } from "@/lib/performance";
import { agentDailyOrderStats } from "@/lib/performance-query";
import { countCompletedSessions } from "@/lib/call-sessions";
import { formatCurrency } from "@/lib/utils";
import { PhoneCall, ShoppingCart, Wallet, Percent, Calculator, Users2 } from "lucide-react";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { Card, CardContent } from "@/components/ui/Card";
import { StatWidget, type StatTone } from "@/components/StatCard";

export default async function TeamPerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDbLite();

  if (!can(user.role, "performance", "view", db.role_permissions)) redirect("/dashboard");

  const scopedAgents = scopeAgentsForUser(db, user);
  const agentIds = scopedAgents.map((a) => a.id);
  const range = resolveDateRange(sp.range, sp.from, sp.to);
  // Sessions and sales both come from the database; the merge and every rate
  // still happen in lib/performance.ts.
  const [sessionCounts, orderStats] = await Promise.all([
    countCompletedSessions(agentIds, range.from, range.to, db.operations.min_call_seconds),
    agentDailyOrderStats(agentIds, range.from, range.to),
  ]);
  const daily = computeDailyAgentStats(db, agentIds, range.from, range.to, sessionCounts, orderStats);
  const totals = totalsByAgent(daily);
  const byId = new Map(db.profiles.map((p) => [p.id, p.full_name]));

  const totalCalls = totals.reduce((s, t) => s + t.calls, 0);
  const totalOrders = totals.reduce((s, t) => s + t.orders, 0);
  const totalQuantity = totals.reduce((s, t) => s + t.quantity, 0);
  const totalAmount = totals.reduce((s, t) => s + t.amount, 0);
  const overallConversion = totalCalls > 0 ? Math.round((totalOrders / totalCalls) * 10000) / 100 : null;
  // AOV = Total Sales Amount / Total Order Quantity (Section 0.3) -- not order count.
  const overallAov = totalQuantity > 0 ? Math.round((totalAmount / totalQuantity) * 100) / 100 : null;
  const activeAgents = totals.filter((t) => t.calls > 0 || t.orders > 0).length;

  const ranked = [...totals].sort((a, b) => b.amount - a.amount);
  const highest = ranked[0];
  const lowest = ranked[ranked.length - 1];

  // Tones match the dashboard's vocabulary rather than being chosen per page:
  // volume is brand, counts blue, money green, rates amber, derived figures
  // slate. A number means the same colour wherever it appears.
  const cards: { label: string; value: string | number; tone: StatTone; icon: React.ElementType }[] = [
    { label: "Total Calls Made", value: totalCalls, tone: "brand", icon: PhoneCall },
    { label: "Total Order Qty", value: totalOrders, tone: "blue", icon: ShoppingCart },
    { label: "Total Order Amount", value: formatCurrency(totalAmount), tone: "green", icon: Wallet },
    {
      label: "Overall Conversion Rate",
      value: overallConversion === null ? "—" : `${overallConversion}%`,
      tone: "amber",
      icon: Percent,
    },
    {
      label: "Overall AOV",
      value: overallAov === null ? "—" : formatCurrency(overallAov),
      tone: "slate",
      icon: Calculator,
    },
    { label: "Active Agents", value: activeAgents, tone: "slate", icon: Users2 },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-page-title text-slate-900">Team Performance</h1>
      <DateRangeFilter />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <StatWidget key={c.label} label={c.label} value={c.value} tone={c.tone} icon={c.icon} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardContent>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Highest-Performing Agent <span className="normal-case text-slate-300">(by Total Order Amount)</span>
            </p>
            {highest && highest.amount > 0 ? (
              <>
                <p className="mt-2 text-lg font-semibold text-green-700">{byId.get(highest.agent_id) || "—"}</p>
                <p className="text-sm text-slate-500">{formatCurrency(highest.amount)} in sales</p>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-400">No sales in this range yet.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Lowest-Performing Agent <span className="normal-case text-slate-300">(by Total Order Amount)</span>
            </p>
            {lowest ? (
              <>
                <p className="mt-2 text-lg font-semibold text-red-700">{byId.get(lowest.agent_id) || "—"}</p>
                <p className="text-sm text-slate-500">{formatCurrency(lowest.amount)} in sales</p>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-400">No data in this range yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
