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

/** Accepted ways of writing "no duty this day". Case and spacing are ignored. */
const REST_WORDS = ["rest", "rest day", "restday", "rd", "off", "day off"];

export interface ShiftCell {
  kind: "empty" | "rest" | "duty" | "invalid";
  duty_start?: string;
  duty_end?: string;
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

/**
 * Reads one roster cell.
 *
 * A blank cell means "nothing said about this day" and leaves any existing
 * schedule alone — deleting a shift is not something a blank should be able to
 * do silently. Rest days are written as a word, duties as a range.
 */
export function parseShiftCell(value: unknown): ShiftCell {
  if (value === null || value === undefined) return { kind: "empty" };
  const text = String(value).trim();
  if (!text) return { kind: "empty" };

  if (REST_WORDS.includes(text.toLowerCase().replace(/\s+/g, " "))) return { kind: "rest" };

  // En dash and "to" are what people actually type; treat them as the hyphen.
  const parts = text.replace(/[–—]/g, "-").replace(/\bto\b/gi, "-").split("-");
  if (parts.length !== 2) {
    return { kind: "invalid", error: `"${text}" is not a shift — use 08:00-17:00, REST, or leave it blank` };
  }
  const start = normalizeTime(parts[0]);
  const end = normalizeTime(parts[1]);
  if (!start || !end) {
    return { kind: "invalid", error: `"${text}" is not a shift — use 24-hour times like 08:00-17:00` };
  }
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
