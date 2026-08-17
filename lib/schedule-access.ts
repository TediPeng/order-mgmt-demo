import type { DbShape, Profile, Schedule, Suspension, SuspensionStatus } from "./types";
import { isFullAccess } from "./permissions";

export function scheduleInScope(user: Profile, schedule: Schedule, db: DbShape): boolean {
  if (isFullAccess(user.role)) return true;
  if (user.role === "team_lead") {
    const owner = db.profiles.find((p) => p.id === schedule.agent_id);
    return schedule.agent_id === user.id || owner?.team_lead_id === user.id;
  }
  return schedule.agent_id === user.id;
}

export function scopeSchedules(user: Profile, schedules: Schedule[], db: DbShape): Schedule[] {
  if (isFullAccess(user.role)) return schedules;
  return schedules.filter((s) => scheduleInScope(user, s, db));
}

export function suspensionInScope(user: Profile, suspension: Suspension, db: DbShape): boolean {
  if (isFullAccess(user.role)) return true;
  if (user.role === "team_lead") {
    const owner = db.profiles.find((p) => p.id === suspension.employee_id);
    return suspension.employee_id === user.id || owner?.team_lead_id === user.id;
  }
  return suspension.employee_id === user.id;
}

export function scopeSuspensions(user: Profile, suspensions: Suspension[], db: DbShape): Suspension[] {
  if (isFullAccess(user.role)) return suspensions;
  return suspensions.filter((s) => suspensionInScope(user, s, db));
}

/** Which agents a user may view/assign schedules for (mirrors allowedAssigneeIds in order-access.ts). */
export function scopeAgentsForSchedule(db: DbShape, user: Profile): Profile[] {
  if (isFullAccess(user.role)) return db.profiles.filter((p) => p.is_active);
  if (user.role === "team_lead") {
    return db.profiles.filter((p) => p.is_active && (p.id === user.id || p.team_lead_id === user.id));
  }
  return db.profiles.filter((p) => p.id === user.id);
}

/**
 * Who appears on the duty roster.
 *
 * Narrower than scopeAgentsForSchedule, and deliberately not a replacement for
 * it: that function answers "whose schedule may this person write", which still
 * has to cover a Team Lead's own row and anyone else the API might legitimately
 * be asked to schedule. This answers "who is on the floor", which is the
 * question the grid is showing — so Administrators, Team Leads and test
 * accounts are left out. Rows for them were all dashes anyway; they only ever
 * made the roster longer than the floor.
 */
export function rosterAgents(db: DbShape, user: Profile): Profile[] {
  return scopeAgentsForSchedule(db, user).filter(
    (p) => p.role === "agent" && !p.is_test_account && !p.is_deleted
  );
}

export function dateOnlyUTC(d: string): number {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}

export function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function eachDateInclusive(start: string, end: string): string[] {
  const dates: string[] = [];
  const startMs = dateOnlyUTC(start);
  const endMs = dateOnlyUTC(end);
  for (let t = startMs; t <= endMs; t += 86400000) dates.push(new Date(t).toISOString().slice(0, 10));
  return dates;
}

export function computeSuspensionEndDate(startDate: string, durationDays: number): string {
  return addDaysToYmd(startDate, durationDays - 1);
}

/** Section 6.6: status "flips to completed by date; no manual cleanup" --
 * derived at read time instead of needing a background sweep. */
export function effectiveSuspensionStatus(s: Suspension, today: string): SuspensionStatus {
  if (s.status === "lifted") return "lifted";
  if (s.end_date < today) return "completed";
  return "active";
}

export function isDateWithinSuspension(s: Suspension, date: string, today: string): boolean {
  return effectiveSuspensionStatus(s, today) === "active" && date >= s.start_date && date <= s.end_date;
}

/** The active suspension (if any) covering this agent on this date -- used to
 * block scheduling/time-in (Section 0.2, Section 6.4). */
export function activeSuspensionOn(db: DbShape, agentId: string, date: string, today: string): Suspension | null {
  return (
    db.suspensions.find((s) => s.employee_id === agentId && isDateWithinSuspension(s, date, today)) || null
  );
}

export function dayOfWeekLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}
