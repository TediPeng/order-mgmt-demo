import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(n);
}

const TZ = process.env.APP_TIMEZONE || "Asia/Manila";

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: TZ,
  }).format(new Date(iso));
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-PH", { timeStyle: "short", timeZone: TZ }).format(new Date(iso));
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: TZ }).format(new Date(iso));
}

/** YYYY-MM-DD for the given instant (defaults to now) in the app timezone. */
export function dateInTz(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map: Record<string, string> = {};
  parts.forEach((p) => (map[p.type] = p.value));
  return `${map.year}-${map.month}-${map.day}`;
}

export function todayInTz(): string {
  return dateInTz(new Date());
}

/** The app timezone, for the few callers that must hand it to the database. */
export const APP_TIMEZONE = TZ;

/** How far `timeZone` is ahead of UTC at a given instant, in milliseconds. */
function offsetMsAt(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;
  // The wall clock re-read as if it were UTC; the difference from the real
  // instant is the offset. `hour` comes back as 24 at midnight under hour12
  // false, which would roll the date forward.
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - utcMs;
}

/**
 * The instant midnight begins, in the app timezone, for a YYYY-MM-DD.
 *
 * A calendar date and a timestamp are different things, and the gap between
 * them is eight hours here. Filtering `started_at >= '2026-08-21T00:00:00Z'`
 * for the Manila day 2026-08-21 asks for the window that opens at 08:00 Manila
 * — so a call placed at 07:12 was silently dropped from that day's totals,
 * while calls after midnight were counted into the day before. On the floor
 * that cost five to eleven calls a day; on an earlier shift it would cost the
 * first hour of everybody's morning.
 *
 * Measured twice: the second pass re-reads the offset at the instant the first
 * pass produced, so a date that lands on a daylight-saving change resolves to
 * the offset actually in force. The Philippines has no DST, but this is the
 * kind of thing that is wrong for a year before anyone notices.
 */
export function startOfDayUtc(ymd: string, timeZone: string = TZ): string {
  const naive = Date.parse(`${ymd}T00:00:00Z`);
  let ms = naive - offsetMsAt(naive, timeZone);
  ms = naive - offsetMsAt(ms, timeZone);
  return new Date(ms).toISOString();
}

/**
 * The half-open UTC window covering whole local days, `from` to `to` inclusive.
 *
 * Half-open on purpose: the end is the next day's midnight rather than
 * 23:59:59, which as a `<=` bound also threw away anything in the final second
 * of the day.
 */
export function dayRangeUtc(from: string, to: string = from, timeZone: string = TZ): { start: string; endExclusive: string } {
  const next = new Date(Date.parse(`${to}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return { start: startOfDayUtc(from, timeZone), endExclusive: startOfDayUtc(next, timeZone) };
}

/**
 * A number an agent can recognise but cannot dial.
 *
 * The board only knows about a call because the agent pressed Start, so a
 * number read straight off the leads list and dialled by hand is invisible to
 * it — the agent reads as Standby for the length of the conversation. The one
 * phone log we can check against showed an agent making 177 calls on a day the
 * app recorded none.
 *
 * Nothing in a browser can stop somebody dialling a number they can see, so the
 * number is what is withheld until a call is open. The last four digits stay so
 * a row is still identifiable at a glance — which is what the column is for
 * when nobody is calling.
 */
export function maskPhone(phone: string): string {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length < 4) return "•••••";
  return `••• ••• ${digits.slice(-4)}`;
}

/** Strips everything but digits and treats a leading 0 the same as +63/63 (PH trunk prefix), so 0917... and +63917... compare equal. */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("63")) return digits.slice(2);
  if (digits.startsWith("0")) return digits.slice(1);
  return digits;
}

/** Restores the trunk "0" Excel drops from a phone typed as a number.
 *
 * A spreadsheet treats 09955853393 as numeric and stores 9955853393, losing
 * the leading zero before the file ever reaches us. A bare 10-digit PH mobile
 * begins with 9, so the missing prefix is unambiguous and is restored; anything
 * else is returned untouched rather than guessed at. */
export function restoreTrunkZero(phone: string): string {
  const trimmed = phone.trim();
  return /^9\d{9}$/.test(trimmed) ? `0${trimmed}` : trimmed;
}

/** Canonical stored form of a PH mobile number: +639XXXXXXXXX.
 *
 * normalizePhone() strips the trunk prefix for comparison and is what existing
 * lookups use; this builds the single value written to phone_normalized
 * columns, so the same subscriber typed as 0917…, +63917… or 63 917 … lands on
 * one string across leads, call logs, customers and search. Numbers that don't
 * look like PH mobiles (landlines, foreign) fall back to a +63-prefixed form
 * rather than being discarded — matching still works, it just isn't reformatted. */
export function canonicalPhone(phone: string): string {
  const core = normalizePhone(phone);
  if (!core) return "";
  return `+63${core}`;
}

/** Digits, optional leading +, spaces/dashes tolerated — anything else (letters, etc.) is invalid. */
export function isValidPhoneQuery(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  return /^\+?[\d\s-]+$/.test(trimmed);
}

/** A dialable PH mobile number, for the Packaging gate.
 *
 * Stricter than isValidPhoneQuery (which only screens SEARCH input): an order
 * that reaches Packaging is about to be shipped, so the courier needs a number
 * that can actually be called. normalizePhone() strips the trunk prefix and any
 * +63, leaving the 10-digit subscriber number, which for a PH mobile always
 * starts with 9. */
export function isValidPhMobile(raw: string): boolean {
  return /^9\d{9}$/.test(normalizePhone(raw || ""));
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
