"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";
import type { AgentOption } from "@/components/ScheduleEventModal";

export function CopyScheduleModal({ agents, onClose, onDone }: { agents: AgentOption[]; onClose: () => void; onDone: () => void }) {
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [sourceStart, setSourceStart] = useState("");
  const [sourceEnd, setSourceEnd] = useState("");
  const [targetStart, setTargetStart] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ created: number; skippedConflict: number; skippedSuspended: number } | null>(null);
  const [applied, setApplied] = useState(false);

  function toggleAgent(id: string) {
    setSelectedAgents((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  }

  async function run(apply: boolean, confirmReplace = false) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/schedule/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_ids: selectedAgents,
          source_start: sourceStart,
          source_end: sourceEnd,
          target_start: targetStart,
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="text-base font-semibold text-slate-900">Copy Schedule</h3>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {error && <Alert kind="error">{error}</Alert>}

          {preview && (
            <Alert kind={applied ? "success" : "error"}>
              {applied ? "Applied: " : "Preview: "}
              {preview.created} schedule(s) {applied ? "created" : "would be created"}, {preview.skippedConflict} conflict(s), {preview.skippedSuspended} suspended day(s) skipped.
            </Alert>
          )}

          {!applied && (
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="copy_source_start">Copy From (start)</Label>
                  <Input id="copy_source_start" type="date" value={sourceStart} onChange={(e) => setSourceStart(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="copy_source_end">Copy From (end)</Label>
                  <Input id="copy_source_end" type="date" value={sourceEnd} onChange={(e) => setSourceEnd(e.target.value)} />
                </div>
              </div>
              <div>
                <Label htmlFor="copy_target_start">Onto (target start date)</Label>
                <Input id="copy_target_start" type="date" value={targetStart} onChange={(e) => setTargetStart(e.target.value)} />
              </div>
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
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => run(false)}
                disabled={saving || selectedAgents.length === 0 || !sourceStart || !sourceEnd || !targetStart}
              >
                {saving ? "Checking…" : "Preview"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
