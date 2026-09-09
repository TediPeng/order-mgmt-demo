import "server-only";

import { envFlagIsOn } from "@/lib/env-flag";

/**
 * Leave filed here, decided in the company portal.
 *
 * The filing belongs here: this is the screen an agent has open all day, and
 * sending them to a second application to ask for a Saturday off was a tax on
 * every request. The decision does not, and the reason is not deference — it is
 * that the rules are there and cannot be honestly copied.
 *
 * The portal's decide_request enforces a cap on how many people may be off on
 * the same day, and when the last free day goes it automatically trims or
 * refuses everybody else's pending request for it. It refuses to let anybody
 * decide their own. And approving writes the roster day, which is what makes
 * payroll stop counting the day as unworked. A second implementation of that on
 * this side would be a second opinion about somebody's pay, and the two would
 * disagree the first time either changed.
 *
 * So: filing crosses immediately, and the answer is read back by
 * /api/cron/portal-leave-sync. Pulled rather than pushed — asking again is free,
 * while a push that fails once is a decision nobody ever hears about.
 */

/**
 * Is the portal deciding leave yet?
 *
 * A switch, not a deploy, for the same reason PORTAL_ATTENDANCE is one: turning
 * it on changes what every supervisor may do, and turning it back off must not
 * need a build. Off unless explicitly on.
 */
export function portalOwnsLeave(): boolean {
  return envFlagIsOn("PORTAL_LEAVE");
}

export type LeaveFiling =
  /** The portal opened a request; this is its id. */
  | { status: "ok"; requestId: string }
  /** Nobody there is linked to this account, so there is no employee to be off. */
  | { status: "skipped"; detail: string }
  /** It never arrived. The filing stands here and the sweep will carry it. */
  | { status: "unsent"; detail: string };

const TIMEOUT_MS = 5000;

function endpoint(): { url: string; secret: string } | null {
  const base = process.env.PORTAL_APP_URL;
  const secret = process.env.PORTAL_API_SECRET;
  if (!base || !secret) {
    console.error("[portal-leave] PORTAL_APP_URL or PORTAL_API_SECRET is not set");
    return null;
  }
  return { url: `${base.replace(/\/+$/, "")}/api/roma/leave`, secret };
}

export async function fileLeaveInPortal(input: {
  romaProfileId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string;
}): Promise<LeaveFiling> {
  const target = endpoint();
  if (!target) return { status: "unsent", detail: "not_configured" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(target.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${target.secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error("[portal-leave] portal answered %s", res.status);
      return { status: "unsent", detail: `http_${res.status}` };
    }

    const body = (await res.json()) as { requestId?: string; skipped?: string };
    if (body?.skipped) return { status: "skipped", detail: body.skipped };
    if (!body?.requestId) return { status: "unsent", detail: "no_request_id" };
    return { status: "ok", requestId: body.requestId };
  } catch (error) {
    const detail = error instanceof Error && error.name === "AbortError" ? "timed_out" : String(error);
    console.error("[portal-leave] filing not mirrored: %s", detail);
    return { status: "unsent", detail };
  } finally {
    clearTimeout(timer);
  }
}

export interface PortalLeaveDecision {
  id: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  decidedAt: string | null;
  note: string | null;
}

/**
 * What the portal has decided about the requests still open here.
 *
 * Returns null on any failure, which is not the same as an empty list: an empty
 * list would say every request is still pending, and acting on that would mean
 * telling agents nothing has been decided when it has.
 */
export async function fetchLeaveDecisions(ids: string[]): Promise<PortalLeaveDecision[] | null> {
  if (ids.length === 0) return [];
  const target = endpoint();
  if (!target) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${target.url}?ids=${encodeURIComponent(ids.join(","))}`, {
      headers: { Authorization: `Bearer ${target.secret}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error("[portal-leave] decisions read answered %s", res.status);
      return null;
    }
    const body = (await res.json()) as { decisions?: PortalLeaveDecision[] };
    return Array.isArray(body?.decisions) ? body.decisions : null;
  } catch (error) {
    const detail = error instanceof Error && error.name === "AbortError" ? "timed out" : String(error);
    console.error("[portal-leave] decisions read failed: %s", detail);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
