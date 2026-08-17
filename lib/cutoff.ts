/**
 * Payroll cut-offs: the 13th to the 27th, then the 28th to the 12th.
 *
 * The floor plans and reads duty in cut-offs, not in calendar months — a month
 * view splits every second period in half, which is why the schedule was being
 * kept in a spreadsheet alongside the app. A cut-off is 15 days in the first
 * half and 15 or 16 in the second, depending on the length of the month it
 * starts in; nothing here assumes a fixed width.
 *
 * All arithmetic is UTC on YYYY-MM-DD strings, matching resolveDateRange() in
 * lib/performance.ts. These are calendar dates, not instants — a local-time
 * Date would shift the 13th to the 12th for anyone west of Greenwich.
 */

export interface Cutoff {
  /** YYYY-MM-DD, the 13th or the 28th. */
  start: string;
  /** YYYY-MM-DD, the 27th or the 12th. Inclusive. */
  end: string;
  /** "Jun 13 – Jun 27, 2026" */
  label: string;
  /** "Jun 13 – 27" — for a tab or a heading with no room. */
  shortLabel: string;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parse(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function addDays(date: string, days: number): string {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + days);
  return ymd(d);
}

/** The first day of the cut-off that contains this date. */
export function cutoffStartFor(date: string): string {
  const d = parse(date);
  const day = d.getUTCDate();
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (day >= 28) return ymd(new Date(Date.UTC(y, m, 28)));
  if (day >= 13) return ymd(new Date(Date.UTC(y, m, 13)));
  // On or before the 12th the period began on the 28th of the month before.
  // Date.UTC normalises a month of -1 into December of the previous year.
  return ymd(new Date(Date.UTC(y, m - 1, 28)));
}

function endFor(start: string): string {
  const d = parse(start);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  // The 13th closes on the 27th of the same month; the 28th runs into the next.
  return d.getUTCDate() === 13 ? ymd(new Date(Date.UTC(y, m, 27))) : ymd(new Date(Date.UTC(y, m + 1, 12)));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Jun 13" */
export function shortDate(date: string): string {
  const d = parse(date);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Mon, Tue … — the day of the week, for the second header row. */
export function weekdayOf(date: string): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][parse(date).getUTCDay()];
}

export function isWeekend(date: string): boolean {
  const day = parse(date).getUTCDay();
  return day === 0 || day === 6;
}

export function cutoffFor(date: string): Cutoff {
  const start = cutoffStartFor(date);
  const end = endFor(start);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return {
    start,
    end,
    label: `${shortDate(start)} – ${shortDate(end)}, ${end.slice(0, 4)}`,
    shortLabel: sameMonth ? `${shortDate(start)} – ${parse(end).getUTCDate()}` : `${shortDate(start)} – ${shortDate(end)}`,
  };
}

/** The cut-off before or after this one. */
export function shiftCutoff(cutoff: Cutoff, delta: number): Cutoff {
  // One day either side of the period lands inside its neighbour, whatever the
  // length of the month — safer than adding 15 days and hoping.
  const anchor = delta < 0 ? addDays(cutoff.start, -1) : addDays(cutoff.end, 1);
  const next = cutoffFor(anchor);
  return Math.abs(delta) <= 1 ? next : shiftCutoff(next, delta > 0 ? delta - 1 : delta + 1);
}

/** Every date in the period, in order. */
export function datesIn(cutoff: Cutoff): string[] {
  const out: string[] = [];
  for (let d = cutoff.start; d <= cutoff.end; d = addDays(d, 1)) out.push(d);
  return out;
}
