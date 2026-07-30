"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { CallSession } from "@/lib/types";

/** Elapsed HH:MM:SS, computed from the server's `started_at` (Section 0.7).
 *
 * Deliberately not a counter the client increments from zero: a refresh, a
 * reopened popup, a second tab or a route change all read the same start
 * instant, so they all agree on the elapsed time instead of each restarting.
 * Seconds are shown because without them the display sits on "00:00" for a
 * full minute after Start Call and reads as a broken timer.
 */
export function formatElapsed(startedAt: string, now: number): string {
  const secs = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

export interface StartCallResult {
  ok: boolean;
  error?: string;
  /** The order that already holds this agent's active call, on a 409. */
  activeOrder?: { id: string; order_number: string } | null;
  /** True when the agent has not timed in for today (Section 2). */
  timeInRequired?: boolean;
  timeInHref?: string;
}

interface CallSessionContextValue {
  session: CallSession | null;
  /** Shared 1s tick. Every timer on the page reads the same instant. */
  now: number;
  startCall: (orderId: string) => Promise<StartCallResult>;
  endCall: () => Promise<void>;
  /** Drops the local session after a save that closed it server-side. */
  clearSession: () => void;
  refresh: () => Promise<void>;
}

const CallSessionContext = createContext<CallSessionContextValue | null>(null);

/**
 * Holds the agent's active calling session for the whole authenticated app.
 *
 * Mounted once in the app layout so the session — and therefore the running
 * timer — survives client-side navigation between routes. It also re-reads the
 * server on mount, on window focus and when the tab becomes visible, so a
 * refresh, a backgrounded tab, or a session ended in another tab all converge
 * on the server's truth rather than drifting.
 */
export function CallSessionProvider({
  initialSession,
  children,
}: {
  initialSession: CallSession | null;
  children: React.ReactNode;
}) {
  const [session, setSession] = useState<CallSession | null>(initialSession);
  const [now, setNow] = useState(() => Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/call-sessions", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) setSession((json.session as CallSession) ?? null);
    } catch {
      // Offline or a transient failure: keep showing the last known session
      // rather than blanking a call that is still running.
    }
  }, []);

  // One interval for the whole app, and only while a call is open.
  useEffect(() => {
    if (!session) {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      return;
    }
    setNow(Date.now());
    tickRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [session]);

  // Resync whenever the tab could have missed something.
  useEffect(() => {
    void refresh();
    const onFocus = () => {
      setNow(Date.now());
      void refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const startCall = useCallback(async (orderId: string): Promise<StartCallResult> => {
    try {
      const res = await fetch("/api/call-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const json = await res.json();
      if (!json.ok) {
        return {
          ok: false,
          error: json.error || "Could not start the call.",
          activeOrder: json.activeOrder ?? null,
          timeInRequired: Boolean(json.timeInRequired),
          timeInHref: json.timeInHref,
        };
      }
      setSession(json.session as CallSession);
      setNow(Date.now());
      return { ok: true };
    } catch {
      return { ok: false, error: "Network error. Please try again." };
    }
  }, []);

  const endCall = useCallback(async () => {
    try {
      await fetch("/api/call-sessions", { method: "DELETE" });
    } finally {
      setSession(null);
    }
  }, []);

  const clearSession = useCallback(() => setSession(null), []);

  return (
    <CallSessionContext.Provider value={{ session, now, startCall, endCall, clearSession, refresh }}>
      {children}
    </CallSessionContext.Provider>
  );
}

export function useCallSession(): CallSessionContextValue {
  const ctx = useContext(CallSessionContext);
  if (!ctx) throw new Error("useCallSession must be used inside a CallSessionProvider");
  return ctx;
}
