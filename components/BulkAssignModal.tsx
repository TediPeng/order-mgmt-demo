"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";
import { cutoffFor, shiftCutoff, datesIn, shortDate, weekdayOf, isWeekend, type Cutoff } from "@/lib/cutoff";
import { cn } from "@/lib/utils";
import type { AgentOption } from "@/components/ScheduleEventModal";

type Paint = "on_duty" | "off" | "none";

const CELL_STYLE: Record<Paint, string> = {
  on_duty: "bg-green-600 text-white hover:bg-green-700",
  off: "bg-red-600 text-white hover:bg-red-700",
  none: "bg-white text-slate-300 hover:bg-slate-50",
};

const CELL_LABEL: Record<Paint, string> = { on_duty: "ON DUTY", off: "OFF", none: "—" };

/** Click cycles through the three states, which is the whole interaction. */
const NEXT: Record<Paint, Paint> = { none: "on_duty", on_duty: "off", off: "none" };

/**
 * Filling a cut-off for several agents at once — the same grid as the roster
 * itself, painted before it is saved.
 *
 * It used to be a form: pick a pattern (single / range / weekly), pick weekdays,
 * tick "Rest Day", apply. That can only say one thing about every date it
 * touches, so a fortnight where each agent has a different day off took one pass
 * per agent per rest day, and you could not see what you had built until it was
 * already written. Here the fortnight is in front of you, and one Apply writes
 * exactly what is on the screen.
 */
export function BulkAssignModal({
  agents,
  onClose,
  onDone,
}: {
  agents: AgentOption[];
  onClose: () => void;
  onDone: () => void;
}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [cutoff, setCutoff] = useState<Cutoff>(() => cutoffFor(today));
  const [selected, setSelected] = useState<string[]>([]);
  const [cells, setCells] = useState<Record<string, Paint>>({});
  const [dutyStart, setDutyStart] = useState("08:00");
  const [dutyEnd, setDutyEnd] = useState("17:00");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ created: number; skippedConflict: number; skippedSuspended: number } | null>(
    null
  );

  const dates = useMemo(() => datesIn(cutoff), [cutoff]);
  const rows = agents.filter((a) => selected.includes(a.id));

  const painted = Object.entries(cells).filter(([, v]) => v !== "none");

  function paint(agentId: string, date: string, value: Paint) {
    setCells((c) => ({ ...c, [`${agentId}|${date}`]: value }));
  }

  function cycle(agentId: string, date: string) {
    const key = `${agentId}|${date}`;
    paint(agentId, date, NEXT[cells[key] ?? "none"]);
  }

  /** Set every selected agent's whole cut-off. */
  function fillAll(value: Paint) {
    const next: Record<string, Paint> = { ...cells };
    for (const a of rows) for (const d of dates) next[`${a.id}|${d}`] = value;
    setCells(next);
  }

  /** A column: the same day for everyone selected. */
  function fillColumn(date: string) {
    const allOn = rows.every((a) => cells[`${a.id}|${date}`] === "on_duty");
    const value: Paint = allOn ? "off" : "on_duty";
    const next: Record<string, Paint> = { ...cells };
    for (const a of rows) next[`${a.id}|${date}`] = value;
    setCells(next);
  }

  /** A row: one agent's whole cut-off. */
  function fillRow(agentId: string) {
    const allOn = dates.every((d) => cells[`${agentId}|${d}`] === "on_duty");
    const value: Paint = allOn ? "off" : "on_duty";
    const next: Record<string, Paint> = { ...cells };
    for (const d of dates) next[`${agentId}|${d}`] = value;
    setCells(next);
  }

  function toggleAgent(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  }

  async function submit(confirmReplace = false) {
    setSaving(true);
    setError(null);
    try {
      const entries = painted.map(([key, value]) => {
        const [agent_id, schedule_date] = key.split("|");
        return { agent_id, schedule_date, is_rest_day: value === "off" };
      });
      const res = await fetch("/api/schedule/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "matrix",
          agent_ids: selected,
          entries,
          duty_start: dutyStart,
          duty_end: dutyEnd,
          remarks: remarks || null,
          confirm_replace: confirmReplace,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error || "Something went wrong.");
        setSaving(false);
        return;
      }
      setSummary(json.summary);
      setSaving(false);
    } catch {
      setError("Network error. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Bulk Assign</h3>
            <p className="text-xs text-slate-500">Paint the cut-off, then apply it to everyone you picked.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {error && <Alert kind="error">{error}</Alert>}

          {summary ? (
            <div className="space-y-2">
              <Alert kind="success">
                Wrote {summary.created} day{summary.created === 1 ? "" : "s"}. Skipped {summary.skippedConflict} already
                scheduled and {summary.skippedSuspended} on suspension.
              </Alert>
              {summary.skippedConflict > 0 && (
                <Button type="button" variant="outline" onClick={() => submit(true)} disabled={saving}>
                  {saving ? "Replacing…" : `Replace ${summary.skippedConflict} existing day(s)`}
                </Button>
              )}
            </div>
          ) : (
            <>
              {/* Which fortnight. Same periods as the roster behind it, so what
                  you paint here lines up with what you were just looking at. */}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setCutoff(shiftCutoff(cutoff, -1))}>
                  ← {shiftCutoff(cutoff, -1).shortLabel}
                </Button>
                <span className="text-sm font-semibold text-slate-900">{cutoff.label}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => setCutoff(shiftCutoff(cutoff, 1))}>
                  {shiftCutoff(cutoff, 1).shortLabel} →
                </Button>
              </div>

              <div>
                <Label>Agents</Label>
                <div className="max-h-28 overflow-y-auto rounded-md border border-slate-200 p-2">
                  <label className="flex items-center gap-2 border-b border-slate-100 py-1 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={selected.length === agents.length && agents.length > 0}
                      onChange={() => setSelected(selected.length === agents.length ? [] : agents.map((a) => a.id))}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Everyone ({agents.length})
                  </label>
                  {agents.map((a) => (
                    <label key={a.id} className="flex items-center gap-2 py-0.5 text-sm">
                      <input
                        type="checkbox"
                        checked={selected.includes(a.id)}
                        onChange={() => toggleAgent(a.id)}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      {a.full_name}
                    </label>
                  ))}
                </div>
              </div>

              {rows.length > 0 && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => fillAll("on_duty")}>
                      All ON DUTY
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => fillAll("off")}>
                      All OFF
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => fillAll("none")}>
                      Clear
                    </Button>
                    <span className="text-xs text-slate-400">
                      Click a cell to cycle · a date to set the column · a name to set the row
                    </span>
                  </div>

                  <div className="overflow-auto rounded-lg border border-slate-200">
                    <table className="border-collapse text-xs">
                      <thead>
                        <tr>
                          <th className="sticky left-0 z-20 min-w-[11rem] border-b border-r border-slate-200 bg-slate-100 px-3 py-2 text-left font-semibold uppercase tracking-wide text-slate-600">
                            Full name
                          </th>
                          {dates.map((d) => (
                            <th
                              key={d}
                              className={cn(
                                "min-w-[4.5rem] cursor-pointer border-b border-r border-slate-200 px-1 py-2 text-center font-semibold hover:bg-slate-300",
                                isWeekend(d) ? "bg-slate-200 text-slate-600" : "bg-slate-100 text-slate-600"
                              )}
                              onClick={() => fillColumn(d)}
                              title="Set this day for everyone selected"
                            >
                              <div className="whitespace-nowrap">{shortDate(d)}</div>
                              <div className="text-[10px] font-normal uppercase opacity-70">{weekdayOf(d)}</div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((a) => (
                          <tr key={a.id}>
                            <th
                              scope="row"
                              onClick={() => fillRow(a.id)}
                              title="Set this agent's whole cut-off"
                              className="sticky left-0 z-10 cursor-pointer border-b border-r border-slate-200 bg-yellow-50 px-3 py-1.5 text-left font-medium text-slate-800 hover:bg-yellow-100"
                            >
                              <span className="block truncate">{a.full_name}</span>
                            </th>
                            {dates.map((d) => {
                              const state = cells[`${a.id}|${d}`] ?? "none";
                              return (
                                <td key={d} className="border-b border-r border-slate-200 p-0">
                                  <button
                                    type="button"
                                    onClick={() => cycle(a.id, d)}
                                    aria-label={`${a.full_name} on ${shortDate(d)}: ${CELL_LABEL[state]}`}
                                    className={cn(
                                      "h-8 w-full text-[10px] font-semibold tracking-wide transition-colors",
                                      CELL_STYLE[state]
                                    )}
                                  >
                                    {CELL_LABEL[state]}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* Everyone works the same hours, so these sit under the grid
                  rather than above it — they are almost never changed. */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="bulk_duty_start">Duty Start</Label>
                  <Input id="bulk_duty_start" type="time" value={dutyStart} onChange={(e) => setDutyStart(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="bulk_duty_end">Duty End</Label>
                  <Input id="bulk_duty_end" type="time" value={dutyEnd} onChange={(e) => setDutyEnd(e.target.value)} />
                </div>
              </div>

              <div>
                <Label htmlFor="bulk_remarks">Remarks</Label>
                <Textarea id="bulk_remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          {summary ? (
            <Button type="button" onClick={onDone}>
              Done
            </Button>
          ) : (
            <>
              <span className="mr-auto text-xs text-slate-400">
                {painted.length === 0 ? "Nothing painted yet." : `${painted.length} day(s) will be written.`}
              </span>
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button type="button" onClick={() => submit(false)} disabled={saving || painted.length === 0}>
                {saving ? "Applying…" : "Apply"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
