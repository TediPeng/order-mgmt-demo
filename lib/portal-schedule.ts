import "server-only";

import type { CellStatus } from "@/lib/duty-status";

/**
 * The roster built here, carried to the company portal.
 *
 * This is the last of the three, and the one with the most hanging off it. The
 * portal's scheduled_window is what prices a day — the scheduled hours, the
 * grace minutes, the break — and since the clock moved back to ROMA it is also
 * what decides whether the clock opens at all: clock_in_for refuses a day the
 * roster there calls a rest day. So a Saturday given off on this grid and
 * unknown there is not a counting error. It is somebody standing at a screen
 * that will not let them start.
 *
 * Sent by comparison rather than on every edit. The roster is written from a
 * grid, a roster builder, a spreadsheet import, a bulk assign, a copy of last
 * week and the suspension form — six doors, and hooking all six would mean six
 * chances to forget one. Asking what the portal currently has and sending the
 * difference cannot miss a door, and it heals whatever an earlier failure left
 * behind.
 *
 * That comparison also settles which side wins for these people: ROMA does. A
 * retention agent's day changed in the portal is overwritten at the next sweep.
 * That has to be a rule somebody chose rather than a race, and this is where it
 * is written down.
 */

/** Off unless explicitly on, so a missing variable changes nothing. */
export function portalOwnsRosterSync(): boolean {
  return process.env.PORTAL_SCHEDULE === "on";
}

/**
 * ROMA's duty statuses in the portal's own vocabulary.
 *
 * Two are deliberately absent.
 *
 * ON LEAVE is not sent because the portal already owns it: an approved leave
 * request writes the roster day itself, and set_employee_shift_for refuses to
 * write over one. Sending it would be this app asking to do something the
 * request has already done properly.
 *
 * SUSPENDED is not sent because neither department offers a `suspended` shift,
 * and inventing one here would be adding a policy to the portal through a side
 * door. The suspension already does its work on this side: ROMA's own time-in
 * gate refuses the day, so no time-in reaches the portal, and a day nobody
 * clocked is not a day anybody is paid for.
 */
const SHIFT_CODE: Partial<Record<CellStatus, string>> = {
  "ON DUTY": "on_duty",
  OFF: "day_off",
  "HALF DAY": "half_day",
  TRAINING: "training",
};

export function shiftCodeFor(status: CellStatus): string | null {
  return SHIFT_CODE[status] ?? null;
}

export interface RosterDay {
  romaProfileId: string;
  date: string;
  shiftCode: string;
}

export interface RosterResult {
  date: string;
  romaProfileId: string;
  status: string;
  reason?: string;
}

const TIMEOUT_MS = 8000;

function endpoint(): { url: string; secret: string } | null {
  const base = process.env.PORTAL_APP_URL;
  const secret = process.env.PORTAL_API_SECRET;
  if (!base || !secret) {
    console.error("[portal-schedule] PORTAL_APP_URL or PORTAL_API_SECRET is not set");
    return null;
  }
  return { url: `${base.replace(/\/+$/, "")}/api/roma/schedule`, secret };
}

/**
 * What the portal's roster currently says, keyed `profileId|date`.
 *
 * Null means no answer, which is not an empty roster: acting on an empty answer
 * would mean rewriting every day in the window on the strength of a failed
 * read.
 */
export async function fetchPortalRoster(from: string, to: string): Promise<Map<string, string> | null> {
  const target = endpoint();
  if (!target) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${target.url}?from=${from}&to=${to}`, {
      headers: { Authorization: `Bearer ${target.secret}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error("[portal-schedule] roster read answered %s", res.status);
      return null;
    }
    const body = (await res.json()) as { days?: RosterDay[] };
    if (!Array.isArray(body?.days)) return null;

    const out = new Map<string, string>();
    for (const day of body.days) {
      if (!day?.romaProfileId || !day?.date) continue;
      out.set(`${day.romaProfileId}|${day.date}`, String(day.shiftCode));
    }
    return out;
  } catch (error) {
    const detail = error instanceof Error && error.name === "AbortError" ? "timed out" : String(error);
    console.error("[portal-schedule] roster read failed: %s", detail);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function pushPortalRoster(days: RosterDay[]): Promise<RosterResult[] | null> {
  if (days.length === 0) return [];
  const target = endpoint();
  if (!target) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(target.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${target.secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ days }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error("[portal-schedule] roster push answered %s", res.status);
      return null;
    }
    const body = (await res.json()) as { results?: RosterResult[] };
    return Array.isArray(body?.results) ? body.results : [];
  } catch (error) {
    const detail = error instanceof Error && error.name === "AbortError" ? "timed out" : String(error);
    console.error("[portal-schedule] roster push failed: %s", detail);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
