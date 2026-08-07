import { uuid, nowIso, queueDelete } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { activeSuspensionOn, dateOnlyUTC } from "@/lib/schedule-access";
import { todayInTz } from "@/lib/utils";
import type { DbShape, Profile, Schedule, ScheduleStatus } from "@/lib/types";

export interface ScheduleWriteInput {
  agent_id: string;
  schedule_date: string;
  duty_start: string | null;
  duty_end: string | null;
  is_rest_day: boolean;
  remarks: string | null;
}

export type ScheduleWriteResult =
  | { ok: true; schedule: Schedule; replaced: boolean }
  | { ok: false; code: "suspended" | "validation" | "conflict"; error: string; existing?: Schedule };

function deriveStatus(input: ScheduleWriteInput): ScheduleStatus {
  return input.is_rest_day ? "rest_day" : "scheduled";
}

/** Shared create/edit/move/resize core -- enforces one-per-agent-per-date
 * (Section 0.4) with a friendly conflict result unless the caller passes
 * confirmReplace, and hard-blocks suspension dates (Section 6.4). Pass
 * `targetSchedule` when updating a specific known row (edit/move/resize);
 * omit it for a fresh create from an empty-date click. Does not call
 * writeDb(); callers persist once satisfied. */
export function upsertSchedule(
  db: DbShape,
  user: Profile,
  input: ScheduleWriteInput,
  opts: { confirmReplace?: boolean; targetSchedule?: Schedule; recurrenceGroup?: string | null } = {}
): ScheduleWriteResult {
  if (!input.agent_id || !input.schedule_date) {
    return { ok: false, code: "validation", error: "Agent and date are required." };
  }
  if (!input.is_rest_day && (!input.duty_start || !input.duty_end)) {
    return { ok: false, code: "validation", error: "Duty start and end times are required unless this is a Rest Day." };
  }

  const today = todayInTz();
  if (activeSuspensionOn(db, input.agent_id, input.schedule_date, today)) {
    return { ok: false, code: "suspended", error: "This date falls within an active suspension." };
  }

  const conflict = db.schedules.find(
    (s) => s.agent_id === input.agent_id && s.schedule_date === input.schedule_date && s !== opts.targetSchedule
  );
  if (conflict && !opts.confirmReplace) {
    return {
      ok: false,
      code: "conflict",
      error: "This agent already has a schedule on this date — replace it?",
      existing: conflict,
    };
  }

  const now = nowIso();
  const fields = {
    agent_id: input.agent_id,
    schedule_date: input.schedule_date,
    duty_start: input.is_rest_day ? null : input.duty_start,
    duty_end: input.is_rest_day ? null : input.duty_end,
    is_rest_day: input.is_rest_day,
    status: deriveStatus(input),
    remarks: input.remarks || null,
  };

  // A confirmed conflict displaces the other row entirely -- an agent can't
  // have two schedule rows on the same date.
  if (conflict && opts.confirmReplace) {
    const idx = db.schedules.indexOf(conflict);
    if (idx !== -1) {
      db.schedules.splice(idx, 1);
      queueDelete(db, "schedules", conflict.id);
    }
  }

  if (opts.targetSchedule) {
    Object.assign(opts.targetSchedule, fields, { suspension_id: null, updated_by: user.id, updated_at: now });
    return { ok: true, schedule: opts.targetSchedule, replaced: !!conflict };
  }

  const schedule: Schedule = {
    id: uuid(),
    ...fields,
    suspension_id: null,
    recurrence_group: opts.recurrenceGroup ?? null,
    created_by: user.id,
    updated_by: null,
    created_at: now,
    updated_at: null,
  };
  db.schedules.push(schedule);
  return { ok: true, schedule, replaced: !!conflict };
}

export function deleteSchedule(db: DbShape, id: string): Schedule | null {
  const idx = db.schedules.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  const [removed] = db.schedules.splice(idx, 1);
  queueDelete(db, "schedules", id);
  return removed;
}

/** Reuses notify() (Section 7: "agents are automatically notified whenever
 * their schedule is created, modified, moved, deleted, or suspended"). */
export function notifyAgentSchedule(db: DbShape, schedule: Schedule, action: "created" | "updated" | "moved" | "deleted") {
  const label = { created: "created", updated: "updated", moved: "moved", deleted: "removed" }[action];
  notify(
    db,
    [schedule.agent_id],
    "schedule_change",
    "Schedule Updated",
    `Your duty schedule for ${schedule.schedule_date} was ${label}.`,
    "/schedule"
  );
}

export interface BulkAssignSummary {
  created: number;
  skippedConflict: number;
  skippedSuspended: number;
  affectedAgentIds: string[];
}

/** Section 7: multi-assign, bulk assign, and recurring schedules are all "N
 * agents x M dates with one shared duty pattern" -- this is the shared core.
 * Conflicts are skipped (not force-replaced) unless confirmReplace is set,
 * matching the one-per-agent-per-date rule; suspension dates are always
 * skipped, never overridable from a bulk action (Section 6.4). */
export function bulkAssignSchedules(
  db: DbShape,
  user: Profile,
  input: {
    agentIds: string[];
    dates: string[];
    dutyStart: string | null;
    dutyEnd: string | null;
    isRestDay: boolean;
    remarks: string | null;
    confirmReplace?: boolean;
    recurrenceGroup?: string | null;
  }
): BulkAssignSummary {
  const summary: BulkAssignSummary = { created: 0, skippedConflict: 0, skippedSuspended: 0, affectedAgentIds: [] };
  const affected = new Set<string>();

  for (const agentId of input.agentIds) {
    for (const date of input.dates) {
      const result = upsertSchedule(
        db,
        user,
        {
          agent_id: agentId,
          schedule_date: date,
          duty_start: input.dutyStart,
          duty_end: input.dutyEnd,
          is_rest_day: input.isRestDay,
          remarks: input.remarks,
        },
        { confirmReplace: input.confirmReplace, recurrenceGroup: input.recurrenceGroup }
      );
      if (result.ok) {
        summary.created++;
        affected.add(agentId);
      } else if (result.code === "suspended") {
        summary.skippedSuspended++;
      } else if (result.code === "conflict") {
        summary.skippedConflict++;
      }
    }
  }

  summary.affectedAgentIds = Array.from(affected);
  return summary;
}

/** Copies each existing schedule in [sourceStart, sourceEnd] for the given
 * agents onto the same weekday offset starting at targetStart (Section 7:
 * "copy from a previous day, week, or month onto a target range"). */
export function copySchedules(
  db: DbShape,
  user: Profile,
  input: { agentIds: string[]; sourceStart: string; sourceEnd: string; targetStart: string; confirmReplace?: boolean }
): BulkAssignSummary {
  const summary: BulkAssignSummary = { created: 0, skippedConflict: 0, skippedSuspended: 0, affectedAgentIds: [] };
  const affected = new Set<string>();
  const offsetDays = Math.round((dateOnlyUTC(input.targetStart) - dateOnlyUTC(input.sourceStart)) / 86400000);
  const agentIdSet = new Set(input.agentIds);

  const sourceSchedules = db.schedules.filter(
    (s) =>
      agentIdSet.has(s.agent_id) &&
      s.schedule_date >= input.sourceStart &&
      s.schedule_date <= input.sourceEnd &&
      s.status !== "suspension"
  );

  for (const src of sourceSchedules) {
    const targetDate = new Date(dateOnlyUTC(src.schedule_date) + offsetDays * 86400000).toISOString().slice(0, 10);
    const result = upsertSchedule(
      db,
      user,
      {
        agent_id: src.agent_id,
        schedule_date: targetDate,
        duty_start: src.duty_start,
        duty_end: src.duty_end,
        is_rest_day: src.is_rest_day,
        remarks: src.remarks,
      },
      { confirmReplace: input.confirmReplace }
    );
    if (result.ok) {
      summary.created++;
      affected.add(src.agent_id);
    } else if (result.code === "suspended") {
      summary.skippedSuspended++;
    } else if (result.code === "conflict") {
      summary.skippedConflict++;
    }
  }

  summary.affectedAgentIds = Array.from(affected);
  return summary;
}
