import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDbLite } from "@/lib/db";
import { can } from "@/lib/permissions";
import { scopeAgentsForUser } from "@/lib/performance";
import { buildHourlyReport, safeDay, HOURS, hourLabel } from "@/lib/hourly-report";
import { buildBrandedCsv } from "@/lib/csv";
import { todayInTz } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** The hourly report as CSV. Same rows as the page, from the same builder, and
 *  scoped the same way -- a team lead's file holds their own people only. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const db = await readDbLite();
  if (!can(user.role, "reports", "export", db.role_permissions)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const day = safeDay(searchParams.get("date") || undefined, todayInTz());

  const agents = scopeAgentsForUser(db, user);
  const report = await buildHourlyReport(agents, day);
  const withEarly = report.earlyTotal > 0;

  const header = [
    "Agent",
    ...HOURS.map(hourLabel),
    ...(withEarly ? ["pre-8am"] : []),
    "Calls",
    "Answered",
    "Sales",
    "Sales with call",
    "Amount",
  ];

  const rows: (string | number)[][] = report.rows.map((r) => [
    r.name,
    ...r.cells,
    ...(withEarly ? [r.early] : []),
    r.calls,
    r.answered,
    r.orders,
    r.ordersWithCall,
    // Plain number: the point of the column is to be summed.
    r.amount,
  ]);

  rows.push([
    "TOTAL",
    ...report.colTotals,
    ...(withEarly ? [report.earlyTotal] : []),
    report.totalCalls,
    report.totalAnswered,
    report.totalOrders,
    report.rows.reduce((n, r) => n + r.ordersWithCall, 0),
    report.totalAmount,
  ]);

  const csv = buildBrandedCsv(`Hourly Calls — ${day} (hours are dials, Manila time)`, header, rows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hourly-calls-${day}.csv"`,
    },
  });
}
