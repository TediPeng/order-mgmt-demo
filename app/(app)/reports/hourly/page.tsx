import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { readDbLite } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeAgentsForUser } from "@/lib/performance";
import { buildHourlyReport, safeDay, HOURS, hourLabel } from "@/lib/hourly-report";
import { todayInTz, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";

export const dynamic = "force-dynamic";

export default async function HourlyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDbLite();
  if (!can(user.role, "reports", "view", db.role_permissions)) redirect("/dashboard");

  const day = safeDay(sp.date, todayInTz());
  // The Performance page's own helper: a team lead sees their people and nobody
  // else's. A new page that forgot this would hand them figures the rest of the
  // app refuses them.
  const agents = scopeAgentsForUser(db, user);
  const report = await buildHourlyReport(agents, day);

  const canExport = can(user.role, "reports", "export", db.role_permissions);
  const exportHref = `/api/reports/hourly/export?date=${encodeURIComponent(day)}`;
  const num = new Intl.NumberFormat("en-PH");

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-page-title text-slate-900">Hourly Calls — per agent</h1>
        {canExport && (
          <a href={exportHref}>
            <Button variant="outline">
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          </a>
        )}
      </div>

      <p className="mb-4 text-xs text-slate-500">
        Hours count <strong>dials</strong>, taken from the moment the number was called. Sales for the day sit on the
        right. <strong>w/ call</strong> is how many of those sales can be matched to a dial the same agent made that
        day — a match on phone number, not a stored link, so the rest are not missing sales, only unmatched ones.
      </p>

      <form className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="date">
            Date
          </label>
          <Input id="date" name="date" type="date" defaultValue={day} />
        </div>
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>

      {agents.length === 0 ? (
        <Alert kind="info">There are no agents in your scope to report on.</Alert>
      ) : report.totalCalls === 0 && report.totalOrders === 0 ? (
        <Alert kind="info">No calls or sales recorded on {day}.</Alert>
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[1300px] text-left text-sm">
            <thead className="sticky top-0 z-20 bg-slate-50 text-xs uppercase text-slate-500 shadow-sm">
              <tr>
                <th className="sticky left-0 z-30 bg-slate-50 px-3 py-3">Agent</th>
                {HOURS.map((h) => (
                  <th key={h} className="px-2 py-3 text-right font-medium">
                    {hourLabel(h)}
                  </th>
                ))}
                {report.earlyTotal > 0 && <th className="px-2 py-3 text-right font-medium">pre-8am</th>}
                <th className="border-l border-slate-200 px-3 py-3 text-right">Calls</th>
                <th className="px-3 py-3 text-right">Answered</th>
                <th className="border-l border-slate-200 px-3 py-3 text-right">Sales</th>
                <th className="px-3 py-3 text-right">w/ call</th>
                <th className="px-3 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {report.rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-slate-900">{r.name}</td>
                  {r.cells.map((c, i) => (
                    <td
                      key={i}
                      className={
                        c > 0 ? "px-2 py-2 text-right text-slate-900" : "px-2 py-2 text-right text-slate-300"
                      }
                    >
                      {c > 0 ? c : "·"}
                    </td>
                  ))}
                  {report.earlyTotal > 0 && (
                    <td
                      className={
                        r.early > 0 ? "px-2 py-2 text-right text-amber-700" : "px-2 py-2 text-right text-slate-300"
                      }
                    >
                      {r.early > 0 ? r.early : "·"}
                    </td>
                  )}
                  <td className="border-l border-slate-200 px-3 py-2 text-right font-medium">{num.format(r.calls)}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{num.format(r.answered)}</td>
                  <td className="border-l border-slate-200 px-3 py-2 text-right font-medium">{r.orders || "·"}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{r.orders ? r.ordersWithCall : "·"}</td>
                  <td className="px-3 py-2 text-right">{r.amount ? formatCurrency(r.amount) : "·"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 bg-slate-50 text-sm font-semibold text-slate-900 shadow-[0_-1px_0_rgba(0,0,0,0.06)]">
              <tr>
                <td className="sticky left-0 z-10 bg-slate-50 px-3 py-3">TOTAL</td>
                {report.colTotals.map((c, i) => (
                  <td key={i} className={c > 0 ? "px-2 py-3 text-right" : "px-2 py-3 text-right text-slate-300"}>
                    {c > 0 ? c : "·"}
                  </td>
                ))}
                {report.earlyTotal > 0 && <td className="px-2 py-3 text-right">{report.earlyTotal}</td>}
                <td className="border-l border-slate-200 px-3 py-3 text-right">{num.format(report.totalCalls)}</td>
                <td className="px-3 py-3 text-right">{num.format(report.totalAnswered)}</td>
                <td className="border-l border-slate-200 px-3 py-3 text-right">{report.totalOrders}</td>
                <td className="px-3 py-3 text-right">
                  {report.rows.reduce((n, r) => n + r.ordersWithCall, 0)}
                </td>
                <td className="px-3 py-3 text-right">{formatCurrency(report.totalAmount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
