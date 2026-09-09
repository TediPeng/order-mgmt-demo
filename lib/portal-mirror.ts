import "server-only";

/**
 * Telling the company portal that somebody clocked on or off here.
 *
 * The exact counterpart of what the portal already does to us in
 * /api/portal/attendance, pointing the other way. Agents time in on ROMA again
 * because this is the screen they have open all day — but the portal is still
 * what pays them, so the fact has to arrive there or the day is worked and not
 * paid.
 *
 * That is not hypothetical. Four time-ins went into ROMA and never reached the
 * portal between 28 and 31 August, because a guard depended on a variable
 * nobody had set. This is the bridge that failure asked for.
 *
 * Unlike the portal's mirror, this one is NOT best-effort, and the difference
 * matters: over there, ROMA's copy feeds a board, so losing one costs a supervisor
 * a glance. Here, the copy is the pay record. So the caller waits for the
 * answer, the agent is told when the portal refuses, and anything that never
 * arrived is swept up later by /api/cron/portal-attendance-sync.
 *
 * The portal decides. It is stricter than ROMA — it will not clock somebody on
 * for a rostered day off, or in a department that keeps a manual time card —
 * and it says so in its own words, which are passed back untouched rather than
 * reworded here into something that would drift.
 */

export type PortalMirror =
  /** The portal recorded it. */
  | { status: "ok" }
  /** The portal already had it, or had nothing to close. Nothing to do. */
  | { status: "skipped"; detail: string }
  /** The portal declined, and the agent needs to read why. */
  | { status: "refused"; reason: string }
  /** It never got there. Not the agent's problem; the sweep will carry it. */
  | { status: "unsent"; detail: string };

/** Long enough for a cold start on the other side, short enough that nobody standing at a clock notices. */
const TIMEOUT_MS = 5000;

export async function mirrorToPortal(
  romaProfileId: string,
  event: "time_in" | "time_out"
): Promise<PortalMirror> {
  const base = process.env.PORTAL_APP_URL;
  const secret = process.env.PORTAL_API_SECRET;

  // Configuration, not circumstance — and reported as unsent rather than
  // swallowed, because the sweep can do nothing about it either and somebody
  // has to see it. The last time a missing variable was treated as "fine", it
  // cost four days of attendance.
  if (!base || !secret) {
    console.error("[portal-mirror] PORTAL_APP_URL or PORTAL_API_SECRET is not set; %s not mirrored", event);
    return { status: "unsent", detail: "not_configured" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/api/roma/attendance`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ romaProfileId, event }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error("[portal-mirror] portal answered %s for %s", res.status, event);
      return { status: "unsent", detail: `http_${res.status}` };
    }

    const body = (await res.json()) as { ok?: boolean; skipped?: string; reason?: string };

    if (body?.skipped === "refused") {
      // The portal's own sentence, carried to the agent unchanged.
      return { status: "refused", reason: body.reason || "The company portal would not accept this time in." };
    }
    if (body?.skipped) {
      return { status: "skipped", detail: body.skipped };
    }
    return { status: "ok" };
  } catch (error) {
    const detail = error instanceof Error && error.name === "AbortError" ? "timed_out" : String(error);
    console.error("[portal-mirror] %s not mirrored: %s", event, detail);
    return { status: "unsent", detail };
  } finally {
    clearTimeout(timer);
  }
}
