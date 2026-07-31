import type { PancakeAccount } from "@/lib/types";
import { pancakeFetch, resolvePath } from "./client";
import { LOOKUP_CACHE_TTL_MS, ORDER_SOURCES_PATH, PARTNERS_PATH, STAFF_PATH, mockMode } from "./config";

/**
 * Pancake reference lists — Order Sources and Staff.
 *
 * Both exist as real endpoints (verified against the official OpenAPI spec; see
 * API_REFERENCE.md). Pancake does not accept free text for either field: the
 * create-order payload wants an ID drawn from these lists, which is why orders
 * forwarded with raw strings arrive with an empty Order Source and no assigned
 * care staff.
 */

export interface PancakeOrderSource {
  id: string;
  name: string;
}

export interface PancakeStaff {
  /** `user.id` — the value that goes into `assigning_care_id`. */
  id: string;
  email: string;
  name: string;
}

export interface PancakePartner {
  id: number;
  name: string;
}

interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
}

// Keyed by account id: one shop's staff list means nothing to another's.
// Process-local, so a serverless instance recycle simply re-fetches — the TTL is
// an upper bound on staleness, not a guarantee of a shared cache.
const orderSourceCache = new Map<string, CacheEntry<PancakeOrderSource[]>>();
const staffCache = new Map<string, CacheEntry<PancakeStaff[]>>();
const partnerCache = new Map<string, CacheEntry<PancakePartner[]>>();

function fresh<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  return Date.now() - hit.fetchedAt < LOOKUP_CACHE_TTL_MS ? hit.value : null;
}

/** Drops every cached list for one account — backs the Settings Refresh button. */
export function invalidateLookupCache(accountId: string): void {
  orderSourceCache.delete(accountId);
  staffCache.delete(accountId);
  partnerCache.delete(accountId);
}

function rows(body: unknown): Record<string, unknown>[] {
  const b = (body || {}) as Record<string, unknown>;
  return Array.isArray(b.data) ? (b.data as Record<string, unknown>[]) : [];
}

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

export interface LookupResult<T> {
  ok: boolean;
  items: T[];
  error: string | null;
}

/** `GET /shops/{SHOP_ID}/order_source` -> `data[]: { id, name, ... }` */
export async function fetchOrderSources(
  account: PancakeAccount,
  opts: { force?: boolean } = {}
): Promise<LookupResult<PancakeOrderSource>> {
  if (!opts.force) {
    const hit = fresh(orderSourceCache, account.id);
    if (hit) return { ok: true, items: hit, error: null };
  }
  if (mockMode() === "success") {
    const items = [{ id: "mock-source-1", name: "JAMIE" }];
    orderSourceCache.set(account.id, { value: items, fetchedAt: Date.now() });
    return { ok: true, items, error: null };
  }
  if (mockMode() === "fail") {
    return { ok: false, items: [], error: "MOCK_MODE=fail: simulated Order Sources failure" };
  }

  const res = await pancakeFetch(account, resolvePath(ORDER_SOURCES_PATH, account), { method: "GET" });
  if (!res.ok) return { ok: false, items: [], error: res.error || "Could not read Order Sources from Pancake POS." };

  const items = rows(res.body)
    .map((r) => ({ id: str(r.id), name: str(r.name) }))
    .filter((r) => r.id && r.name);
  orderSourceCache.set(account.id, { value: items, fetchedAt: Date.now() });
  return { ok: true, items, error: null };
}

/** `GET /shops/{SHOP_ID}/users` -> `data[]: { user_id, user: { id, email, name } }` */
export async function fetchStaffList(
  account: PancakeAccount,
  opts: { force?: boolean } = {}
): Promise<LookupResult<PancakeStaff>> {
  if (!opts.force) {
    const hit = fresh(staffCache, account.id);
    if (hit) return { ok: true, items: hit, error: null };
  }
  if (mockMode() === "success") {
    const items = [{ id: "mock-staff-1", email: "employee@demo.local", name: "Jamie Santos" }];
    staffCache.set(account.id, { value: items, fetchedAt: Date.now() });
    return { ok: true, items, error: null };
  }
  if (mockMode() === "fail") {
    return { ok: false, items: [], error: "MOCK_MODE=fail: simulated Staff list failure" };
  }

  const res = await pancakeFetch(account, resolvePath(STAFF_PATH, account), { method: "GET" });
  if (!res.ok) return { ok: false, items: [], error: res.error || "Could not read the Staff list from Pancake POS." };

  const items = rows(res.body)
    .map((r) => {
      const user = (r.user || {}) as Record<string, unknown>;
      // `user.id` is the account identity; `user_id` on the membership row is
      // the same value, but the nested one is what the order payload references.
      return {
        id: str(user.id) || str(r.user_id),
        email: str(user.email),
        name: str(user.name),
      };
    })
    .filter((r) => r.id);
  staffCache.set(account.id, { value: items, fetchedAt: Date.now() });
  return { ok: true, items, error: null };
}

/** `GET /shops/{SHOP_ID}/partners` — courier accounts connected to the shop. */
export async function fetchPartners(
  account: PancakeAccount,
  opts: { force?: boolean } = {}
): Promise<LookupResult<PancakePartner>> {
  if (!opts.force) {
    const hit = fresh(partnerCache, account.id);
    if (hit) return { ok: true, items: hit, error: null };
  }
  if (mockMode() !== "off") return { ok: true, items: [], error: null };

  const res = await pancakeFetch(account, resolvePath(PARTNERS_PATH, account), { method: "GET" });
  if (!res.ok) return { ok: false, items: [], error: res.error || "Could not read partners from Pancake POS." };

  const items = rows(res.body)
    .map((r) => ({ id: Number(r.id), name: str(r.name) }))
    .filter((r) => Number.isFinite(r.id));
  partnerCache.set(account.id, { value: items, fetchedAt: Date.now() });
  return { ok: true, items, error: null };
}

// --- matching -------------------------------------------------------------
// Case-insensitive and trimmed, per the fix spec. Deliberately exact after
// normalization: a fuzzy match on an agent's Call Name could attribute an
// order to the wrong source, which is worse than refusing to send it.

function norm(s: string): string {
  return s.trim().toLowerCase();
}

export function matchOrderSource(sources: PancakeOrderSource[], callName: string | null): PancakeOrderSource | null {
  const target = norm(callName || "");
  if (!target) return null;
  return sources.find((s) => norm(s.name) === target) || null;
}

export function matchStaffByEmail(staff: PancakeStaff[], email: string | null): PancakeStaff | null {
  const target = norm(email || "");
  if (!target) return null;
  return staff.find((s) => norm(s.email) === target) || null;
}

/** The exact failure wording the fix spec requires, so the Administrator is told
 * precisely which value to reconcile in which system. */
export function noOrderSourceMessage(callName: string | null): string {
  return `No matching Order Source found in Pancake POS for call name: ${callName || "(none set)"}`;
}

export function noStaffMessage(email: string | null): string {
  return `No matching staff found in Pancake POS for email: ${email || "(none set)"}`;
}
