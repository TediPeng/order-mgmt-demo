"use client";

import { useEffect, useRef, useState } from "react";
import { PhoneCall, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import type { CallSession } from "@/lib/types";

/** HH:MM elapsed, computed from the server's started_at.
 *
 * Deliberately not a counter the client increments from zero: a refresh, a
 * reopened popup or a second tab all read the same start instant, so they all
 * agree on the elapsed time instead of each restarting. */
function elapsedHhMm(startedAt: string, now: number): string {
  const secs = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export interface CallingState {
  session: CallSession | null;
  /** Another order already holds this agent's active call. */
  blockedBy: { id: string; order_number: string } | null;
}

export function CallingPanel({
  orderId,
  session,
  blockedBy,
  onStarted,
  onEnded,
  onOpenActive,
}: {
  orderId: string;
  session: CallSession | null;
  blockedBy: { id: string; order_number: string } | null;
  onStarted: (session: CallSession) => void;
  onEnded: () => void;
  onOpenActive: (orderId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const active = session && session.order_id === orderId;

  // Ticks only to re-render the elapsed label; the value itself always derives
  // from started_at, so a missed tick or a sleeping tab cannot skew it.
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    tickRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [active]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/call-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error || "Could not start the call.");
        if (json.activeOrder) onOpenActive(json.activeOrder.id);
        return;
      }
      onStarted(json.session as CallSession);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function endWithoutUpdate() {
    if (!window.confirm("End this call without recording a status update?")) return;
    setBusy(true);
    setError(null);
    try {
      await fetch("/api/call-sessions", { method: "DELETE" });
      onEnded();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (blockedBy && !active) {
    return (
      <Alert kind="error" className="flex items-center justify-between gap-3">
        <span>
          You already have a call in progress on <strong>{blockedBy.order_number}</strong>.
        </span>
        <Button type="button" size="sm" variant="secondary" onClick={() => onOpenActive(blockedBy.id)}>
          Return to active call
        </Button>
      </Alert>
    );
  }

  if (!active) {
    return (
      <div className="space-y-2">
        {error && <Alert kind="error">{error}</Alert>}
        <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-xs text-slate-500">Click Calling before editing or updating this order.</p>
          <Button type="button" size="sm" disabled={busy} onClick={start}>
            <PhoneCall className="h-4 w-4" /> {busy ? "Starting…" : "Calling"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {error && <Alert kind="error">{error}</Alert>}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-600" />
          </span>
          <span className="text-sm font-medium text-green-800">Call in progress</span>
          <span className="font-mono text-sm tabular-nums text-green-900" aria-live="off">
            {elapsedHhMm(session!.started_at, now)}
          </span>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={endWithoutUpdate}>
          <PhoneOff className="h-4 w-4" /> End without update
        </Button>
      </div>
    </div>
  );
}
