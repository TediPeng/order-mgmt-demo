import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDbLite, writeDb } from "@/lib/db";
import { can, isFullAccess } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { buildBrandedCsv } from "@/lib/csv";
import { scopeAgentsForUser, computeDailyAgentStats, aggregateByPeriod, resolveDateRange, type Granularity } from "@/lib/performance";
import { agentDailyOrderStats } from "@/lib/performance-query";
import { countCompletedSessions } from "@/lib/call-sessions";
import { formatCurrency, formatDate } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await readDbLite();
  if (!can(user.role, "performance", "export", db.role_permissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const scopedAgents = scopeAgentsForUser(db, user);
  const agentFilterAllowed = isFullAccess(user.role) || user.role === "team_lead";
  const agentParam = searchParams.get("agent") || "";

  let agentIds = scopedAgents.map((a) => a.id);
  if (agentFilterAllowed && agentParam) agentIds = agentIds.filter((id) => id === agentParam);

  const range = resolveDateRange(searchParams.get("range") || undefined, searchParams.get("from") || undefined, searchParams.get("to") || undefined);
  const granularity = (searchParams.get("view") as Granularity) || "daily";

  // Sessions and sales both come from the database; the merge and every rate
  // still happen in lib/performance.ts.
  const [sessionCounts, orderStats] = await Promise.all([
    countCompletedSessions(agentIds, range.from, range.to, db.operations.min_call_seconds),
    agentDailyOrderStats(agentIds, range.from, range.to),
  ]);
  const daily = computeDailyAgentStats(db, agentIds, range.from, range.to, sessionCounts, orderStats);
  const rows = aggregateByPeriod(daily, granularity);
  const byId = new Map(db.profiles.map((p) => [p.id, p.full_name]));

  const header = ["Agent Name", "Performance Date", "Calls Made", "Order Qty", "Total Order Amount", "Conversion Rate", "AOV", "Total Hours"];
  const csvRows = rows.map((r) => [
    byId.get(r.agent_id) || "Unknown",
    formatDate(r.date),
    r.calls,
    r.orders,
    formatCurrency(r.amount),
    r.conversion_rate === null ? "—" : `${r.conversion_rate}%`,
    r.aov === null ? "—" : formatCurrency(r.aov),
    r.total_hours ?? "—",
  ]);
  const csv = buildBrandedCsv(`Agent Performance (${range.label})`, header, csvRows);

  const info = await getRequestInfo();
  logActivity(db, user.id, "REPORT_EXPORTED", "performance", null, { range: range.label, rows: rows.length }, {
    module: "performance",
    ...info,
  });
  await writeDb(db);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="agent-performance-${Date.now()}.csv"`,
    },
  });
}
