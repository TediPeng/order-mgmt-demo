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

export function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
