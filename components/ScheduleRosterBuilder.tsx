"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { cutoffFor, shiftCutoff, datesIn, shortDate, weekdayOf, isWeekend, addDays, type Cutoff } from "@/lib/cutoff";
import { cn } from "@/lib/utils";
import { DUTY_STATUSES, STATUS_STYLE, STATUS_LABEL, statusOf, type CellStatus } from "@/lib/duty-status";
import type { AgentOption } from "@/components/ScheduleEventModal";
import { RosterHeadsUp } from "@/components/RosterHeadsUp";

type State = CellStatus;

/** A suspension, flattened to what a cell needs to know. */
export interface SuspensionSpan {
  employee_id: string;
  /** YYYY-MM-DD, inclusive at both ends. */
  start_date: string;
  end_date: string;
  reason: string;
}

/** An approved leave request, flattened the same way. */
export interface ApprovedLeaveSpan {
  agent_id: string;
  leave_start: string;
  leave_end: string;
  leave_type: string;
}

/** The statuses that put somebody on the floor — what an approved leave day
 * must not quietly become. */
const WORKING: State[] = ["ON DUTY", "HALF DAY", "TRAINING"];

interface ScheduleEvent {
  extendedProps?: {
    agent_id?: string;
    status?: string;
    is_rest_day?: boolean;
    schedule_date?: string;
    suspension_id?: string | null;
  };
}

/** "Aug 22" for a single day, "Aug 22 – 25" for a stretch, clamped to the
 * period on screen so a month-long suspension does not read as one. */
function spanLabel(from: string, to: string, cutoff: Cutoff): string {
  const a = from < cutoff.start ? cutoff.start : from;
  const b = to > cutoff.end ? cutoff.end : to;
  return a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}`;
}

/**
 * Building a whole cut-off in one pass, starting from whatever is already there.
 *
 * The difference from the roster grid is when it writes. That one saves a cell
 * the moment it changes, which is right for a correction — somebody swapped a
 * rest day this morning. This one loads the fortnight, lets it be reworked as a
 * whole, and writes once, which is right for setting a period that does not
 * exist yet. It is also the shape the spreadsheet had, and setting a roster is
 * the job that drove people back to the spreadsheet.
 *
 * Two things are stated before a single cell is touched, because they decide the
 * roster rather than follow from it: who is suspended, and who has leave already
 * approved. Both used to be invisible here. A suspension only appeared if a
 * schedule row happened to exist carrying its id — and a suspension is usually
 * raised over days nobody has rostered yet, so the ordinary case was a blank row
 * somebody then filled in with ON DUTY. Approved leave was not read at all: it
 * is written to attendance on approval and never to the roster, so the one
 * screen where the clash could still be avoided was the one screen that could
 * not see it, and the scheduler found out on the day from the agent who was not
 * there.
 *
 * Only what changed is sent. A cut-off is three hundred cells and the agent
 * usually rewrites a dozen; posting all of them would rewrite rows nobody
 * touched and bury the real change in the audit log.
 */
export function ScheduleRosterBuilder({
  agents,
  suspensions = [],
  approvedLeave = [],
}: {
  agents: AgentOption[];
  suspensions?: SuspensionSpan[];
  approvedLeave?: ApprovedLeaveSpan[];
}) {
  const router = useRouter();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [cutoff, setCutoff] = useState<Cutoff>(() => cutoffFor(today));
  const [loaded, setLoaded] = useState<Record<string, State>>({});
  const [cells, setCells] = useState<Record<string, State>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ created: number; skippedConflict: number; skippedSuspended: number } | null>(null);

  const dates = useMemo(() => datesIn(cutoff), [cutoff]);
  const nameById = useMemo(() => new Map(agents.map((a) => [a.id, a.full_name])), [agents]);
  const onRoster = useMemo(() => new Set(agents.map((a) => a.id)), [agents]);

  /**
   * The suspended days of this cut-off, taken from the suspensions themselves.
   *
   * Deliberately not from the loaded schedule rows: a suspension is the reason
   * there is no row to load. The disciplinary module owns these days, this
   * screen only reports them, and nothing here can write one.
   */
  const suspendedDays = useMemo(() => {
    const found = new Map<string, SuspensionSpan>();
    for (const s of suspensions) {
      if (!onRoster.has(s.employee_id)) continue;
      for (const d of dates) {
        if (d >= s.start_date && d <= s.end_date) found.set(`${s.employee_id}|${d}`, s);
      }
    }
    return found;
  }, [suspensions, dates, onRoster]);

  /** The same for approved leave. Unlike a suspension this is not a lock — a
   * Team Lead may still have a reason to roster the day — but it is said before
   * the cell is filled rather than after. */
  const leaveDays = useMemo(() => {
    const found = new Map<string, ApprovedLeaveSpan>();
    for (const l of approvedLeave) {
      if (!onRoster.has(l.agent_id)) continue;
      for (const d of dates) {
        if (d >= l.leave_start && d <= l.leave_end) found.set(`${l.agent_id}|${d}`, l);
      }
    }
    return found;
  }, [approvedLeave, dates, onRoster]);

  /** What a cell reads as: a suspension outranks anything the roster holds. */
  const stateAt = useCallback(
    (key: string): State => (suspendedDays.has(key) ? "SUSPENDED" : cells[key] ?? "NONE"),
    [cells, suspendedDays]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDone(null);
    try {
      // `end` is exclusive on this route.
      const params = new URLSearchParams({ start: cutoff.start, end: addDays(cutoff.end, 1) });
      const res = await fetch(`/api/schedule?${params.toString()}`);
      const events: ScheduleEvent[] = res.ok ? await res.json() : [];
      const next: Record<string, State> = {};
      for (const e of events) {
        const p = e.extendedProps || {};
        if (!p.agent_id || !p.schedule_date) continue;
        next[`${p.agent_id}|${p.schedule_date}`] = statusOf(p);
      }
      setLoaded(next);

      /**
       * Approved leave fills itself in, on any day the roster has not spoken
       * for.
       *
       * It goes into `cells` and not into `loaded`, and that difference is the
       * whole point: `loaded` is what the database holds, `cells` is what the
       * screen proposes. So these arrive already marked, already counted in
       * "Save N changes", and one press writes them — instead of a scheduler
       * being told about the leave and then having to type it in themselves,
       * fifteen cells at a time.
       *
       * Never over a day that already says something. That entry is somebody's
       * decision, including the decision to roster work over approved leave,
       * and it keeps its amber mark rather than being quietly corrected here.
       */
      const withLeave = { ...next };
      for (const l of approvedLeave) {
        if (!onRoster.has(l.agent_id)) continue;
        for (const d of dates) {
          if (d < l.leave_start || d > l.leave_end) continue;
          const key = `${l.agent_id}|${d}`;
          if (!withLeave[key]) withLeave[key] = "ON LEAVE";
        }
      }
      setCells(withLeave);
    } catch {
      setError("Could not read the current roster for this cut-off.");
    } finally {
      setLoading(false);
    }
  }, [cutoff, approvedLeave, dates, onRoster]);

  useEffect(() => {
    load();
  }, [load]);

  const changed = Object.entries(cells).filter(
    ([key, value]) =>
      value !== "SUSPENDED" && value !== "NONE" && !suspendedDays.has(key) && (loaded[key] ?? "NONE") !== value
  );

  /** Approved leave days this roster currently puts on the floor. */
  const conflicts = useMemo(
    () =>
      Array.from(leaveDays.keys()).filter((key) => !suspendedDays.has(key) && WORKING.includes(cells[key] ?? "NONE")),
    [leaveDays, suspendedDays, cells]
  );

  /** Approved leave days the roster has not been told about yet — blank, or
   * marked as an ordinary rest day rather than as leave. */
  const unmarkedLeave = useMemo(
    () => Array.from(leaveDays.keys()).filter((key) => !suspendedDays.has(key) && (cells[key] ?? "NONE") !== "ON LEAVE"),
    [leaveDays, suspendedDays, cells]
  );

  /** Who is suspended and who is on approved leave in this cut-off, one entry
   * per person per stretch — the answer to "who can I not roster this
   * fortnight", above the grid rather than spread through three hundred
   * cells. */
  const suspendedPeople = useMemo(() => {
    const seen = new Map<string, { name: string; span: SuspensionSpan }>();
    for (const s of suspendedDays.values()) {
      const key = `${s.employee_id}|${s.start_date}`;
      if (!seen.has(key)) seen.set(key, { name: nameById.get(s.employee_id) || "Unknown", span: s });
    }
    return Array.from(seen.values());
  }, [suspendedDays, nameById]);

  const leavePeople = useMemo(() => {
    const seen = new Map<string, { name: string; span: ApprovedLeaveSpan }>();
    for (const l of leaveDays.values()) {
      const key = `${l.agent_id}|${l.leave_start}|${l.leave_end}`;
      if (!seen.has(key)) seen.set(key, { name: nameById.get(l.agent_id) || "Unknown", span: l });
    }
    return Array.from(seen.values());
  }, [leaveDays, nameById]);

  function setCell(agentId: string, date: string, value: State) {
    const key = `${agentId}|${date}`;
    if (suspendedDays.has(key) || (cells[key] ?? "NONE") === "SUSPENDED") return;
    setCells((c) => ({ ...c, [key]: value }));
  }

  /**
   * Paint a row, a column or the whole cut-off.
   *
   * A suspended day is skipped — nothing here may set one. An approved leave day
   * takes ON LEAVE instead of the value being painted, so "All ON DUTY" cannot
   * silently roster somebody whose leave is already signed off. Painting OFF or
   * ON LEAVE over one lands as ON LEAVE either way, which is the more specific
   * of the two.
   */
  function fill(value: State, agentId?: string, date?: string) {
    setCells((c) => {
      const next = { ...c };
      for (const a of agents) {
        if (agentId && a.id !== agentId) continue;
        for (const d of dates) {
          if (date && d !== date) continue;
          const key = `${a.id}|${d}`;
          if (suspendedDays.has(key) || (next[key] ?? "NONE") === "SUSPENDED") continue;
          next[key] = leaveDays.has(key) ? "ON LEAVE" : value;
        }
      }
      return next;
    });
  }

  /** Write every approved leave day into the roster as ON LEAVE in one go. */
  function applyApprovedLeave() {
    setCells((c) => {
      const next = { ...c };
      for (const key of leaveDays.keys()) {
        if (suspendedDays.has(key)) continue;
        next[key] = "ON LEAVE";
      }
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const entries = changed.map(([key, value]) => {
        const [agent_id, schedule_date] = key.split("|");
        return { agent_id, schedule_date, duty_status: value };
      });
      const res = await fetch("/api/schedule/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "matrix",
          agent_ids: Array.from(new Set(entries.map((e) => e.agent_id))),
          entries,
          // This screen is for setting a period, so an existing day on one of
          // the cells being written is the thing being changed, not a clash.
          confirm_replace: true,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error || "Could not save the roster.");
        setSaving(false);
        return;
      }
      setDone(json.summary);
      setLoaded(cells);
      router.refresh();
    } catch {
      setError("Network error. Nothing was saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && <Alert kind="error">{error}</Alert>}
      {done && (
        <Alert kind="success">
          Saved {done.created} day{done.created === 1 ? "" : "s"}
          {done.skippedSuspended > 0 ? `, skipped ${done.skippedSuspended} on suspension` : ""}.
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setCutoff(shiftCutoff(cutoff, -1))}>
          ← {shiftCutoff(cutoff, -1).shortLabel}
        </Button>
        <span className="text-sm font-semibold text-slate-900">{cutoff.label}</span>
        <Button type="button" variant="outline" size="sm" onClick={() => setCutoff(shiftCutoff(cutoff, 1))}>
          {shiftCutoff(cutoff, 1).shortLabel} →
        </Button>
        <span className="mx-2 h-4 w-px bg-slate-200" />
        <Button type="button" variant="outline" size="sm" onClick={() => fill("ON DUTY")}>
          All ON DUTY
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => fill("OFF")}>
          All OFF
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setCells(loaded)}>
          Reset
        </Button>
      </div>

      {/* Same panel the roster page shows, so the two screens read as one
          feature. This one can also offer to write the leave days in; the
          roster page has nothing to offer, so it passes no action. */}
      <RosterHeadsUp
        periodLabel={cutoff.shortLabel}
        suspended={suspendedPeople.map(({ name, span }) => ({
          key: `${span.employee_id}|${span.start_date}`,
          name,
          span: spanLabel(span.start_date, span.end_date, cutoff),
          title: `Suspension: ${span.reason}`,
        }))}
        leave={leavePeople.map(({ name, span }) => ({
          key: `${span.agent_id}|${span.leave_start}|${span.leave_end}`,
          name,
          span: spanLabel(span.leave_start, span.leave_end, cutoff),
          title: `${span.leave_type} leave, approved`,
        }))}
        action={
          unmarkedLeave.length > 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={applyApprovedLeave}>
              Mark {unmarkedLeave.length} day{unmarkedLeave.length === 1 ? "" : "s"} ON LEAVE
            </Button>
          ) : undefined
        }
      />

      {/* Not a blocker: leave is approved by a Team Lead and the roster may
          still have a reason to override it. It just may not happen by
          accident. */}
      {conflicts.length > 0 && (
        <Alert kind="warning">
          {conflicts.length} day{conflicts.length === 1 ? " is" : "s are"} rostered as working over approved leave —{" "}
          {Array.from(new Set(conflicts.map((k) => nameById.get(k.split("|")[0]) || "Unknown"))).join(", ")}. Those
          cells carry an amber dot.
        </Alert>
      )}

      <div className="overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 min-w-[12rem] border-b border-r border-slate-200 bg-slate-100 px-3 py-2 text-left font-semibold uppercase tracking-wide text-slate-600">
                Full name
              </th>
              {dates.map((d) => (
                <th
                  key={d}
                  onClick={() => fill("ON DUTY", undefined, d)}
                  title="Set this day for everyone"
                  className={cn(
                    "sticky top-0 z-20 min-w-[4.75rem] cursor-pointer border-b border-r border-slate-200 px-1 py-2 text-center font-semibold hover:bg-slate-300",
                    d === today ? "bg-amber-100 text-amber-900" : isWeekend(d) ? "bg-slate-200 text-slate-600" : "bg-slate-100 text-slate-600"
                  )}
                >
                  <div className="whitespace-nowrap">{shortDate(d)}</div>
                  <div className="text-[10px] font-normal uppercase opacity-70">{weekdayOf(d)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => {
              // Per-agent counts, so the name says what the row is going to say
              // before it is read across thirty columns.
              const suspendedCount = dates.filter((d) => suspendedDays.has(`${a.id}|${d}`)).length;
              const leaveCount = dates.filter((d) => leaveDays.has(`${a.id}|${d}`)).length;
              return (
                <tr key={a.id}>
                  <th
                    scope="row"
                    onClick={() => fill("ON DUTY", a.id)}
                    title="Set this agent's whole cut-off"
                    className={cn(
                      "sticky left-0 z-10 cursor-pointer border-b border-r border-slate-200 px-3 py-1.5 text-left font-medium text-slate-800",
                      suspendedCount > 0 ? "bg-slate-200 hover:bg-slate-300" : "bg-yellow-50 hover:bg-yellow-100"
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="block truncate">{a.full_name}</span>
                      {suspendedCount > 0 && (
                        <span
                          title={`Suspended ${suspendedCount} day${suspendedCount === 1 ? "" : "s"} this cut-off`}
                          className="shrink-0 rounded-full bg-slate-800 px-1.5 py-px text-[10px] font-semibold text-white"
                        >
                          SUSP {suspendedCount}
                        </span>
                      )}
                      {leaveCount > 0 && (
                        <span
                          title={`${leaveCount} day${leaveCount === 1 ? "" : "s"} of approved leave this cut-off`}
                          className="shrink-0 rounded-full bg-blue-100 px-1.5 py-px text-[10px] font-semibold text-blue-800"
                        >
                          LEAVE {leaveCount}
                        </span>
                      )}
                    </span>
                  </th>
                  {dates.map((d) => {
                    const key = `${a.id}|${d}`;
                    const state = stateAt(key);
                    const suspension = suspendedDays.get(key);
                    const isChanged = state !== "SUSPENDED" && (loaded[key] ?? "NONE") !== state;
                    const leave = leaveDays.get(key);
                    const conflicting = !!leave && WORKING.includes(state);
                    return (
                      <td key={d} className="relative border-b border-r border-slate-200 p-0">
                        {state === "SUSPENDED" ? (
                          // Not a disabled <select>: SUSPENDED is deliberately
                          // absent from the options, so a select holding it draws
                          // an empty box — the fill arrived and the word did not,
                          // which reads as a cell nobody has set rather than one
                          // that cannot be. Same locked div ScheduleGrid renders.
                          <div
                            className={cn(
                              "flex h-8 items-center justify-center px-1 text-[10px] font-semibold tracking-wide",
                              STATUS_STYLE.SUSPENDED
                            )}
                            title={
                              suspension
                                ? `Suspended ${spanLabel(suspension.start_date, suspension.end_date, cutoff)} — ${
                                    suspension.reason
                                  }. Lift it from Disciplinary.`
                                : "Set by a suspension — lift it from Disciplinary"
                            }
                          >
                            {STATUS_LABEL.SUSPENDED}
                          </div>
                        ) : (
                          <>
                            <select
                              value={state}
                              onChange={(e) => setCell(a.id, d, e.target.value as State)}
                              aria-label={`${a.full_name} on ${shortDate(d)}${
                                leave ? ` — approved ${leave.leave_type} leave` : ""
                              }`}
                              title={leave ? `Approved ${leave.leave_type} leave on this day` : undefined}
                              className={cn(
                                "h-8 w-full cursor-pointer appearance-none border-0 px-1 text-center text-[10px] font-semibold tracking-wide focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--brand-accent)]",
                                STATUS_STYLE[state],
                                isChanged && "ring-2 ring-inset ring-amber-400",
                                conflicting && "ring-2 ring-inset ring-amber-500"
                              )}
                            >
                              {DUTY_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                              <option value="NONE">—</option>
                            </select>
                            {/* A dot rather than a fill, because the cell's
                                colour is already saying what the roster says.
                                Blue agrees with the leave; amber says the two
                                disagree. */}
                            {leave && (
                              <span
                                aria-hidden
                                className={cn(
                                  "pointer-events-none absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full ring-1 ring-white",
                                  conflicting ? "bg-amber-400" : "bg-blue-600"
                                )}
                              />
                            )}
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={save} disabled={saving || loading || changed.length === 0}>
          {saving ? "Saving…" : `Save ${changed.length} change${changed.length === 1 ? "" : "s"}`}
        </Button>
        <span className="text-xs text-slate-400">
          {loading
            ? "Loading the current roster…"
            : changed.length === 0
              ? "Nothing changed yet. Pick a status in any cell; click a name or a date to set a whole row or column."
              : "Amber outline marks a cell that is not saved yet."}
        </span>
      </div>
    </div>
  );
}
