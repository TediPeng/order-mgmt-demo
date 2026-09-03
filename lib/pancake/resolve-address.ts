import type { PancakeAccount } from "@/lib/types";
import { fetchCommunes, fetchDistricts, fetchProvinces, type GeoOption } from "./address";

/**
 * An address written as words, turned into the three ids Pancake needs.
 *
 * The picker gives an agent Pancake's own lists to choose from, so an order
 * built that way carries ids by construction. Two routes do not go through the
 * picker: the regular-customer spreadsheet import, which writes the address as
 * text and left the ids empty, and every customer created that way before now.
 * 888 of them by 3 September. Their orders reach Packaging looking complete and
 * are refused hours later at forward time, by which point nobody is looking at
 * the order any more.
 *
 * The matching is deliberately strict. A parcel sent to the wrong barangay is
 * worse than one held back with a clear reason, so anything short of a single
 * unambiguous match resolves to nothing and the customer keeps their empty
 * fields until a person picks the address. Two candidates is not a near miss;
 * it is a question this code is not entitled to answer.
 */

export interface ResolvedAddress {
  provinceId: string | null;
  districtId: string | null;
  communeId: string | null;
  /** The level that stopped it, for the log. Null when all three matched. */
  failedAt: "province" | "city" | "barangay" | null;
  error: string | null;
}

/**
 * Both sides of every comparison pass through here, so the shapes PH addresses
 * are actually written in stop being differences: "Sto. Tomas" and "Santo
 * Tomas", "Peñablanca" and "Penablanca", "Brgy. Poblacion" and "Poblacion".
 */
function normalise(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,'`’]/g, "")
    .replace(/\bsto\b/g, "santo")
    .replace(/\bsta\b/g, "santa")
    .replace(/\bgen\b/g, "general")
    .replace(/\bpres\b/g, "president")
    .replace(/\bbrgy\b/g, " ")
    .replace(/\bbarangay\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The same name with the civic noun removed, tried only after an exact match
 * has failed. Pancake lists "Davao City" where a spreadsheet says "Davao", and
 * "City of Ilagan" where it says "Ilagan".
 */
function loose(value: string): string {
  return normalise(value)
    .replace(/^city of /, "")
    .replace(/^municipality of /, "")
    .replace(/ city$/, "")
    .trim();
}

/** A single unambiguous match, or nothing. Two candidates return nothing. */
function pick(options: GeoOption[], name: string): GeoOption | null {
  const target = normalise(name || "");
  if (!target) return null;

  const exact = options.filter((o) => normalise(o.name) === target);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  const relaxed = loose(name);
  if (!relaxed) return null;
  const near = options.filter((o) => loose(o.name) === relaxed);
  return near.length === 1 ? near[0] : null;
}

function unresolved(failedAt: ResolvedAddress["failedAt"], error: string): ResolvedAddress {
  return { provinceId: null, districtId: null, communeId: null, failedAt, error };
}

/**
 * Resolves all three or none.
 *
 * A province id on its own would satisfy nothing — verifyAddressIds requires
 * the full set before a forward — so a partial answer would only be a half-
 * written record that still fails, and would read as done.
 */
export async function resolveAddressIds(
  account: PancakeAccount,
  names: { province: string | null; city: string | null; barangay: string | null }
): Promise<ResolvedAddress> {
  const provinces = await fetchProvinces(account);
  if (!provinces.ok) return unresolved("province", provinces.error || "Could not load provinces.");
  const province = pick(provinces.options, names.province || "");
  if (!province) {
    return unresolved("province", `No single Pancake province matches "${names.province || ""}".`);
  }

  const districts = await fetchDistricts(account, province.id);
  if (!districts.ok) return unresolved("city", districts.error || "Could not load cities.");
  const district = pick(districts.options, names.city || "");
  if (!district) {
    return unresolved("city", `No single city in ${province.name} matches "${names.city || ""}".`);
  }

  const communes = await fetchCommunes(account, province.id, district.id);
  if (!communes.ok) return unresolved("barangay", communes.error || "Could not load barangays.");
  const commune = pick(communes.options, names.barangay || "");
  if (!commune) {
    return unresolved("barangay", `No single barangay in ${district.name} matches "${names.barangay || ""}".`);
  }

  return {
    provinceId: province.id,
    districtId: district.id,
    communeId: commune.id,
    failedAt: null,
    error: null,
  };
}
