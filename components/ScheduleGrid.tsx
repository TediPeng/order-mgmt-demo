"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { cn } from "@/lib/utils";

export type CellState = "on_duty" | "off" | "suspended" | "none";

export interface ScheduleGridAgent {
  id: string;
  name: string;
  /** Shown under the name, the way the floor says it. */
  callName: string | null;
}

export interface ScheduleGridColumn {
  date: string;
  label: string;
  weekday: string;
  isWeekend: boolean;
  isToday: boolean;
}

/** Keyed `agentId|date`. Absent means nothing is assigned. */
export type ScheduleGridCells = Record<string, CellState>;

const CELL_STYLE: Record<CellState, string> = {
  on_duty: "bg-green-600 text-white",
  off: "bg-red-600 text-white",
  // Set by a suspension, not by whoever is looking at the grid — the same
  // orange the calendar and its legend already use for one.
  suspended: "bg-orange-600 text-white",
  none: "bg-white text-slate-300",
};

const CELL_LABEL: Record<CellState, string> = {
  on_duty: "ON DUTY",
  off: "OFF",
  suspended: "SUSPENDED",
  none: "—",
};

/**
 * The duty roster as the floor keeps it: one row per agent, one column per day
 * of the cut-off, ON DUTY or OFF in every cell.
 *
 * A month calendar could not show this. A cut-off runs the 13th to the 27th or
 * the 28th to the 12th, so half of them straddle two months and the view that
 * matters — is everyone covered on the 3rd — meant reading two screens. The
 * team was keeping the real roster in a spreadsheet beside the app, which is
 * the clearest signal a view is wrong.
 *
 * Cells are editable in place for anyone who may edit schedules. A suspension
 * is never editable here: it is set by the disciplinary module and lifting it
 * from a schedule grid would hide the reason it exists.
 */
export function ScheduleGrid({
  agents,
  columns,
  cells: initialCells,
  canEdit,
}: {
  agents: ScheduleGridAgent[];
  columns: ScheduleGridColumn[];
  cells: ScheduleGridCells;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [cells, setCells] = useState<ScheduleGridCells>(initialCells);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setCell(agentId: string, date: string, next: CellState) {
    const key = `${agentId}|${date}`;
    const previous = cells[key] ?? "none";
    if (next === previous) return;

    // Optimistic: fifteen columns of dropdowns that each wait a round trip
    // before showing anything is unusable for setting a fortnight of rest days.
    setCells((c) => ({ ...c, [key]: next }));
    setSaving(key);
    setError(null);

    try {
      const res =
        next === "none"
          ? await fetch(`/api/schedule/by-date?agent=${agentId}&date=${date}`, { method: "DELETE" })
          : await fetch("/api/schedule", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                agent_id: agentId,
                schedule_date: date,
                is_rest_day: next === "off",
                // Replacing is the whole point of a grid cell: the agent
                // already has something on that date and this is the change.
                confirm_replace: true,
              }),
            });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        setCells((c) => ({ ...c, [key]: previous }));
        setError(json.error || "Could not save that change.");
      } else {
        // The stat tiles above are server-rendered from the same rows.
        router.refresh();
      }
    } catch {
      setCells((c) => ({ ...c, [key]: previous }));
      setError("Network error. That change was not saved.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && <Alert kind="error">{error}</Alert>}

      <div className="overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              {/* Sticky in both directions: the names have to stay put while
                  the fortnight scrolls sideways, and the dates while a floor of
                  twenty scrolls down. */}
              <th className="sticky left-0 top-0 z-30 min-w-[13rem] border-b border-r border-slate-200 bg-slate-100 px-3 py-2 text-left font-semibold uppercase tracking-wide text-slate-600">
                Full name
              </th>
              {columns.map((col) => (
                <th
                  key={col.date}
                  className={cn(
                    "sticky top-0 z-20 min-w-[5.5rem] border-b border-r border-slate-200 px-2 py-2 text-center font-semibold",
                    col.isToday ? "bg-amber-100 text-amber-900" : col.isWeekend ? "bg-slate-200 text-slate-600" : "bg-slate-100 text-slate-600"
                  )}
                >
                  <div className="whitespace-nowrap">{col.label}</div>
                  <div className="font-normal text-[10px] uppercase tracking-wide opacity-70">{col.weekday}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.id}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-b border-r border-slate-200 bg-yellow-50 px-3 py-1.5 text-left font-medium text-slate-800"
                >
                  <span className="block truncate">{agent.name}</span>
                  {agent.callName && (
                    <span className="block text-[10px] uppercase tracking-wide text-slate-400">{agent.callName}</span>
                  )}
                </th>
                {columns.map((col) => {
                  const key = `${agent.id}|${col.date}`;
                  const state = cells[key] ?? "none";
                  const locked = state === "suspended" || !canEdit;
                  return (
                    <td key={col.date} className="border-b border-r border-slate-200 p-0">
                      {locked ? (
                        <div
                          className={cn(
                            "flex h-8 items-center justify-center px-2 text-[11px] font-semibold tracking-wide",
                            CELL_STYLE[state]
                          )}
                          title={state === "suspended" ? "Set by a suspension — lift it from Disciplinary" : undefined}
                        >
                          {CELL_LABEL[state]}
                        </div>
                      ) : (
                        // A native select: it types-to-jump, it works on a
                        // phone, and it is what the spreadsheet this replaces
                        // already trained everyone on.
                        <select
                          value={state}
                          disabled={saving === key}
                          onChange={(e) => setCell(agent.id, col.date, e.target.value as CellState)}
                          aria-label={`${agent.name} on ${col.label}`}
                          className={cn(
                            "h-8 w-full cursor-pointer appearance-none border-0 px-2 text-center text-[11px] font-semibold tracking-wide focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--brand-accent)]",
                            CELL_STYLE[state],
                            saving === key && "opacity-60"
                          )}
                        >
                          <option value="on_duty">ON DUTY</option>
                          <option value="off">OFF</option>
                          <option value="none">—</option>
                        </select>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {agents.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="px-4 py-10 text-center text-sm text-slate-400">
                  No agents to schedule.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        {canEdit
          ? "Change a cell to set that day. A suspension is shown but cannot be changed here — lift it from Disciplinary."
          : "Read only. Scheduling is a Team Lead and Administrator grant."}
      </p>
    </div>
  );
}
