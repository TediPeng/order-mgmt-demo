"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Phone,
  PhoneOutgoing,
  Coffee,
  Utensils,
  Hourglass,
  LogOut,
  Minus,
  Plane,
  CalendarOff,
  Ban,
  UserRound,
  Star,
  TriangleAlert,
} from "lucide-react";
import { StatWidget, type StatTone } from "@/components/StatCard";
import { formatTime } from "@/lib/utils";
import type { CallTargetInfo } from "@/lib/call-sessions";

/** How often the board pulls fresh server state.
 *
 * Ten seconds, not twenty: the states this board reports are measured in
 * seconds — a call averages under two minutes and the gap between two of them
 * is often shorter than one refresh, so at 20s the board was regularly showing
 * a state the agent had already left. Faster than the shell's own
 * 60s refresh because this is a live board — but still gated on tab visibility,
 * since a monitor left open on a spare screen would otherwise re-run the whole
 * server tree all night for nobody. */
const REFRESH_MS = 30000;

/** How often the board asks whether anything has changed.
 *
 * Two seconds, because the thing being watched is somebody pressing Calling
 * and the point is that it lands on the board while they are still saying
 * hello. This is not a re-render: it is one small hash from
 * /api/attendance/monitor-pulse, and only a hash that MOVED costs a render.
 * That is what lets the interval be this short — the full refresh above is
 * now just a safety net for anything the pulse does not fingerprint. */
const PULSE_MS = 2000;

/** How old the server's answer may get before the board stops counting on it.
 *
 * Both refreshes above stand down while the tab is in the background; the
 * one-second clock does not, because it is only `Date.now()` and knows nothing
 * about tabs. So a board left behind another window went on measuring against a
 * `sinceIso` that had stopped being true — an agent who came off standby at
 * 16:05 and worked the queue until 17:17 was still on screen as "Standby, for
 * 1:19:30". That is not a stale figure, which a supervisor would discount. It
 * is a wrong one, stated to the second, next to a call count frozen an hour
 * earlier.
 *
 * Sixty seconds is well past the two-second pulse and the ten-second refresh,
 * so a board that is being watched never trips it; only one that has stopped
 * being updated does. */
const STALE_AFTER_MS = 60000;

export type MonitorState =
  | "on_call"
  // The pause between hanging up and dialling again. Standby with a name, so
  // that Standby can go on meaning nobody is working the queue.
  | "between_calls"
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

/** The tiles, in the order they are shown — and the set a `?state=` in the URL
 * is checked against, so a hand-edited or stale link filters to something real
 * or to nothing at all, never to an empty board with no explanation. */
export const MONITOR_STATES: MonitorState[] = [
  "on_call",
  "between_calls",
  "standby",
  "bio_break",
  "break",
  "timed_out",
  "not_in",
  "on_leave",
  "rest_day",
  "suspended",
];

export interface MonitorRow {
  agentId: string;
  name: string;
  callName: string | null;
  teamLead: string | null;
  state: MonitorState;
  /** When the current state began. Null when there is nothing to count. */
  sinceIso: string | null;
  /** What the agent is calling, when state is on_call: a lead or one of their
   * own regular customers, with the order number and the person's name. Null
   * when they are not on a call. */
  call: CallTargetInfo | null;
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
  between_calls: {
    label: "Between calls",
    icon: PhoneOutgoing,
    cls: "bg-teal-50 text-teal-700",
    dot: "bg-teal-500",
    tone: "teal",
  },
  bio_break: { label: "Bio break", icon: Coffee, cls: "bg-amber-50 text-amber-700", dot: "bg-amber-500", tone: "amber" },
  break: { label: "On break", icon: Utensils, cls: "bg-orange-50 text-orange-700", dot: "bg-orange-500", tone: "brand" },
  standby: { label: "Standby", icon: Hourglass, cls: "bg-slate-100 text-slate-600", dot: "bg-slate-400", tone: "blue" },
  timed_out: { label: "Timed out", icon: LogOut, cls: "bg-slate-50 text-slate-400", dot: "bg-slate-300", tone: "slate" },
  on_leave: { label: "On leave", icon: Plane, cls: "bg-blue-50 text-blue-700", dot: "bg-blue-400", tone: "blue" },
  rest_day: { label: "Rest day", icon: CalendarOff, cls: "bg-slate-100 text-slate-500", dot: "bg-slate-300", tone: "slate" },
  suspended: { label: "Suspended", icon: Ban, cls: "bg-red-50 text-red-700", dot: "bg-red-400", tone: "maroon" },
  not_in: { label: "Not timed in", icon: Minus, cls: "bg-amber-50 text-amber-700", dot: "bg-amber-400", tone: "amber" },
};

/** What kind of call it is, said in the row rather than left to be inferred
 * from an order number. A supervisor watching the board wants to know whether
 * the floor is working fresh leads or ringing its repeat buyers, and a call
 * raised from a Regular Customer's record has no order number at all until the
 * order is written. */
const CALL_KIND_META: Record<CallTargetInfo["kind"], { label: string; icon: typeof Phone; cls: string }> = {
  lead: { label: "Lead", icon: UserRound, cls: "bg-slate-100 text-slate-600" },
  regular_customer: { label: "Regular customer", icon: Star, cls: "bg-violet-50 text-violet-700" },
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

/**
 * Where the attendance on this board came from.
 *
 * "portal-unavailable" is the one that has to be said out loud. Without
 * attendance every agent falls through to "Not timed in", which reads as an
 * empty floor rather than a missing answer — and an empty floor is something a
 * supervisor would act on.
 */
export type AttendanceSource = "roma" | "portal" | "portal-unavailable";

export function AgentMonitorBoard({
  rows,
  generatedAt,
  attendanceSource = "roma",
  live = true,
}: {
  rows: MonitorRow[];
  generatedAt: string;
  attendanceSource?: AttendanceSource;
  /**
   * Whether this is today.
   *
   * A finished day has nothing to poll and nothing to count up, and doing
   * either would be worse than useless: the pulse fingerprints TODAY's floor,
   * so on a historical board it would fire on every call an agent makes now and
   * re-render a page about last Tuesday.
   */
  live?: boolean;
}) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());

  /**
   * How far this browser's clock sits from the server's.
   *
   * Every timestamp on this board is minted by the server, and the elapsed
   * figures were being measured against `Date.now()` — the clock on whichever
   * PC happens to be showing the board. A machine five minutes fast reported
   * every agent as five minutes further into their call, and a machine five
   * minutes slow showed calls that had not started yet. Nothing on screen said
   * so; the numbers simply read wrong, and only for whoever was looking.
   *
   * `generatedAt` is the server's own clock at render, so the difference is the
   * skew. It is re-measured on every refresh, which also absorbs drift. The
   * estimate carries the request's latency with it — a fraction of a second,
   * and always in the direction of under-reporting, which is the safe way to be
   * wrong about how long somebody has been on a call.
   */
  const [skewMs, setSkewMs] = useState(0);
  useEffect(() => {
    setSkewMs(Date.now() - new Date(generatedAt).getTime());
  }, [generatedAt]);

  // One clock for the whole board rather than a timer per row.
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [router, live]);

  /**
   * Push, near enough.
   *
   * A supervisor should not have to reload to see an agent pick up, and should
   * not have to wait out a polling interval either. The pulse is a hash of the
   * open calls, open bio breaks and today's attendance stamps — the inputs the
   * server turns into states — so it moves exactly when the board would look
   * different. Only then is a render spent.
   *
   * The first answer seeds the baseline rather than triggering a refresh: the
   * page has just rendered from the same data, so treating it as a change would
   * mean every board re-rendered itself two seconds after loading.
   */
  const lastPulse = useRef<string | null>(null);
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    async function check() {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/attendance/monitor-pulse", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        const v = String(json.v || "");
        if (!v) return;
        if (lastPulse.current === null) {
          lastPulse.current = v;
          return;
        }
        if (lastPulse.current !== v) {
          lastPulse.current = v;
          router.refresh();
        }
      } catch {
        // A dropped poll is not worth surfacing: the next one is two seconds
        // away and the safety refresh is still running behind it.
      }
    }
    const id = setInterval(check, PULSE_MS);
    // Coming back to the tab should not wait out an interval either.
    document.addEventListener("visibilitychange", check);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", check);
    };
  }, [router, live]);

  /**
   * How stale the answer on screen is, in server time.
   *
   * `skewMs` already carries this browser's clock back to the server's, so the
   * difference from `generatedAt` is simply how long ago that render happened.
   */
  const generatedAtMs = new Date(generatedAt).getTime();
  const isStale = now - skewMs - generatedAtMs > STALE_AFTER_MS;

  /**
   * The current stretch, measured to now — or frozen at the last moment the
   * server could stand behind it. See STALE_AFTER_MS: counting on past that
   * point invents a number rather than reporting one.
   */
  const elapsedSince = (iso: string | null) => {
    if (!iso) return 0;
    const measuredAt = isStale ? generatedAtMs : now - skewMs;
    return Math.max(0, (measuredAt - new Date(iso).getTime()) / 1000);
  };

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.state] = (acc[r.state] || 0) + 1;
    return acc;
  }, {});

  // Which tile is in force, if any. The counts above stay whole whatever is
  // selected — a tile that zeroed the others would leave no way back.
  /**
   * Which tile is in force, kept in the URL rather than in component state.
   *
   * It was `useState`, which survives the board's own 20s refresh — that is a
   * `router.refresh()` and does not remount — but not the browser's. Somebody
   * filtered to On Call, pressed F5 out of habit or was reloaded by the
   * network, and landed on the unfiltered board with no sign that a filter had
   * ever been set. In the URL it survives a reload, the back button steps
   * through selections, and the view can be sent to somebody else.
   *
   * `replace` rather than `push` so the board does not build a history entry
   * per click, and `scroll: false` so the page does not jump to the top on a
   * board somebody has scrolled down.
   */
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const requested = searchParams.get("state");
  const filter = MONITOR_STATES.includes(requested as MonitorState) ? (requested as MonitorState) : null;

  const setFilter = (next: MonitorState | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("state", next);
    else params.delete("state");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const visible = filter ? rows.filter((r) => r.state === filter) : rows;

  return (
    <div className="space-y-4">
      {/* The portal is where people time in now. If it did not answer, every
          row below falls through to "Not timed in" — which is not what the
          floor looks like, it is what a missing answer looks like. */}
      {attendanceSource === "portal-unavailable" && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            Could not reach the portal, so there is no attendance on this board. Everyone below shows
            as not timed in whether they are or not. Calls and bio breaks are still ROMA&apos;s own and
            are correct.
          </span>
        </div>
      )}

      {/* A board that has stopped updating has to say so. Every figure below is
          still drawn, because a supervisor mid-glance needs the shape of the
          floor more than it needs to be blanked -- but the timers have stopped
          and this says which moment they stopped at. */}
      {isStale && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            This board has stopped updating. Everything below is as it stood at{" "}
            <span className="font-medium">{formatTime(generatedAt)}</span> and the timers have been held
            there — somebody shown standing by may have been on calls since. Bring this tab to the front, or
            reload.
          </span>
        </div>
      )}

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
        {MONITOR_STATES.map((s) => (
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
        <table className="w-full min-w-[1080px] text-left text-sm">
          <thead className="sticky top-0 z-20 bg-slate-50 shadow-sm text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Agent</th>
              <th className="px-4 py-3">Status</th>
              {/* Who is on the other end. The board said which order was open
                  and nothing else, which is what is being worked but not what
                  kind of work it is — and it said nothing at all for a call on
                  a regular customer, which has no order until one is written. */}
              <th className="px-4 py-3">Calling</th>
              {/* "For" is this stretch, "Standby today" is the shift's total.
                  Named apart because they read as the same thing otherwise,
                  and for an idle agent they are genuinely different numbers. */}
              <th className="px-4 py-3 text-right">For</th>
              <th className="px-4 py-3 text-right">Calls</th>
              <th className="px-4 py-3 text-right">Talk time</th>
              <th className="px-4 py-3 text-right">Standby today</th>
              <th className="px-4 py-3 text-right">Bio breaks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((r) => {
              const live = elapsedSince(r.sinceIso);
              const meta = STATE_META[r.state];
              const Icon = meta.icon;
              const CallIcon = r.call ? CALL_KIND_META[r.call.kind].icon : null;
              // Live states keep counting; everything else shows the stored total.
              //
              // Standby is the DAY's total, not the stretch running now. It was
              // briefly changed to the current stretch, which made this column
              // an exact copy of "For" for every agent standing by -- two
              // columns saying one thing, and the day's figure gone. "For"
              // answers how long they have been idle this time; this answers
              // how much of the shift has gone that way.
              const talk = r.talkSeconds + (r.state === "on_call" ? live : 0);
              const bio = r.bioSeconds + (r.state === "bio_break" ? live : 0);
              const standby = r.standbyBaseSeconds + (r.state === "standby" ? live : 0);

              return (
                <tr key={r.agentId} className={r.state === "on_call" ? "bg-green-50/40" : undefined}>
                  <td className="px-4 py-3">
                    {/* The board says what an agent is doing now; the name is
                        the way to why. A row that reads Standby for the third
                        time in an hour is a question, and it was one a
                        supervisor had no way to ask from here. */}
                    <Link
                      href={`/attendance/monitor/${r.agentId}`}
                      className="font-medium text-slate-800 hover:text-[var(--brand-primary)] hover:underline"
                      title={`See ${r.name}'s day — every call and every quiet stretch`}
                    >
                      {r.name}
                    </Link>
                    {r.callName && <span className="ml-2 text-xs text-slate-400">{r.callName}</span>}
                    {r.teamLead && <span className="block text-xs text-slate-400">{r.teamLead}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${meta.cls}`}>
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                      {meta.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {r.call ? (
                      <div className="flex flex-col gap-0.5">
                        <span
                          className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                            CALL_KIND_META[r.call.kind].cls
                          }`}
                        >
                          {CallIcon && <CallIcon className="h-3.5 w-3.5" aria-hidden />}
                          {CALL_KIND_META[r.call.kind].label}
                        </span>
                        <span className="text-xs text-slate-500">
                          {r.call.customerName || "—"}
                          {/* No order number yet means the repeat order is
                              still being written, mid-call. Said plainly, so
                              the blank does not read as a fault. */}
                          {r.call.orderNumber ? (
                            <span className="ml-1.5 font-mono text-slate-400">{r.call.orderNumber}</span>
                          ) : (
                            <span className="ml-1.5 text-slate-400">order not saved yet</span>
                          )}
                        </span>
                      </div>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
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
                <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                  {filter
                    ? live
                      ? `Nobody is ${STATE_META[filter].label.toLowerCase()} right now.`
                      : `Nobody was ${STATE_META[filter].label.toLowerCase()} on this day.`
                    : "No agents to monitor."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        Timers run live in the browser; the board updates the moment an agent starts or ends a call, and pauses while this
        {/* The floor's own time, not the viewer's. toLocaleTimeString() renders
            in whatever zone the machine is set to, so a laptop left on another
            timezone showed a stamp that disagreed with every attendance record
            on the same screen. */}
        tab is in the background. Server data as of {formatTime(generatedAt)}.
      </p>
    </div>
  );
}
