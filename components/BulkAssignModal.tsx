"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select, Textarea } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";
import type { AgentOption } from "@/components/ScheduleEventModal";

const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

type Mode = "single" | "range" | "weekly";

export function BulkAssignModal({ agents, onClose, onDone }: { agents: AgentOption[]; onClose: () => void; onDone: () => void }) {
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("range");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [weeks, setWeeks] = useState(4);
  const [isRestDay, setIsRestDay] = useState(false);
  const [dutyStart, setDutyStart] = useState("08:00");
  const [dutyEnd, setDutyEnd] = useState("17:00");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ created: number; skippedConflict: number; skippedSuspended: number } | null>(null);

  function toggleAgent(id: string) {
    setSelectedAgents((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  }
  function toggleWeekday(v: number) {
    setWeekdays((prev) => (prev.includes(v) ? prev.filter((w) => w !== v) : [...prev, v]));
  }

  async function submit(confirmReplace = false) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/schedule/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_ids: selectedAgents,
          mode,
          start_date: startDate,
          end_date: endDate,
          weekdays,
          weeks,
          is_rest_day: isRestDay,
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
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="text-base font-semibold text-slate-900">Multi-Assign / Bulk / Recurring Schedule</h3>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {error && <Alert kind="error">{error}</Alert>}

          {summary ? (
            <div className="space-y-2">
              <Alert kind="success">
                Created {summary.created} schedule(s). Skipped {summary.skippedConflict} (already scheduled), {summary.skippedSuspended} (suspended).
              </Alert>
              {summary.skippedConflict > 0 && (
                <Button type="button" variant="outline" onClick={() => submit(true)} disabled={saving}>
                  {saving ? "Replacing…" : `Replace ${summary.skippedConflict} conflicting schedule(s)`}
                </Button>
              )}
            </div>
          ) : (
            <>
              <div>
                <Label>Agents</Label>
                <div className="max-h-32 overflow-y-auto rounded-md border border-slate-200 p-2">
                  {agents.map((a) => (
                    <label key={a.id} className="flex items-center gap-2 py-0.5 text-sm">
                      <input type="checkbox" checked={selectedAgents.includes(a.id)} onChange={() => toggleAgent(a.id)} className="h-4 w-4 rounded border-slate-300" />
                      {a.full_name}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <Label htmlFor="bulk_mode">Pattern</Label>
                <Select id="bulk_mode" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                  <option value="single">Single date</option>
                  <option value="range">Date range (bulk assign a week/month)</option>
                  <option value="weekly">Recurring weekly pattern</option>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="bulk_start">{mode === "weekly" ? "Starting" : "Start Date"}</Label>
                  <Input id="bulk_start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                {mode === "range" && (
                  <div>
                    <Label htmlFor="bulk_end">End Date</Label>
                    <Input id="bulk_end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                  </div>
                )}
                {mode === "weekly" && (
                  <div>
                    <Label htmlFor="bulk_weeks">Number of weeks</Label>
                    <Input id="bulk_weeks" type="number" min={1} max={52} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} />
                  </div>
                )}
              </div>

              {mode === "weekly" && (
                <div>
                  <Label>Days of week</Label>
                  <div className="flex flex-wrap gap-2">
                    {WEEKDAYS.map((w) => (
                      <button
                        key={w.value}
                        type="button"
                        onClick={() => toggleWeekday(w.value)}
                        className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                          weekdays.includes(w.value) ? "border-[var(--brand-primary)] bg-[var(--brand-primary-10)] text-[var(--brand-primary)]" : "border-slate-200 text-slate-500"
                        }`}
                      >
                        {w.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <input id="bulk_rest_day" type="checkbox" checked={isRestDay} onChange={(e) => setIsRestDay(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                <Label htmlFor="bulk_rest_day">Rest Day</Label>
              </div>

              {!isRestDay && (
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
              )}

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
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button type="button" onClick={() => submit(false)} disabled={saving || selectedAgents.length === 0 || !startDate}>
                {saving ? "Applying…" : "Apply"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
