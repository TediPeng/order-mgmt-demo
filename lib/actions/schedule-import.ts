"use server";

import { writeDb } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { notify } from "@/lib/notifications";
import { can } from "@/lib/permissions";
import { scopeAgentsForSchedule } from "@/lib/schedule-access";
import { upsertSchedule } from "@/lib/actions/schedules";
import { parseDateHeader, parseShiftCell } from "@/lib/schedule-import";
import type { ScheduleImportRow, ScheduleImportRowResult, ScheduleImportSummary } from "@/lib/schedule-import";
import { requireUser } from "./guards";

/** Statuses the schedule row already says by itself, so they get no remark. */
const PLAIN_STATUSES: string[] = ["ON DUTY", "OFF"];

/** "ON LEAVE" → "On Leave". The dropdown shouts; a remark should not. */
function titleCase(status: string): string {
  return status
    .toLowerCase()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Applies an uploaded roster.
 *
 * Everything the browser parsed is parsed again here — the client's version
 * exists to show a preview, not to be trusted. Agents are matched by username
 * against the accounts this user is allowed to schedule, so a row for someone
 * else's agent is reported as unrecognized rather than quietly applied.
 *
 * An uploaded roster is an instruction, so a date the agent already has is
 * REPLACED (confirmReplace), unlike the bulk-assign screen where a conflict is
 * a question. Suspension dates are the one thing it cannot overrule.
 */
export async function importSchedulesAction(
  rows: ScheduleImportRow[],
  fileName: string
): Promise<ScheduleImportSummary> {
  const { user, db } = await requireUser();
  if (!can(user.role, "schedules", "create", db.role_permissions)) {
    return {
      fileName,
      totalRows: rows.length,
      assigned: 0,
      restDays: 0,
      skippedSuspended: 0,
      unrecognizedAgents: 0,
      invalid: 0,
      results: [
        { row: 0, agent: "", category: "invalid", reason: "You do not have permission to import schedules." },
      ],
    };
  }

  // Only agents, and only the ones in this user's scope — the same rule the
  // template generator uses, so a file cannot reach further than the file it
  // came from could.
  const byUsername = new Map(
    scopeAgentsForSchedule(db, user)
      .filter((p) => p.role === "agent" && p.is_active && !p.is_deleted)
      .map((p) => [p.username.toLowerCase(), p])
  );

  // ON DUTY / HALF DAY / TRAINING are measured against the company work day,
  // read here rather than trusted from the request.
  const times = { work_start: db.work_schedule.work_start, work_end: db.work_schedule.work_end };

  const results: ScheduleImportRowResult[] = [];
  const summary = { assigned: 0, restDays: 0, skippedSuspended: 0, unrecognizedAgents: 0, invalid: 0 };
  const touchedByAgent = new Map<string, number>();

  for (const row of rows) {
    const agentKey = String(row.agent || "").trim().toLowerCase();
    const agent = byUsername.get(agentKey);
    if (!agent) {
      summary.unrecognizedAgents++;
      results.push({
        row: row.row,
        agent: row.agent,
        category: "unrecognized_agent",
        reason: `No agent account with the username '${row.agent}' that you can schedule`,
      });
      continue;
    }

    for (const cell of row.cells || []) {
      const date = parseDateHeader(cell.date);
      if (!date) {
        summary.invalid++;
        results.push({
          row: row.row,
          agent: row.agent,
          category: "invalid",
          reason: `'${cell.date}' is not a date column`,
        });
        continue;
      }

      const shift = parseShiftCell(cell.raw, times);
      if (shift.kind === "empty") continue;
      if (shift.kind === "invalid") {
        summary.invalid++;
        results.push({ row: row.row, agent: row.agent, date, category: "invalid", reason: shift.error });
        continue;
      }

      const result = upsertSchedule(
        db,
        user,
        {
          agent_id: agent.id,
          schedule_date: date,
          duty_start: shift.kind === "duty" ? shift.duty_start! : null,
          duty_end: shift.kind === "duty" ? shift.duty_end! : null,
          is_rest_day: shift.kind === "rest",
          // The schedule model has one rest-day state and one working state,
          // so On Leave / Half Day / Training survive as the remark — that is
          // what the calendar shows and what tells OFF from ON LEAVE. ON DUTY
          // and OFF are the plain states the row already expresses, so they
          // add no remark of their own.
          remarks: shift.status && !PLAIN_STATUSES.includes(shift.status) ? titleCase(shift.status) : null,
        },
        { confirmReplace: true }
      );

      if (result.ok) {
        if (shift.kind === "rest") summary.restDays++;
        else summary.assigned++;
        touchedByAgent.set(agent.id, (touchedByAgent.get(agent.id) || 0) + 1);
        results.push({ row: row.row, agent: row.agent, date, category: shift.kind === "rest" ? "rest" : "assigned" });
      } else if (result.code === "suspended") {
        summary.skippedSuspended++;
        results.push({
          row: row.row,
          agent: row.agent,
          date,
          category: "skipped_suspended",
          reason: "Date falls within an active suspension",
        });
      } else {
        summary.invalid++;
        results.push({ row: row.row, agent: row.agent, date, category: "invalid", reason: result.error });
      }
    }
  }

  // One notification per agent rather than one per day: a week's roster landing
  // as seven separate "your schedule changed" messages is noise, not news.
  for (const [agentId, count] of touchedByAgent) {
    notify(
      db,
      [agentId],
      "schedule_change",
      "Schedule Updated",
      `Your duty schedule was updated for ${count} day${count === 1 ? "" : "s"}.`,
      "/schedule"
    );
  }

  const info = await getRequestInfo();
  logActivity(
    db,
    user.id,
    "SCHEDULE_IMPORTED",
    "schedule",
    null,
    {
      file_name: fileName,
      agents: touchedByAgent.size,
      assigned: summary.assigned,
      rest_days: summary.restDays,
      skipped_suspended: summary.skippedSuspended,
      unrecognized_agents: summary.unrecognizedAgents,
      invalid: summary.invalid,
    },
    { module: "schedules", ...info }
  );
  await writeDb(db);

  return { fileName, totalRows: rows.length, ...summary, results };
}
