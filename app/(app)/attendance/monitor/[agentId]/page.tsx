import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Clock, Hourglass, Phone, PhoneOff } from "lucide-react";
import { readDbLite } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { todayInTz, formatTime } from "@/lib/utils";
import { displayUserName, type OrderStatus } from "@/lib/types";
import { formatCallLength, formatDuration } from "@/lib/activity-report";
import { listCallsForDay, callTotalsForDay } from "@/lib/call-sessions";
import { LEAD_STATUSES } from "@/lib/validation";
import { listBioBreaksForDay } from "@/lib/bio-breaks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { StatWidget } from "@/components/StatCard";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";

export const dynamic = "force-dynamic";

/** A gap shorter than this is the ordinary breath between two calls, not idle
 * time worth a supervisor's attention. The median call is 70 seconds and agents
 * on a good day place one every two or three minutes, so ten minutes is the
 * point where something has actually stopped. */
const GAP_SECONDS = 10 * 60;

/** `new_status` is whatever was written when the call ended, so it is a plain
 * string here. Narrowed rather than cast, so a value this build does not know
 * about is shown as text instead of being handed to a badge that has no colour
 * for it. */
function isLeadStatus(value: string): value is OrderStatus {
  return (LEAD_STATUSES as readonly string[]).includes(value);
}

interface Span {
  from: number;
  to: number;
}

/** Merges overlapping spans so the quiet stretches between them can be read off
 * directly. Calls, bio breaks and the main break all count as "busy" — a lunch
 * break is not idleness, and reporting it as a gap would bury the real ones. */
function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].filter((s) => s.to > s.from).sort((a, b) => a.from - b.from);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.from <= last.to) last.to = Math.max(last.to, s.to);
    else out.push({ ...s });
  }
  return out;
}

/**
 * One agent's day, in the detail the board has room only to summarise.
 *
 * The board answers "what is this agent doing right now". It cannot answer the
 * question that follows — why one agent placed fourteen calls in a five-hour
 * shift and another placed a hundred and five. That answer is in the shape of
 * the day: where the calls sit, and where the quiet is.
 *
 * Reached by clicking a name on the monitor. Same scope as the monitor itself,
 * so a Team Lead cannot open an agent who is not theirs by editing the URL.
 */
export default async function AgentActivityPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  const user = (await getCurrentUser())!;
  const db = await readDbLite();

  if (!can(user.role, "attendance", "view", db.role_permissions)) redirect("/dashboard");
  const isTeamLead = user.role === "team_lead";
  if (!isFullAccess(user.role) && !isTeamLead) redirect("/attendance");

  const agent = db.profiles.find((p) => p.id === agentId && !p.is_deleted);
  if (!agent || agent.role !== "agent") notFound();
  // The same rule the board applies when it decides whose rows to build,
  // repeated here because a URL is not a filtered list.
  if (isTeamLead && agent.team_lead_id !== user.id) redirect("/attendance/monitor");

  const today = todayInTz();
  const attendance = db.attendance.find((a) => a.user_id === agentId && a.work_date === today) || null;

  const [{ rows: calls }, bios, totals] = await Promise.all([
    // One page large enough to hold a full day: the heaviest agent on record
    // placed 327 calls, and this view is worthless truncated.
    listCallsForDay([agentId], today, 1, 500),
    listBioBreaksForDay(agentId, today),
    callTotalsForDay([agentId], today),
  ]);
  const dayTotals = totals.get(agentId) || { count: 0, seconds: 0, lastEndedAt: null };

  const now = Date.now();
  const timeIn = attendance?.time_in ? new Date(attendance.time_in).getTime() : null;
  const shiftEnd = attendance?.time_out ? new Date(attendance.time_out).getTime() : now;

  // Everything that counts as occupied, so what is left over is genuinely
  // nothing happening.
  const busy: Span[] = [
    ...calls.map((c) => ({
      from: new Date(c.started_at).getTime(),
      to: c.ended_at ? new Date(c.ended_at).getTime() : now,
    })),
    ...bios.map((b) => ({
      from: new Date(b.started_at).getTime(),
      to: b.ended_at ? new Date(b.ended_at).getTime() : now,
    })),
  ];
  if (attendance?.break_start) {
    busy.push({
      from: new Date(attendance.break_start).getTime(),
      to: attendance.break_end ? new Date(attendance.break_end).getTime() : now,
    });
  }

  const gaps: Span[] = [];
  if (timeIn) {
    let cursor = timeIn;
    for (const span of mergeSpans(busy)) {
      if (span.from > cursor) gaps.push({ from: cursor, to: Math.min(span.from, shiftEnd) });
      cursor = Math.max(cursor, span.to);
    }
    if (cursor < shiftEnd) gaps.push({ from: cursor, to: shiftEnd });
  }
  const notableGaps = gaps.filter((g) => (g.to - g.from) / 1000 >= GAP_SECONDS).sort((a, b) => b.to - b.from - (a.to - a.from));
  const idleSeconds = Math.round(notableGaps.reduce((sum, g) => sum + (g.to - g.from) / 1000, 0));
  const shiftSeconds = timeIn ? Math.round((shiftEnd - timeIn) / 1000) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-page-title text-slate-900">{displayUserName(agent)}</h1>
          <p className="mt-1 text-sm text-slate-500">
            Everything recorded for {today}. Times are the agent&apos;s own; the day is still running unless they have
            timed out.
          </p>
        </div>
        <Link href="/attendance/monitor" className="text-sm font-medium text-[var(--brand-primary)] hover:underline">
          ← Agent Monitor
        </Link>
      </div>

      {!attendance?.time_in ? (
        <Alert kind="info">This agent has not timed in today, so there is nothing to show yet.</Alert>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatWidget label="Shift so far" value={formatDuration(shiftSeconds)} tone="slate" icon={Clock} />
            <StatWidget label="Calls" value={String(dayTotals.count)} tone="green" icon={Phone} />
            <StatWidget label="Talk time" value={formatDuration(dayTotals.seconds)} tone="green" icon={Phone} />
            <StatWidget label={`Quiet (gaps over ${GAP_SECONDS / 60}m)`} value={formatDuration(idleSeconds)} tone="blue" icon={Hourglass} />
          </div>

          {/* The point of the page. A total tells you an agent was quiet for
              two hours; this tells you it was one unbroken stretch after
              lunch, which is a different conversation entirely. */}
          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Quiet stretches</CardTitle>
              <span className="text-xs text-slate-400">
                Time in the shift with no call, no bio break and no break — {GAP_SECONDS / 60} minutes or longer
              </span>
            </CardHeader>
            <CardContent className={notableGaps.length === 0 ? "" : "p-0"}>
              {notableGaps.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">
                  No stretch longer than {GAP_SECONDS / 60} minutes. The shift has been continuously worked.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-table">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-2">From</th>
                        <th className="px-4 py-2">To</th>
                        <th className="px-4 py-2 text-right">Length</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {notableGaps.map((g) => (
                        <tr key={g.from} className="hover:bg-slate-50">
                          <td className="whitespace-nowrap px-4 py-2 tabular-nums text-slate-700">
                            {formatTime(new Date(g.from).toISOString())}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2 tabular-nums text-slate-700">
                            {g.to >= now - 1000 ? "now" : formatTime(new Date(g.to).toISOString())}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums font-medium text-amber-700">
                            {formatDuration(Math.round((g.to - g.from) / 1000))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Every call today</CardTitle>
              <span className="text-xs text-slate-400">{calls.length} recorded, newest first</span>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-table">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Started</th>
                      <th className="px-4 py-2">Who</th>
                      <th className="px-4 py-2">Kind</th>
                      <th className="px-4 py-2 text-right">Length</th>
                      <th className="px-4 py-2">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {calls.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50">
                        <td className="whitespace-nowrap px-4 py-2 tabular-nums text-slate-700">
                          {formatTime(c.started_at)}
                        </td>
                        <td className="px-4 py-2">
                          <span className="text-slate-800">{c.customer_name || "—"}</span>
                          {c.order_id && (
                            <Link
                              href={`/leads/${c.order_id}`}
                              className="ml-2 text-xs text-[var(--brand-primary)] hover:underline"
                            >
                              {c.order_number}
                            </Link>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <Badge
                            className={
                              c.kind === "regular_customer"
                                ? "bg-purple-100 text-purple-700"
                                : "bg-slate-100 text-slate-600"
                            }
                          >
                            {c.kind === "regular_customer" ? "Regular" : "Lead"}
                          </Badge>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-slate-600">
                          {c.ended_at ? formatCallLength(c.duration_seconds ?? 0) : "on call"}
                        </td>
                        <td className="px-4 py-2">
                          {/* The outcome the agent recorded when they hung up.
                              A call ended without one says so rather than
                              showing a blank that reads as a missing record,
                              and a status this build does not know is printed
                              as it stands rather than being swallowed. */}
                          {!c.new_status ? (
                            <span className="text-xs text-slate-400">no status set</span>
                          ) : isLeadStatus(c.new_status) ? (
                            <StatusBadge status={c.new_status} />
                          ) : (
                            <span className="text-xs text-slate-600">{c.new_status}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {calls.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-400">
                          <PhoneOff className="mx-auto mb-2 h-5 w-5 text-slate-300" aria-hidden />
                          No call has been recorded for this agent today.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Attendance</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
                <Field label="Timed in" value={formatTime(attendance.time_in)} />
                <Field label="Timed out" value={attendance.time_out ? formatTime(attendance.time_out) : "—"} />
                <Field
                  label="Break"
                  value={
                    attendance.break_start
                      ? `${formatTime(attendance.break_start)} – ${attendance.break_end ? formatTime(attendance.break_end) : "ongoing"}`
                      : "not taken"
                  }
                />
                <Field label="Minutes late" value={String(attendance.minutes_late ?? 0)} />
                <Field label="Bio breaks" value={`${bios.length}`} />
                <Field
                  label="Bio break time"
                  value={formatDuration(bios.reduce((s, b) => s + (b.duration_seconds ?? 0), 0))}
                />
                <Field label="Status" value={attendance.status} />
                <Field label="Over break (min)" value={String(attendance.over_break_minutes ?? 0)} />
              </dl>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-slate-800">{value}</dd>
    </div>
  );
}
