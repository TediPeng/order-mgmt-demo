import type { AttendanceStatus } from "./types";

/**
 * Attendance, as the company portal now keeps it.
 *
 * The clock moved. Agents time in and out in the portal, which is also what
 * pays them, so there is one record of a day's work rather than two that have
 * to agree. This is how the floor's own screens get at it.
 *
 * ROMA still owns everything about a call: sessions, bio breaks, suspensions
 * and who is on the phone right now. The portal has no idea about any of that,
 * and the board still works it out here -- this only replaces where "did they
 * time in, and when" comes from.
 *
 * Reads are best-effort by design. The portal being unreachable must not take
 * the monitor down with it: a board with no attendance is worse than yesterday's
 * board, but a board that will not load at all is worse than both. Callers get
 * null and decide.
 */

export interface PortalAttendanceDay {
  timeIn: string | null;
  timeOut: string | null;
  status: AttendanceStatus;
  breakMinutes: number | null;
  /** Null when they have not gone yet. The portal has a real break clock since its migration 097. */
  breakStart: string | null;
  /** Null while the break is still running. */
  breakEnd: string | null;
  overBreakMinutes: number | null;
  scheduledTimeIn: string | null;
  scheduledTimeOut: string | null;
  workedMinutes: number | null;
  lateMinutes: number | null;
  undertimeMinutes: number | null;
  overtimeMinutes: number | null;
}

export interface PortalAttendanceResponse {
  date: string;
  generatedAt: string;
  /** False if the portal cannot answer whether somebody is on a break. True since its migration 097. */
  breakClockSupported: boolean;
  agents: { romaProfileId: string; attendance: PortalAttendanceDay | null }[];
}

/**
 * Is the portal the source of attendance yet?
 *
 * A switch rather than a deploy, because turning this on changes what every
 * supervisor sees at once and turning it back off must not need a build. Off
 * unless explicitly on: a missing variable in some environment nobody thought
 * about should leave ROMA reading its own table, which is the behaviour that
 * has always worked.
 */
export function portalOwnsAttendance(): boolean {
  return process.env.PORTAL_ATTENDANCE === "on";
}

/** How long to wait on the portal before giving up and drawing the board without it. */
const TIMEOUT_MS = 4000;

/**
 * One day's attendance for everybody linked, keyed by ROMA profile id.
 *
 * Returns null if the portal is not configured, is unreachable, or answers with
 * anything unexpected. Null means "no answer", which is not the same as an
 * empty map -- an empty map would say nobody is at work today.
 */
export async function fetchPortalAttendance(
  date: string
): Promise<Map<string, PortalAttendanceDay | null> | null> {
  const base = process.env.PORTAL_APP_URL;
  const secret = process.env.PORTAL_API_SECRET;

  if (!base || !secret) {
    console.error("[portal-attendance] PORTAL_APP_URL or PORTAL_API_SECRET is not set");
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/api/roma/attendance?date=${encodeURIComponent(date)}`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error("[portal-attendance] portal answered %s", res.status);
      return null;
    }

    const body = (await res.json()) as PortalAttendanceResponse;

    // Checked rather than trusted: this crosses a network from another
    // application, and a shape change there should degrade this board rather
    // than throw inside a render.
    if (!Array.isArray(body?.agents)) {
      console.error("[portal-attendance] unexpected shape from the portal");
      return null;
    }

    // The portal answers for the day it was asked about. If it disagrees, the
    // two have different ideas about when a day starts, and drawing one day's
    // board from another day's data is worse than drawing none.
    if (body.date !== date) {
      console.error("[portal-attendance] asked for %s, got %s", date, body.date);
      return null;
    }

    return new Map(body.agents.map((a) => [a.romaProfileId, a.attendance]));
  } catch (error) {
    // An abort is the timeout above, not a fault worth a stack trace.
    const reason = error instanceof Error && error.name === "AbortError" ? "timed out" : String(error);
    console.error("[portal-attendance] read failed: %s", reason);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
