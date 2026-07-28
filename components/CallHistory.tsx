"use client";

import { formatDateTime } from "@/lib/utils";
import { LEAD_STATUS_LABELS } from "@/lib/validation";
import type { CallSession, OrderStatus } from "@/lib/types";

function duration(seconds: number | null): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function statusLabel(value: string | null): string {
  if (!value) return "—";
  return LEAD_STATUS_LABELS[value as OrderStatus] || value;
}

/** Read-only call history for an order. Agents can see it but never edit it —
 * corrections are a Management action and go through the audit log. */
export function CallHistory({ sessions, agentNameById }: { sessions: CallSession[]; agentNameById: Record<string, string> }) {
  if (sessions.length === 0) {
    return <p className="text-xs text-slate-400">No calls recorded for this order yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[720px] text-left text-xs">
        <thead className="bg-slate-50 uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">Agent</th>
            <th className="px-3 py-2">Call Start</th>
            <th className="px-3 py-2">Call End</th>
            <th className="px-3 py-2">Duration</th>
            <th className="px-3 py-2">Previous Status</th>
            <th className="px-3 py-2">New Status</th>
            <th className="px-3 py-2">Remarks</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sessions.map((s) => (
            <tr key={s.id}>
              <td className="px-3 py-2 text-slate-700">{agentNameById[s.agent_id] || "—"}</td>
              <td className="px-3 py-2 text-slate-600">{formatDateTime(s.started_at)}</td>
              <td className="px-3 py-2 text-slate-600">{s.ended_at ? formatDateTime(s.ended_at) : "In progress"}</td>
              <td className="px-3 py-2 text-slate-600">{duration(s.duration_seconds)}</td>
              <td className="px-3 py-2 text-slate-600">{statusLabel(s.previous_status)}</td>
              <td className="px-3 py-2 text-slate-600">{statusLabel(s.new_status)}</td>
              <td className="px-3 py-2 text-slate-600">{s.remarks || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
