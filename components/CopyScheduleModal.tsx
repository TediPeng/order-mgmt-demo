"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";
import { cutoffFor, shiftCutoff, datesIn, shortDate, weekdayOf, isWeekend, type Cutoff } from "@/lib/cutoff";
import { cn } from "@/lib/utils";
import { STATUS_STYLE, STATUS_LABEL, statusOf, type CellStatus } from "@/lib/duty-status";
import type { AgentOption } from "@/components/ScheduleEventModal";

type State = CellStatus;


interface ScheduleEvent {
  extendedProps?: { agent_id?: string; status?: string; is_rest_day?: boolean; schedule_date?: string; suspension_id?: string | null };
}

/**
 * Copying one cut-off onto another, with the thing being copied on screen.
 *
 * It used to be three date boxes and a count: "42 schedules would be created".
 * That tells you the copy ran, not whether it is the right fortnight — and a
 * roster copied from the wrong period is only discovered by the agents it
 * strands. The source cut-off is drawn here in the same grid as the roster, so
 * what you are about to duplicate is the thing you are looking at.
 *
 * A suspension in the source is shown but never copied: the server refuses it
 * (skippedSuspended), and drawing it as ON DUTY would promise something the
 * apply cannot deliver.
 */
export function CopyScheduleModal({
  agents,
  onClose,
  onDone,
}: {
  agents: AgentOption[];
  onClose: () => void;
  onDone: () => void;
}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [source, setSource] = useState<Cutoff>(() => shiftCutoff(cutoffFor(today), -1));
  const [target, setTarget] = useState<Cutoff>(() => cutoffFor(today));
  const [selected, setSelected] = useState<string[]>([]);
  const [cells, setCells] = useState<Record<string, State>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ created: number; skippedConflict: number; skippedSuspended: number } | null>(null);
  const [applied, setApplied] = useState(false);

  const sourceDates = useMemo(() => datesIn(source), [source]);
  const rows = agents.filter((a) => selected.includes(a.id));

  const loadSource = useCallback(async () => {
    setLoading(true);
    try {
      // `end` is exclusive on this route, matching what the calendar sent.
      const params = new URLSearchParams({ start: source.start, end: datesIn(source)[sourceDates.length - 1] });
      params.set("end", new Date(new Date(`${source.end}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10));
      const res = await fetch(`/api/schedule?${params.toString()}`);
      const events: ScheduleEvent[] = res.ok ? await res.json() : [];
      const next: Record<string, State> = {};
      for (const e of events) {
        const p = e.extendedProps || {};
        if (!p.agent_id || !p.schedule_date) continue;
        next[`${p.agent_id}|${p.schedule_date}`] = statusOf(p);
      }
      setCells(next);
    } catch {
      setError("Could not read the source cut-off.");
    } finally {
      setLoading(false);
    }
  }, [source, sourceDates.length]);

  useEffect(() => {
    loadSource();
  }, [loadSource]);

  async function run(apply: boolean, confirmReplace = false) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/schedule/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_ids: selected,
          source_start: source.start,
          source_end: source.end,
          target_start: target.start,
          apply,
          confirm_replace: confirmReplace,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error || "Something went wrong.");
        setSaving(false);
        return;
      }
      setPreview(json.summary);
      setApplied(!json.preview);
      setSaving(false);
    } catch {
      setError("Network error. Please try again.");
      setSaving(false);
    }
  }

  const copyable = rows.reduce(
    (n, a) => n + sourceDates.filter((d) => (cells[`${a.id}|${d}`] ?? "NONE") !== "NONE" && cells[`${a.id}|${d}`] !== "SUSPENDED").length,
    0
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Copy Schedule</h3>
            <p className="text-xs text-slate-500">Copy one cut-off onto another, day for day.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {error && <Alert kind="error">{error}</Alert>}
          {preview && (
            <Alert kind={applied ? "success" : "info"}>
              {applied ? "Copied " : "Would copy "}
              {preview.created} day{preview.created === 1 ? "" : "s"}. {preview.skippedConflict} already scheduled,{" "}
              {preview.skippedSuspended} on suspension.
            </Alert>
          )}

          {!applied && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 p-3">
                  <Label>Copy from</Label>
                  <div className="mt-1 flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setSource(shiftCutoff(source, -1))}>
                      ←
                    </Button>
                    <span className="flex-1 text-center text-sm font-semibold text-slate-900">{source.label}</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => setSource(shiftCutoff(source, 1))}>
                      →
                    </Button>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <Label>Onto</Label>
                  <div className="mt-1 flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setTarget(shiftCutoff(target, -1))}>
                      ←
                    </Button>
                    <span className="flex-1 text-center text-sm font-semibold text-slate-900">{target.label}</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => setTarget(shiftCutoff(target, 1))}>
                      →
                    </Button>
                  </div>
                </div>
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
                        onChange={() =>
                          setSelected((prev) => (prev.includes(a.id) ? prev.filter((x) => x !== a.id) : [...prev, a.id]))
                        }
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      {a.full_name}
                    </label>
                  ))}
                </div>
              </div>

              {rows.length > 0 && (
                <div>
                  <p className="mb-1 text-xs text-slate-500">
                    {loading ? "Reading the source cut-off…" : `This is ${source.label} — it will land on ${target.label}.`}
                  </p>
                  <div className="overflow-auto rounded-lg border border-slate-200">
                    <table className="border-collapse text-xs">
                      <thead>
                        <tr>
                          <th className="sticky left-0 z-20 min-w-[11rem] border-b border-r border-slate-200 bg-slate-100 px-3 py-2 text-left font-semibold uppercase tracking-wide text-slate-600">
                            Full name
                          </th>
                          {sourceDates.map((d) => (
                            <th
                              key={d}
                              className={cn(
                                "min-w-[4.5rem] border-b border-r border-slate-200 px-1 py-2 text-center font-semibold",
                                isWeekend(d) ? "bg-slate-200 text-slate-600" : "bg-slate-100 text-slate-600"
                              )}
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
                              className="sticky left-0 z-10 border-b border-r border-slate-200 bg-yellow-50 px-3 py-1.5 text-left font-medium text-slate-800"
                            >
                              <span className="block truncate">{a.full_name}</span>
                            </th>
                            {sourceDates.map((d) => {
                              const state = cells[`${a.id}|${d}`] ?? "NONE";
                              return (
                                <td key={d} className="border-b border-r border-slate-200 p-0">
                                  <div
                                    className={cn(
                                      "flex h-8 items-center justify-center text-[10px] font-semibold tracking-wide",
                                      STATUS_STYLE[state]
                                    )}
                                    title={state === "SUSPENDED" ? "Suspensions are never copied" : undefined}
                                  >
                                    {STATUS_LABEL[state]}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          {applied ? (
            <Button type="button" onClick={onDone}>
              Done
            </Button>
          ) : preview ? (
            <>
              <Button type="button" variant="outline" onClick={() => setPreview(null)} disabled={saving}>
                Back
              </Button>
              <Button type="button" onClick={() => run(true, preview.skippedConflict > 0)} disabled={saving}>
                {saving ? "Applying…" : "Apply"}
              </Button>
            </>
          ) : (
            <>
              <span className="mr-auto text-xs text-slate-400">
                {rows.length === 0 ? "Pick who to copy." : `${copyable} day(s) to copy.`}
              </span>
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button type="button" onClick={() => run(false)} disabled={saving || selected.length === 0 || source.start === target.start}>
                {saving ? "Checking…" : "Preview"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
