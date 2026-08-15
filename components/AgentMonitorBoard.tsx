"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Phone, Coffee, Utensils, Hourglass, LogOut, Minus, Plane, CalendarOff, Ban } from "lucide-react";
import { StatWidget, type StatTone } from "@/components/StatCard";

/** How often the board pulls fresh server state. Faster than the shell's own
 * 60s refresh because this is a live board — but still gated on tab visibility,
 * since a monitor left open on a spare screen would otherwise re-run the whole
 * server tree all night for nobody. */
const REFRESH_MS = 20000;

export type MonitorState =
  | "on_call"
  | "bio_break"
  | "break"
  | "standby"
  | "timed_out"
  // Why somebody is not on the clock, rather than only that they are not.
  // "Not timed in" reads as a problem, and for an agent on approved leave or a
  // rostered rest day it is not one — the supervisor scanning this board had to
  // go and look up which it was.
  | "on_leave"
  | "rest_day"
  | "suspended"
  | "not_in";

export interface MonitorRow {
  agentId: string;
  name: string;
  callName: string | null;
  teamLead: string | null;
  state: MonitorState;
  /** When the current state began. Null when there is nothing to count. */
  sinceIso: string | null;
  /** Order the agent is on, when state is on_call. */
  orderNumber: string | null;
  calls: number;
  /** Completed talk time today, seconds. The live call is added client-side. */
  talkSeconds: number;
  bioCount: number;
  /** Completed bio break time today, seconds. The live one is added client-side. */
  bioSeconds: number;
  /** Seconds already accounted for as standby before the current state began. */
  standbyBaseSeconds: number;
}

/** `cls`/`dot` still dress the per-row badge in the table; `tone` is the same
 * state expressed in the dashboards' widget palette, so a state carries one
 * colour whether you meet it as a tile up top or a badge in the row. */
const STATE_META: Record<
  MonitorState,
  { label: string; icon: typeof Phone; cls: string; dot: string; tone: StatTone }
> = {
  on_call: { label: "On call", icon: Phone, cls: "bg-green-50 text-green-700", dot: "bg-green-500", tone: "green" },
  bio_break: { label: "Bio break", icon: Coffee, cls: "bg-amber-50 text-amber-700", dot: "bg-amber-500", tone: "amber" },
  break: { label: "On break", icon: Utensils, cls: "bg-orange-50 text-orange-700", dot: "bg-orange-500", tone: "brand" },
  standby: { label: "Standby", icon: Hourglass, cls: "bg-slate-100 text-slate-600", dot: "bg-slate-400", tone: "blue" },
  timed_out: { label: "Timed out", icon: LogOut, cls: "bg-slate-50 text-slate-400", dot: "bg-slate-300", tone: "slate" },
  on_leave: { label: "On leave", icon: Plane, cls: "bg-blue-50 text-blue-700", dot: "bg-blue-400", tone: "blue" },
  rest_day: { label: "Rest day", icon: CalendarOff, cls: "bg-slate-100 text-slate-500", dot: "bg-slate-300", tone: "slate" },
  suspended: { label: "Suspended", icon: Ban, cls: "bg-red-50 text-red-700", dot: "bg-red-400", tone: "maroon" },
  not_in: { label: "Not timed in", icon: Minus, cls: "bg-amber-50 text-amber-700", dot: "bg-amber-400", tone: "amber" },
};

function hms(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function AgentMonitorBoard({ rows, generatedAt }: { rows: MonitorRow[]; generatedAt: string }) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());

  // One clock for the whole board rather than a timer per row.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return;
      router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);

  const elapsedSince = (iso: string | null) => (iso ? Math.max(0, (now - new Date(iso).getTime()) / 1000) : 0);

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.state] = (acc[r.state] || 0) + 1;
    return acc;
  }, {});

  // Which tile is in force, if any. The counts above stay whole whatever is
  // selected — a tile that zeroed the others would leave no way back.
  const [filter, setFilter] = useState<MonitorState | null>(null);
  const visible = filter ? rows.filter((r) => r.state === filter) : rows;

  return (
    <div className="space-y-4">
      {/* Same counts these were always showing, as the dashboards' widget
          tiles rather than chips, so the reporting surface reads as one thing.
          Derived from `rows` here in the client rather than passed down from
          the server, so they move with the 20s refresh and the live clock
          instead of going stale between polls. */}
      {/* Each tile filters the board to its own state. "Three on call" is a
          number you immediately want the names behind, and reading them off a
          twenty-row table by badge colour is the slow way to get them. Clicking
          the tile again clears it. Filtering lives in client state rather than
          the URL because the board reloads itself every twenty seconds, and a
          filter that survives that is the whole point. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {(["on_call", "standby", "bio_break", "break", "timed_out", "not_in", "on_leave", "rest_day", "suspended"] as MonitorState[]).map((s) => (
          <StatWidget
            key={s}
            label={STATE_META[s].label}
            value={counts[s] || 0}
            tone={STATE_META[s].tone}
            icon={STATE_META[s].icon}
            selected={filter === s}
            onClick={() => setFilter(filter === s ? null : s)}
          />
        ))}
      </div>

      {filter && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <span>
            Showing <span className="font-medium text-slate-800">{visible.length}</span> of {rows.length} agent
            {rows.length === 1 ? "" : "s"} — {STATE_META[filter].label.toLowerCase()}.
          </span>
          <button
            type="button"
            onClick={() => setFilter(null)}
            className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Show all
          </button>
        </div>
      )}

      <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="sticky top-0 z-20 bg-slate-50 shadow-sm text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Agent</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">For</th>
              <th className="px-4 py-3 text-right">Calls</th>
              <th className="px-4 py-3 text-right">Talk time</th>
              <th className="px-4 py-3 text-right">Standby</th>
              <th className="px-4 py-3 text-right">Bio breaks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((r) => {
              const live = elapsedSince(r.sinceIso);
              const meta = STATE_META[r.state];
              const Icon = meta.icon;
              // Live states keep counting; everything else shows the stored total.
              const talk = r.talkSeconds + (r.state === "on_call" ? live : 0);
              const bio = r.bioSeconds + (r.state === "bio_break" ? live : 0);
              const standby = r.standbyBaseSeconds + (r.state === "standby" ? live : 0);

              return (
                <tr key={r.agentId} className={r.state === "on_call" ? "bg-green-50/40" : undefined}>
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-800">{r.name}</span>
                    {r.callName && <span className="ml-2 text-xs text-slate-400">{r.callName}</span>}
                    {r.teamLead && <span className="block text-xs text-slate-400">{r.teamLead}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${meta.cls}`}>
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                      {meta.label}
                    </span>
                    {r.orderNumber && <span className="ml-2 font-mono text-xs text-slate-500">{r.orderNumber}</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-600">
                    {r.sinceIso ? hms(live) : "—"}
                  </td>
                  {/* The count is the question; the numbers behind it are the
                      answer. No date on the link — the board is today's. */}
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {r.calls > 0 ? (
                      <Link
                        href={`/calls?agent=${r.agentId}`}
                        className="font-medium text-[var(--brand-primary)] hover:underline"
                        title={`See the numbers ${r.name} called today`}
                      >
                        {r.calls}
                      </Link>
                    ) : (
                      r.calls
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">{hms(talk)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">{hms(standby)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {r.bioCount}
                    <span className="ml-2 font-mono text-xs text-slate-400">{hms(bio)}</span>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                  {filter ? `Nobody is ${STATE_META[filter].label.toLowerCase()} right now.` : "No agents to monitor."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        Timers run live in the browser; figures refresh from the server every {REFRESH_MS / 1000}s, and pause while this
        tab is in the background. Server data as of {new Date(generatedAt).toLocaleTimeString()}.
      </p>
    </div>
  );
}
