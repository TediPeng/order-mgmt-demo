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
  /** The regular customer holding it instead, when that call has not produced
   * an order yet — there is no order to send the agent back to. */
  activeCustomer?: { id: string; full_name: string } | null;
  /** True when the agent has not timed in for today (Section 2). */
  timeInRequired?: boolean;
  timeInHref?: string;
}

interface CallSessionContextValue {
  session: CallSession | null;
  /** Shared 1s tick. Every timer on the page reads the same instant. */
  now: number;
  /** The server-corrected clock, for anything that needs a reading between ticks. */
  clock: () => number;
  startCall: (orderId: string) => Promise<StartCallResult>;
  /** Opens a call on a regular customer who has no order yet — the New Order
   * form raises one while the agent is still on the phone. */
  startCustomerCall: (customerId: string) => Promise<StartCallResult>;
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
  serverNow,
  children,
}: {
  initialSession: CallSession | null;
  /** The server's clock at render, in epoch ms. */
  serverNow: number;
  children: React.ReactNode;
}) {
  const [session, setSession] = useState<CallSession | null>(initialSession);
  // Every elapsed figure in the app is measured against this, and it is the
  // SERVER's clock, not the device's.
  //
  // A machine on the floor was running about sixteen hours fast. Its call timer
  // read 16:02:17 for a call two minutes old, and the end-of-shift notice fired
  // at half past two in the afternoon claiming the shift had ended thirteen
  // hours earlier — over an order, mid-call, with the agent unable to get past
  // it. Nothing was wrong with the record; the browser simply believed the
  // wrong time, and every timer here believed the browser.
  //
  // The offset is measured once, against the timestamp the server rendered
  // with, and every tick is corrected by it. A device an hour or a day out now
  // shows the same figures as everyone else.
  const skewRef = useRef(serverNow - Date.now());
  const clock = useCallback(() => Date.now() + skewRef.current, []);
  const [now, setNow] = useState(() => serverNow);
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
    setNow(clock());
    tickRef.current = setInterval(() => setNow(clock()), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
    };
    // clock reads a ref and never changes identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Resync whenever the tab could have missed something.
  useEffect(() => {
    void refresh();
    const onFocus = () => {
      setNow(clock());
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  const open = useCallback(async (body: { orderId?: string; customerId?: string }): Promise<StartCallResult> => {
    try {
      const res = await fetch("/api/call-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) {
        return {
          ok: false,
          error: json.error || "Could not start the call.",
          activeOrder: json.activeOrder ?? null,
          activeCustomer: json.activeCustomer ?? null,
          timeInRequired: Boolean(json.timeInRequired),
          timeInHref: json.timeInHref,
        };
      }
      setSession(json.session as CallSession);
      setNow(clock());
      return { ok: true };
    } catch {
      return { ok: false, error: "Network error. Please try again." };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCall = useCallback((orderId: string) => open({ orderId }), [open]);
  const startCustomerCall = useCallback((customerId: string) => open({ customerId }), [open]);

  const endCall = useCallback(async () => {
    try {
      await fetch("/api/call-sessions", { method: "DELETE" });
    } finally {
      setSession(null);
    }
  }, []);

  const clearSession = useCallback(() => setSession(null), []);

  return (
    <CallSessionContext.Provider
      value={{ session, now, clock, startCall, startCustomerCall, endCall, clearSession, refresh }}
    >
      {children}
    </CallSessionContext.Provider>
  );
}

export function useCallSession(): CallSessionContextValue {
  const ctx = useContext(CallSessionContext);
  if (!ctx) throw new Error("useCallSession must be used inside a CallSessionProvider");
  return ctx;
}
