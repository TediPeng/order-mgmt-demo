/** Call-date parsing for agent call-log uploads.
 *
 * A missing or unreadable date is an error, never the upload date: silently
 * substituting today would file the call against the wrong day and quietly
 * corrupt an agent's daily figures.
 *
 * PH files are ambiguous between MM/DD/YYYY and DD/MM/YYYY, and a single row
 * often cannot say which. So parsing runs in two passes: the first decides the
 * convention for the whole file from the rows that can only be read one way,
 * and the second applies it. The decision is reported back so the summary can
 * state the assumption rather than hide it.
 */

export type DateOrder = "mdy" | "dmy";

export interface ParsedCallDate {
  /** YYYY-MM-DD, or null when the value cannot be read. */
  date: string | null;
  reason?: string;
}

const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const SLASH_RE = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/;

function ymd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Round-tripped through Date so 31 February is rejected rather than rolled.
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function fullYear(y: number): number {
  if (y >= 1000) return y;
  // Two-digit years: 70-99 read as 19xx, everything else as 20xx.
  return y >= 70 ? 1900 + y : 2000 + y;
}

/** Excel stores dates as days since 1899-12-30 (its epoch, including the
 * deliberate 1900 leap-year bug). Values arrive as bare numbers when a sheet
 * is read without date formatting. */
function fromExcelSerial(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 80000) return null;
  const ms = Math.round(serial) * 86400000;
  const dt = new Date(Date.UTC(1899, 11, 30) + ms);
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Which way round a slash date could be read. */
function classify(raw: string): { a: number; b: number; y: number } | null {
  const m = SLASH_RE.exec(raw.trim());
  if (!m) return null;
  return { a: Number(m[1]), b: Number(m[2]), y: fullYear(Number(m[3])) };
}

/** Decides the file's convention from the rows that are unambiguous: a part
 * above 12 can only be the day. Ties fall back to MM/DD/YYYY, the more common
 * export format, and the caller states the assumption. */
export function detectDateOrder(values: string[]): DateOrder {
  let mdy = 0;
  let dmy = 0;
  for (const v of values) {
    const c = classify(String(v ?? ""));
    if (!c) continue;
    if (c.a > 12 && c.b <= 12) dmy++;
    else if (c.b > 12 && c.a <= 12) mdy++;
  }
  return dmy > mdy ? "dmy" : "mdy";
}

export function parseCallDate(raw: unknown, order: DateOrder): ParsedCallDate {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return { date: null, reason: "Call date is required" };
  }

  // Already a real date (xlsx can hand back Date objects).
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return { date: ymd(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate()), reason: undefined };
  }

  const text = String(raw).trim();

  const iso = ISO_RE.exec(text);
  if (iso) {
    const date = ymd(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return date ? { date } : { date: null, reason: `Not a real date: ${text}` };
  }

  const parts = classify(text);
  if (parts) {
    const { a, b, y } = parts;
    // An out-of-range part settles the reading regardless of the file's
    // convention — 25/12 can only be day-first however the rest of the file reads.
    let month: number;
    let day: number;
    if (a > 12 && b <= 12) {
      day = a;
      month = b;
    } else if (b > 12 && a <= 12) {
      month = a;
      day = b;
    } else if (order === "dmy") {
      day = a;
      month = b;
    } else {
      month = a;
      day = b;
    }
    const date = ymd(y, month, day);
    return date ? { date } : { date: null, reason: `Not a real date: ${text}` };
  }

  if (/^\d+(\.\d+)?$/.test(text)) {
    const date = fromExcelSerial(Number(text));
    return date ? { date } : { date: null, reason: `Unreadable date: ${text}` };
  }

  // Last resort: let the runtime try (e.g. "March 3, 2026"). Rejected unless
  // it yields a real date, so nothing unreadable slips through as today.
  const parsed = new Date(text);
  if (!isNaN(parsed.getTime())) {
    return { date: ymd(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate()) };
  }

  return { date: null, reason: `Unreadable date: ${text}` };
}
