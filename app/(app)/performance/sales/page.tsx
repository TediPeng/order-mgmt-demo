import { redirect } from "next/navigation";
import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeAgentsForUser, computeDailyAgentStats, resolveDateRange } from "@/lib/performance";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { SalesChartClient } from "@/components/SalesChartClient";

export default async function SalesMonitoringPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = readDb();

  if (!can(user.role, "performance", "view", db.role_permissions)) redirect("/dashboard");

  const scopedAgents = scopeAgentsForUser(db, user);
  const agentIds = scopedAgents.map((a) => a.id);
  const range = resolveDateRange(sp.range || "this_month", sp.from, sp.to);
  const daily = computeDailyAgentStats(db, agentIds, range.from, range.to);
  const agents = scopedAgents.map((a) => ({ id: a.id, name: a.full_name }));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Daily Sales Monitoring</h1>
      <DateRangeFilter defaultPreset="this_month" />
      <SalesChartClient dailyData={daily} agents={agents} />
    </div>
  );
}
