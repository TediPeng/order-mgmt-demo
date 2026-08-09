/**
 * The schedule roster import — one shared definition of the file's shape, used
 * by the template that generates it, the browser that reads it back, and the
 * server action that trusts none of it and re-validates anyway.
 *
 * Shape: a WEEKLY ROSTER, not one row per shift. Rows are agents (the template
 * arrives with their accounts already filled in, which is the whole point —
 * nobody should be typing usernames), columns are dates, and each cell is that
 * agent's duty for that day:
 *
 *   Agent        | Agent Name   | 2026-08-11 (Tue) | 2026-08-12 (Wed) | …
 *   ROMA_jamie   | Jamie Santos | 08:00-17:00      | REST             | …
 *
 * That is how a duty schedule is actually drawn up on paper, and it keeps the
 * file to one line per agent instead of one line per agent per day.
 *
 * The date columns are read from the header rather than assumed, so a file may
 * cover a week, a fortnight or a single day without the importer caring. The
 * weekday in brackets is decoration for the person filling it in; only the
 * leading YYYY-MM-DD is parsed.
 */

export const SCHEDULE_IMPORT_AGENT_HEADER = "Agent";
export const SCHEDULE_IMPORT_NAME_HEADER = "Agent Name";

/**
 * The five duty statuses, as the client already writes them in their own
 * roster. These are the dropdown options in the template, in this order, and
 * the colours match what they use on paper: on duty green, off red.
 */
export const DUTY_STATUSES = ["ON DUTY", "HALF DAY", "ON LEAVE", "OFF", "TRAINING"] as const;
export type DutyStatus = (typeof DUTY_STATUSES)[number];

/** argb fills for the template's conditional formatting, so a cell colours
 * itself the moment a status is picked. */
export const DUTY_STATUS_COLORS: Record<DutyStatus, { fill: string; font: string }> = {
  "ON DUTY": { fill: "FF15803D", font: "FFFFFFFF" },
  "HALF DAY": { fill: "FFF59E0B", font: "FF1F2937" },
  "ON LEAVE": { fill: "FF3B82F6", font: "FFFFFFFF" },
  OFF: { fill: "FFDC2626", font: "FFFFFFFF" },
  TRAINING: { fill: "FF7C3AED", font: "FFFFFFFF" },
};

/** Spellings that mean the same status. Everything is compared lower-case with
 * runs of whitespace collapsed, so "On  Duty" and "ON DUTY" agree. */
const STATUS_ALIASES: Record<string, DutyStatus> = {
  "on duty": "ON DUTY",
  duty: "ON DUTY",
  onduty: "ON DUTY",
  "half day": "HALF DAY",
  halfday: "HALF DAY",
  half: "HALF DAY",
  "on leave": "ON LEAVE",
  leave: "ON LEAVE",
  onleave: "ON LEAVE",
  off: "OFF",
  rest: "OFF",
  "rest day": "OFF",
  restday: "OFF",
  rd: "OFF",
  "day off": "OFF",
  training: "TRAINING",
  train: "TRAINING",
};

/** The company work day a status is measured against. */
export interface WorkDayTimes {
  work_start: string; // HH:mm
  work_end: string; // HH:mm
}

export interface ShiftCell {
  kind: "empty" | "rest" | "duty" | "invalid";
  duty_start?: string;
  duty_end?: string;
  /** The status this cell resolved to, kept for the preview and for the
   * schedule's remarks — "OFF" and "ON LEAVE" both produce a rest day, and the
   * remark is what tells them apart afterwards. */
  status?: DutyStatus;
  /** Set when kind is "invalid" — shown against the offending cell. */
  error?: string;
}

/** Normalises "8:5" → "08:05" and rejects anything outside a 24-hour clock. */
function normalizeTime(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})\s*[:.]\s*(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Half a work day, rounded to the minute: start → the midpoint between start
 * and end. An overnight span is treated as crossing midnight. */
function halfDayEnd(times: WorkDayTimes): string {
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const start = toMin(times.work_start);
  const end = toMin(times.work_end);
  const span = (end - start + 1440) % 1440;
  const mid = (start + Math.round(span / 2)) % 1440;
  return `${String(Math.floor(mid / 60)).padStart(2, "0")}:${String(mid % 60).padStart(2, "0")}`;
}

/** What each dropdown status means as an actual schedule row. */
export function shiftForStatus(status: DutyStatus, times: WorkDayTimes): ShiftCell {
  switch (status) {
    case "OFF":
    case "ON LEAVE":
      // Both are "not working"; the status rides along so the remark can say
      // which, since the schedule model has one rest-day state, not two.
      return { kind: "rest", status };
    case "HALF DAY":
      return { kind: "duty", status, duty_start: times.work_start, duty_end: halfDayEnd(times) };
    default:
      // ON DUTY and TRAINING are both a full day at the company's hours.
      return { kind: "duty", status, duty_start: times.work_start, duty_end: times.work_end };
  }
}

/**
 * Reads one roster cell.
 *
 * The template hands the person a dropdown of the five statuses, so that is
 * the expected content. Explicit times (08:00-17:00) are still accepted, for a
 * shift that does not follow the company hours and for files written before
 * the dropdown existed.
 *
 * A blank cell means "nothing said about this day" and leaves any existing
 * schedule alone — deleting a shift is not something a blank should be able to
 * do silently.
 */
export function parseShiftCell(value: unknown, times: WorkDayTimes): ShiftCell {
  if (value === null || value === undefined) return { kind: "empty" };
  const text = String(value).trim();
  if (!text) return { kind: "empty" };

  const status = STATUS_ALIASES[text.toLowerCase().replace(/\s+/g, " ")];
  if (status) return shiftForStatus(status, times);

  // En dash and "to" are what people actually type; treat them as the hyphen.
  const parts = text.replace(/[–—]/g, "-").replace(/\bto\b/gi, "-").split("-");
  const unrecognised = `"${text}" is not one of ${DUTY_STATUSES.join(", ")} — pick from the dropdown, or write times like 08:00-17:00`;
  if (parts.length !== 2) return { kind: "invalid", error: unrecognised };
  const start = normalizeTime(parts[0]);
  const end = normalizeTime(parts[1]);
  if (!start || !end) return { kind: "invalid", error: unrecognised };
  // An overnight shift (22:00-06:00) is legitimate, so end-before-start is not
  // an error; only an exact match is, since a zero-length duty is a typo.
  if (start === end) return { kind: "invalid", error: `"${text}" starts and ends at the same time` };
  return { kind: "duty", duty_start: start, duty_end: end };
}

/** `2026-08-11 (Tue)` → `2026-08-11`; anything without a leading date → null. */
export function parseDateHeader(header: unknown): string | null {
  const text = String(header ?? "").trim();
  const m = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!m) return null;
  const [y, mo, d] = m[1].split("-").map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  // Rejects 2026-02-31 and friends, which would otherwise roll over silently.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return m[1];
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function dateHeaderLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${ymd} (${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}

/** One agent's row as the client hands it to the server. Times are already
 * parsed, but the server re-parses from `raw` and ignores these — they exist so
 * the preview can show what will happen before anything is sent. */
export interface ScheduleImportCell {
  date: string;
  raw: string;
}

export interface ScheduleImportRow {
  /** Spreadsheet row number, for error reporting. */
  row: number;
  agent: string;
  cells: ScheduleImportCell[];
}

export interface ScheduleImportRowResult {
  row: number;
  agent: string;
  date?: string;
  category: "assigned" | "rest" | "skipped_suspended" | "unrecognized_agent" | "invalid";
  reason?: string;
}

export interface ScheduleImportSummary {
  fileName: string;
  totalRows: number;
  assigned: number;
  restDays: number;
  skippedSuspended: number;
  unrecognizedAgents: number;
  invalid: number;
  results: ScheduleImportRowResult[];
}
