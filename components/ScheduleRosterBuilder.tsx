"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { cutoffFor, shiftCutoff, datesIn, shortDate, weekdayOf, isWeekend, addDays, type Cutoff } from "@/lib/cutoff";
import { cn } from "@/lib/utils";
import { DUTY_STATUSES, STATUS_STYLE, statusOf, type CellStatus } from "@/lib/duty-status";
import type { AgentOption } from "@/components/ScheduleEventModal";

type State = CellStatus;


interface ScheduleEvent {
  extendedProps?: {
    agent_id?: string;
    status?: string;
    is_rest_day?: boolean;
    schedule_date?: string;
    suspension_id?: string | null;
  };
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
 * Only what changed is sent. A cut-off is three hundred cells and the agent
 * usually rewrites a dozen; posting all of them would rewrite rows nobody
 * touched and bury the real change in the audit log.
 */
export function ScheduleRosterBuilder({ agents }: { agents: AgentOption[] }) {
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
      setCells(next);
    } catch {
      setError("Could not read the current roster for this cut-off.");
    } finally {
      setLoading(false);
    }
  }, [cutoff]);

  useEffect(() => {
    load();
  }, [load]);

  const changed = Object.entries(cells).filter(
    ([key, value]) => value !== "SUSPENDED" && value !== "NONE" && (loaded[key] ?? "NONE") !== value
  );

  function setCell(agentId: string, date: string, value: State) {
    const key = `${agentId}|${date}`;
    if ((cells[key] ?? "NONE") === "SUSPENDED") return;
    setCells((c) => ({ ...c, [key]: value }));
  }

  function fill(value: State, agentId?: string, date?: string) {
    setCells((c) => {
      const next = { ...c };
      for (const a of agents) {
        if (agentId && a.id !== agentId) continue;
        for (const d of dates) {
          if (date && d !== date) continue;
          const key = `${a.id}|${d}`;
          if ((next[key] ?? "NONE") === "SUSPENDED") continue;
          next[key] = value;
        }
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
            {agents.map((a) => (
              <tr key={a.id}>
                <th
                  scope="row"
                  onClick={() => fill("ON DUTY", a.id)}
                  title="Set this agent's whole cut-off"
                  className="sticky left-0 z-10 cursor-pointer border-b border-r border-slate-200 bg-yellow-50 px-3 py-1.5 text-left font-medium text-slate-800 hover:bg-yellow-100"
                >
                  <span className="block truncate">{a.full_name}</span>
                </th>
                {dates.map((d) => {
                  const key = `${a.id}|${d}`;
                  const state = cells[key] ?? "NONE";
                  const isChanged = state !== "SUSPENDED" && (loaded[key] ?? "NONE") !== state;
                  return (
                    <td key={d} className="border-b border-r border-slate-200 p-0">
                      <select
                        value={state}
                        disabled={state === "SUSPENDED"}
                        onChange={(e) => setCell(a.id, d, e.target.value as State)}
                        aria-label={`${a.full_name} on ${shortDate(d)}`}
                        className={cn(
                          "h-8 w-full cursor-pointer appearance-none border-0 px-1 text-center text-[10px] font-semibold tracking-wide focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--brand-accent)]",
                          STATUS_STYLE[state],
                          isChanged && "ring-2 ring-inset ring-amber-400"
                        )}
                      >
                        {DUTY_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                        <option value="NONE">—</option>
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
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
              ? "Nothing changed yet. Click a cell to cycle ON DUTY → OFF → blank."
              : "Amber outline marks a cell that is not saved yet."}
        </span>
      </div>
    </div>
  );
}
