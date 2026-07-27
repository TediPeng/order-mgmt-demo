"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select, Textarea } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";

export interface AgentOption {
  id: string;
  full_name: string;
}

export type ScheduleModalState =
  | { mode: "create"; date: string }
  | {
      mode: "edit";
      eventId: string;
      data: {
        agent_id: string;
        agent_name: string;
        schedule_date: string;
        duty_start: string | null;
        duty_end: string | null;
        is_rest_day: boolean;
        status: string;
        remarks: string | null;
        suspension_id: string | null;
      };
    };

function dayOfWeek(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

export function ScheduleEventModal({
  state,
  agents,
  canEdit,
  canDelete,
  onClose,
  onSaved,
  onDeleted,
}: {
  state: ScheduleModalState;
  agents: AgentOption[];
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const isEdit = state.mode === "edit";
  const locked = isEdit && !!state.data.suspension_id;

  const [agentId, setAgentId] = useState(isEdit ? state.data.agent_id : agents[0]?.id || "");
  const [date] = useState(isEdit ? state.data.schedule_date : state.date);
  const [isRestDay, setIsRestDay] = useState(isEdit ? state.data.is_rest_day : false);
  const [dutyStart, setDutyStart] = useState(isEdit ? state.data.duty_start || "08:00" : "08:00");
  const [dutyEnd, setDutyEnd] = useState(isEdit ? state.data.duty_end || "17:00" : "17:00");
  const [remarks, setRemarks] = useState(isEdit ? state.data.remarks || "" : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(confirmReplace = false) {
    setSaving(true);
    setError(null);
    const payload = {
      agent_id: agentId,
      schedule_date: date,
      is_rest_day: isRestDay,
      duty_start: isRestDay ? null : dutyStart,
      duty_end: isRestDay ? null : dutyEnd,
      remarks: remarks || null,
      confirm_replace: confirmReplace,
    };
    try {
      const url = isEdit ? `/api/schedule/${state.eventId}` : "/api/schedule";
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.ok) {
        if (json.code === "conflict") {
          const ok = window.confirm(json.error);
          if (ok) {
            await submit(true);
            return;
          }
          setError("Save cancelled -- the other schedule was left untouched.");
          setSaving(false);
          return;
        }
        setError(json.error || "Something went wrong.");
        setSaving(false);
        return;
      }
      onSaved();
    } catch {
      setError("Network error. Please try again.");
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!isEdit) return;
    if (!window.confirm("Remove this schedule entry?")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/schedule/${state.eventId}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error || "Could not delete this schedule.");
        setSaving(false);
        return;
      }
      onDeleted();
    } catch {
      setError("Network error. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="text-base font-semibold text-slate-900">{isEdit ? "Edit Schedule" : "Create Schedule"}</h3>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {error && <Alert kind="error">{error}</Alert>}
          {locked && (
            <Alert kind="error">
              This entry was created by an active suspension and can only be changed by lifting the suspension in
              Disciplinary Actions.
            </Alert>
          )}

          <div>
            <Label htmlFor="sched_agent">Agent Name</Label>
            {isEdit ? (
              <Input value={state.data.agent_name} disabled />
            ) : (
              <Select id="sched_agent" value={agentId} onChange={(e) => setAgentId(e.target.value)} disabled={!canEdit || locked}>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.full_name}
                  </option>
                ))}
              </Select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Schedule Date</Label>
              <Input value={date} disabled />
            </div>
            <div>
              <Label>Day of the Week</Label>
              <Input value={dayOfWeek(date)} disabled />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="sched_rest_day"
              type="checkbox"
              checked={isRestDay}
              onChange={(e) => setIsRestDay(e.target.checked)}
              disabled={!canEdit || locked}
              className="h-4 w-4 rounded border-slate-300"
            />
            <Label htmlFor="sched_rest_day">Rest Day</Label>
          </div>

          {!isRestDay && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="sched_start">Duty Start</Label>
                <Input id="sched_start" type="time" value={dutyStart} onChange={(e) => setDutyStart(e.target.value)} disabled={!canEdit || locked} />
              </div>
              <div>
                <Label htmlFor="sched_end">Duty End</Label>
                <Input id="sched_end" type="time" value={dutyEnd} onChange={(e) => setDutyEnd(e.target.value)} disabled={!canEdit || locked} />
              </div>
            </div>
          )}

          <div>
            <Label>Schedule Status</Label>
            <Input value={isRestDay ? "Rest Day" : locked ? "Suspension" : "Scheduled"} disabled />
          </div>

          <div>
            <Label htmlFor="sched_remarks">Remarks</Label>
            <Textarea
              id="sched_remarks"
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              disabled={!canEdit || locked}
              placeholder="Optional"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-5 py-3">
          <div>
            {isEdit && canDelete && !locked && (
              <Button type="button" variant="danger" size="sm" onClick={handleDelete} disabled={saving}>
                Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            {canEdit && !locked && (
              <Button type="button" onClick={() => submit(false)} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
