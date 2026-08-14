import type { PancakeAccount } from "@/lib/types";
import { pancakeFetch } from "./client";
import {
  GEO_COMMUNES_PATH,
  GEO_DISTRICTS_PATH,
  GEO_PROVINCES_PATH,
  PH_COUNTRY_CODE,
  mockMode,
} from "./config";

/**
 * Pancake's own address hierarchy — the source of truth for our dropdowns.
 *
 * Pancake models addresses Vietnamese-style as province → district → commune.
 * For the Philippines those positions carry Province → City/Municipality →
 * Barangay, confirmed against the live shop (e.g. province "Abra" returns
 * Bangued, Boliney, Bucay, … as districts).
 *
 * Using this data rather than PSGC means the IDs we send back on create-order
 * are by construction ones Pancake recognises, so an address can never fail to
 * match. Endpoints verified against the official OpenAPI spec — see
 * API_REFERENCE.md.
 */

export interface GeoOption {
  /** Pancake's own ID — this is what the order payload must carry. */
  id: string;
  name: string;
}

interface CacheEntry {
  value: GeoOption[];
  fetchedAt: number;
}

// Provinces change essentially never; districts/communes are stable too. A long
// TTL keeps the picker snappy without pinning stale data forever.
const PROVINCE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CHILD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const geoCache = new Map<string, CacheEntry>();

function cached(key: string, ttl: number): GeoOption[] | null {
  const hit = geoCache.get(key);
  if (!hit) return null;
  return Date.now() - hit.fetchedAt < ttl ? hit.value : null;
}

function store(key: string, value: GeoOption[]): GeoOption[] {
  geoCache.set(key, { value, fetchedAt: Date.now() });
  return value;
}

export function clearGeoCache(): void {
  geoCache.clear();
}

export interface GeoResult {
  ok: boolean;
  options: GeoOption[];
  error: string | null;
}

function toOptions(body: unknown): GeoOption[] {
  const b = (body || {}) as Record<string, unknown>;
  const rows = Array.isArray(b.data) ? (b.data as Record<string, unknown>[]) : [];
  return rows
    .map((r) => ({
      id: r.id === null || r.id === undefined ? "" : String(r.id),
      // `name` is the localized label Pancake shows in its own picker; name_en
      // is a fallback for rows that only carry the English form.
      name: String(r.name ?? r.name_en ?? "").trim(),
    }))
    .filter((o) => o.id && o.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Stand-in geography for PANCAKE_MOCK_MODE.
 *
 * It used to be one invented province, which proved the picker rendered and
 * nothing else: no address in the seed data could match it, so the local
 * environment could not exercise the part that matters — resolving an
 * imported address to a real selection. These are real Philippine names,
 * chosen to cover the leads the dev database is seeded with.
 *
 * Not a substitute for Pancake's own list, which is what production matches
 * against and spells its own way. A match here says the wiring works; it says
 * nothing about how Pancake spells a place.
 */
const MOCK_GEO: { id: string; name: string; cities: { id: string; name: string; barangays: string[] }[] }[] = [
  { id: "mock-ncr", name: "Metro Manila", cities: [
    { id: "mock-pasay", name: "Pasay", barangays: ["Barangay 195", "Barangay 183"] },
    { id: "mock-caloocan", name: "Caloocan", barangays: ["Bagong Silang", "Barangay 176"] },
  ] },
  { id: "mock-dnorte", name: "Davao del Norte", cities: [
    { id: "mock-dujali", name: "Braulio E. Dujali", barangays: ["Poblacion", "Magupising"] },
    { id: "mock-tagum", name: "Tagum City", barangays: ["Poblacion", "Apokon"] },
  ] },
  { id: "mock-rizal", name: "Rizal", cities: [
    { id: "mock-cainta", name: "Cainta", barangays: ["San Roque", "Santo Domingo"] },
  ] },
  { id: "mock-pampanga", name: "Pampanga", cities: [
    { id: "mock-angeles", name: "Angeles City", barangays: ["San Isidro", "Balibago"] },
  ] },
  { id: "mock-bulacan", name: "Bulacan", cities: [
    { id: "mock-marilao", name: "Marilao", barangays: ["Sto. Nino", "Loma de Gato"] },
  ] },
  { id: "mock-quezon", name: "Quezon", cities: [
    { id: "mock-lucban", name: "Lucban", barangays: ["Bagumbayan", "Poblacion"] },
  ] },
  { id: "mock-misor", name: "Misamis Oriental", cities: [
    { id: "mock-cdo", name: "Cagayan de Oro", barangays: ["Bulua", "Carmen"] },
  ] },
  { id: "mock-dsur", name: "Davao del Sur", cities: [
    { id: "mock-davao", name: "Davao City", barangays: ["Talomo", "Buhangin"] },
  ] },
];

/** `GET /geo/provinces?country_code=63` */
export async function fetchProvinces(
  account: PancakeAccount,
  countryCode: string = PH_COUNTRY_CODE
): Promise<GeoResult> {
  const key = `prov:${countryCode}`;
  const hit = cached(key, PROVINCE_TTL_MS);
  if (hit) return { ok: true, options: hit, error: null };
  if (mockMode() !== "off") {
    return { ok: true, options: store(key, MOCK_GEO.map((p) => ({ id: p.id, name: p.name }))), error: null };
  }

  const res = await pancakeFetch(account, `${GEO_PROVINCES_PATH}?country_code=${encodeURIComponent(countryCode)}`, {
    method: "GET",
  });
  if (!res.ok) return { ok: false, options: [], error: res.error || "Could not load provinces from Pancake POS." };
  return { ok: true, options: store(key, toOptions(res.body)), error: null };
}

/** `GET /geo/districts?province_id=…` — City / Municipality for PH shops. */
export async function fetchDistricts(account: PancakeAccount, provinceId: string): Promise<GeoResult> {
  if (!provinceId) return { ok: true, options: [], error: null };
  const key = `dist:${provinceId}`;
  const hit = cached(key, CHILD_TTL_MS);
  if (hit) return { ok: true, options: hit, error: null };
  if (mockMode() !== "off") {
    const cities = MOCK_GEO.find((p) => p.id === provinceId)?.cities ?? [];
    return { ok: true, options: store(key, cities.map((c) => ({ id: c.id, name: c.name }))), error: null };
  }

  const res = await pancakeFetch(account, `${GEO_DISTRICTS_PATH}?province_id=${encodeURIComponent(provinceId)}`, {
    method: "GET",
  });
  if (!res.ok) return { ok: false, options: [], error: res.error || "Could not load cities from Pancake POS." };
  return { ok: true, options: store(key, toOptions(res.body)), error: null };
}

/** `GET /geo/communes?province_id=…&district_id=…` — Barangay for PH shops.
 * Pancake requires BOTH ids, so the caller must pass the province through. */
export async function fetchCommunes(
  account: PancakeAccount,
  provinceId: string,
  districtId: string
): Promise<GeoResult> {
  if (!provinceId || !districtId) return { ok: true, options: [], error: null };
  const key = `comm:${provinceId}:${districtId}`;
  const hit = cached(key, CHILD_TTL_MS);
  if (hit) return { ok: true, options: hit, error: null };
  if (mockMode() !== "off") {
    const brgys =
      MOCK_GEO.find((p) => p.id === provinceId)?.cities.find((c) => c.id === districtId)?.barangays ?? [];
    return { ok: true, options: store(key, brgys.map((b) => ({ id: `mock-${b.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name: b }))), error: null };
  }

  const path =
    `${GEO_COMMUNES_PATH}?province_id=${encodeURIComponent(provinceId)}` +
    `&district_id=${encodeURIComponent(districtId)}`;
  const res = await pancakeFetch(account, path, { method: "GET" });
  if (!res.ok) return { ok: false, options: [], error: res.error || "Could not load barangays from Pancake POS." };
  return { ok: true, options: store(key, toOptions(res.body)), error: null };
}

/**
 * Re-checks a stored address against Pancake before an order is forwarded: the
 * three IDs must still exist AND still nest. Guards against a province/city
 * chosen months ago that Pancake has since renamed or removed, which would
 * otherwise surface as a silently empty address on their side.
 */
export async function verifyAddressIds(
  account: PancakeAccount,
  ids: { provinceId: string | null; districtId: string | null; communeId: string | null }
): Promise<{ ok: boolean; error: string | null; names: { province: string; city: string; barangay: string } }> {
  const blank = { province: "", city: "", barangay: "" };
  if (!ids.provinceId || !ids.districtId || !ids.communeId) {
    return { ok: false, error: "Address is missing a Pancake province, city or barangay selection.", names: blank };
  }

  const provinces = await fetchProvinces(account);
  if (!provinces.ok) return { ok: false, error: provinces.error, names: blank };
  const province = provinces.options.find((o) => o.id === ids.provinceId);
  if (!province) return { ok: false, error: `Province is no longer offered by Pancake POS (id ${ids.provinceId}).`, names: blank };

  const districts = await fetchDistricts(account, ids.provinceId);
  if (!districts.ok) return { ok: false, error: districts.error, names: blank };
  const district = districts.options.find((o) => o.id === ids.districtId);
  if (!district) {
    return { ok: false, error: `City/Municipality does not belong to ${province.name} in Pancake POS.`, names: blank };
  }

  const communes = await fetchCommunes(account, ids.provinceId, ids.districtId);
  if (!communes.ok) return { ok: false, error: communes.error, names: blank };
  const commune = communes.options.find((o) => o.id === ids.communeId);
  if (!commune) {
    return { ok: false, error: `Barangay does not belong to ${district.name} in Pancake POS.`, names: blank };
  }

  return {
    ok: true,
    error: null,
    names: { province: province.name, city: district.name, barangay: commune.name },
  };
}
