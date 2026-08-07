import Link from "next/link";
import { redirect } from "next/navigation";
import { Phone, Hourglass, Clock, Coffee, PhoneCall, Percent, Download } from "lucide-react";
import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { displayUserName } from "@/lib/types";
import { resolveDateRange } from "@/lib/performance";
import { callTotalsForRange } from "@/lib/call-sessions";
import { bioBreakTotalsForRange } from "@/lib/bio-breaks";
import { computeActivityReport, totalActivity, formatDuration } from "@/lib/activity-report";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { StatWidget } from "@/components/StatCard";
import { Button } from "@/components/ui/Button";

export const dynamic = "force-dynamic";

/**
 * The Agent Monitor's historical counterpart: the same shift, talk, break and
 * standby figures, summed over a date range instead of ticking live.
 *
 * Gated exactly like the monitor — supervisory, so full access or a Team Lead
 * over their own agents, not an agent holding attendance.view for their own
 * record.
 */
export default async function AgentActivityReportPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDb();

  if (!can(user.role, "attendance", "view", db.role_permissions)) redirect("/dashboard");
  const isTeamLead = user.role === "team_lead";
  if (!isFullAccess(user.role) && !isTeamLead) redirect("/attendance");

  const range = resolveDateRange(sp.range || "this_month", sp.from, sp.to);
  const canExport = can(user.role, "attendance", "export", db.role_permissions);

  // The export carries the resolved range rather than the raw params, so the
  // file matches exactly what is on screen — including when the preset was
  // left at its default and never appeared in the URL at all.
  const exportHref = `/api/attendance/activity-export?from=${range.from}&to=${range.to}`;

  const agents = db.profiles
    .filter((p) => !p.is_deleted && p.role === "agent")
    .filter((p) => (isTeamLead ? p.team_lead_id === user.id : true))
    .map((p) => ({ id: p.id, name: displayUserName(p) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const agentIds = agents.map((a) => a.id);
  const [callTotals, bioTotals] = await Promise.all([
    callTotalsForRange(agentIds, range.from, range.to),
    bioBreakTotalsForRange(agentIds, range.from, range.to),
  ]);

  const rows = computeActivityReport(db, agents, range.from, range.to, callTotals, bioTotals);
  const totals = totalActivity(rows);

  // Busiest first — the point of the report is comparison, and alphabetical
  // ordering buries whoever you were looking for.
  const ranked = [...rows].sort((a, b) => b.shiftSeconds - a.shiftSeconds || a.name.localeCompare(b.name));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-page-title text-slate-900">Agent Activity Report</h1>
          <p className="text-sm text-slate-500">
            {isTeamLead ? "Your agents" : "All agents"} from {range.from} to {range.to}. Standby is shift time that is
            not a call and not a break.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/attendance/monitor" className="text-xs font-medium text-[var(--brand-primary)] hover:underline">
            Live monitor
          </Link>
          {canExport && (
            <a href={exportHref}>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4" /> Export CSV
              </Button>
            </a>
          )}
        </div>
      </div>

      <DateRangeFilter defaultPreset="this_month" />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <StatWidget label="Shift Time" value={formatDuration(totals.shiftSeconds)} tone="slate" icon={Clock} />
        <StatWidget label="Talk Time" value={formatDuration(totals.talkSeconds)} tone="green" icon={Phone} />
        <StatWidget label="Standby" value={formatDuration(totals.standbySeconds)} tone="blue" icon={Hourglass} />
        <StatWidget
          label="Breaks"
          value={formatDuration(totals.breakSeconds + totals.bioSeconds)}
          tone="brand"
          icon={Coffee}
        />
        <StatWidget label="Calls" value={totals.calls} tone="maroon" icon={PhoneCall} />
        <StatWidget
          label="Utilisation"
          value={totals.utilisation === null ? "—" : `${totals.utilisation}%`}
          tone="amber"
          icon={Percent}
        />
      </div>

      {totals.openShifts > 0 && (
        <p className="text-xs text-slate-500">
          {totals.openShifts} shift{totals.openShifts === 1 ? "" : "s"} in this range {totals.openShifts === 1 ? "is" : "are"}{" "}
          still open and {totals.openShifts === 1 ? "is" : "are"} excluded — a shift contributes once it is timed out.
          Use the live monitor for what is happening now.
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr className="whitespace-nowrap">
              <th className="sticky left-0 z-10 bg-slate-50 px-4 py-2">Agent</th>
              <th className="px-3 py-2 text-right">Days</th>
              <th className="px-3 py-2 text-right">Shift</th>
              <th className="px-3 py-2 text-right">Talk</th>
              <th className="px-3 py-2 text-right">Calls</th>
              <th className="px-3 py-2 text-right">Standby</th>
              <th className="px-3 py-2 text-right">Breaks</th>
              <th className="px-3 py-2 text-right">Late</th>
              <th className="px-3 py-2 text-right">Over Break</th>
              <th className="px-3 py-2 text-right">Utilisation</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ranked.map((r) => (
              <tr key={r.agent_id} className="whitespace-nowrap">
                <td className="sticky left-0 z-10 bg-white px-4 py-2 font-medium text-slate-800">{r.name}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{r.days}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{formatDuration(r.shiftSeconds)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{formatDuration(r.talkSeconds)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{r.calls}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{formatDuration(r.standbySeconds)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                  {formatDuration(r.breakSeconds + r.bioSeconds)}
                  {r.bioCount > 0 && <span className="ml-1 text-xs text-slate-400">({r.bioCount} bio)</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                  {r.lateMinutes > 0 ? `${r.lateMinutes}m` : "—"}
                </td>
                {/* Over-break is a discipline figure, not a volume one — any
                    minutes at all are the point, so it is coloured rather than
                    left to be spotted in a column of numbers. */}
                <td
                  className={`px-3 py-2 text-right tabular-nums ${
                    r.overBreakMinutes > 0 ? "font-medium text-red-700" : "text-slate-600"
                  }`}
                >
                  {r.overBreakMinutes > 0 ? `${r.overBreakMinutes}m` : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-800">
                  {r.utilisation === null ? "—" : `${r.utilisation}%`}
                </td>
              </tr>
            ))}
            {ranked.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-sm text-slate-400">
                  No agents in scope.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
