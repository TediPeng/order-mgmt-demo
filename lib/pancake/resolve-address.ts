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
 *
 * That rule is what makes the rest of this file safe. Everything below widens
 * where it LOOKS, never what it will accept.
 */

export interface ResolvedAddress {
  provinceId: string | null;
  districtId: string | null;
  communeId: string | null;
  /** The level that stopped it, for the log. Null when all three matched. */
  failedAt: "province" | "city" | "barangay" | null;
  error: string | null;
  /**
   * Whether the province-wide search for the city ran.
   *
   * The caller rations that path by cost, and cost is the walk through a
   * province's municipalities — spent whether or not the barangay turns out to
   * be unique. Only this function knows it happened.
   */
  citySearched: boolean;
}

interface Names {
  province: string | null;
  city: string | null;
  barangay: string | null;
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
  return { provinceId: null, districtId: null, communeId: null, failedAt, error, citySearched: false };
}

/** One ordering of the three names, resolved top-down. All three or none. */
async function attempt(account: PancakeAccount, names: Names): Promise<ResolvedAddress> {
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
    citySearched: false,
  };
}

/**
 * The city, worked out from the province and the barangay.
 *
 * For 27 of the 95 customers that failed on 3 September the city is not in the
 * record at all. The spreadsheet columns were shifted by one: the order's
 * contents landed in `landmark`, the landmark in `province`, and the province
 * in `city` — leaving nothing holding the municipality.
 *
 *   province: "AT THE BACK OF SAN JOSE CHAPEL"  city: "Camarines-sur"  barangay: "San juan (pob.)"
 *
 * A barangay belongs to exactly one municipality, so when a province has just
 * one municipality containing a barangay of that name, the city is not a guess
 * — it is the only thing the address can mean. Where the name repeats, which
 * "San Isidro" and "Poblacion" do many times over, there are two answers and
 * this returns none, exactly as picking between two candidates would.
 *
 * It costs one request per municipality of that province, so it is asked for
 * explicitly and rationed by the caller rather than run on every customer.
 */
async function findCityByBarangay(
  account: PancakeAccount,
  provinceName: string,
  barangayName: string
): Promise<ResolvedAddress> {
  if (!normalise(barangayName || "")) return unresolved("barangay", "No barangay to search on.");

  const provinces = await fetchProvinces(account);
  if (!provinces.ok) return unresolved("province", provinces.error || "Could not load provinces.");
  const province = pick(provinces.options, provinceName);
  if (!province) return unresolved("province", `No single Pancake province matches "${provinceName}".`);

  const districts = await fetchDistricts(account, province.id);
  if (!districts.ok) return unresolved("city", districts.error || "Could not load cities.");

  const hits: { district: GeoOption; commune: GeoOption }[] = [];
  for (const district of districts.options) {
    const communes = await fetchCommunes(account, province.id, district.id);
    if (!communes.ok) continue;
    const commune = pick(communes.options, barangayName);
    if (commune) hits.push({ district, commune });
    // Two is already an answer: it means the name is not unique in this
    // province, and no further municipality can make it unique again.
    if (hits.length > 1) break;
  }

  if (hits.length !== 1) {
    return unresolved(
      "city",
      hits.length === 0
        ? `No municipality in ${province.name} has a barangay called "${barangayName}".`
        : `"${barangayName}" exists in more than one municipality of ${province.name} — the city cannot be inferred.`
    );
  }

  return {
    provinceId: province.id,
    districtId: hits[0].district.id,
    communeId: hits[0].commune.id,
    failedAt: null,
    error: null,
    citySearched: true,
  };
}

/**
 * Resolves all three or none.
 *
 * A province id on its own would satisfy nothing — verifyAddressIds requires
 * the full set before a forward — so a partial answer would only be a half-
 * written record that still fails, and would read as done.
 *
 * Three passes, each looking somewhere new and none of them relaxing what
 * counts as a match:
 *
 * 1. The columns as written.
 * 2. Province and barangay swapped. 42 of the 95 failures on 3 September were
 *    this — "Bocohan / Lucena City / Quezon", where Quezon is the province and
 *    Bocohan the barangay. A swap that resolves cleanly is not a coincidence:
 *    the barangay has to exist in that city and the city in that province, so
 *    the hierarchy itself is the check.
 * 3. The city inferred from the other two, when it is missing entirely.
 *
 * The passes are ordered by how much they assume, and the first that resolves
 * wins — so an address written correctly is never reinterpreted.
 */
export async function resolveAddressIds(
  account: PancakeAccount,
  names: Names,
  opts: { allowCitySearch?: boolean } = {}
): Promise<ResolvedAddress> {
  const asWritten = await attempt(account, names);
  if (!asWritten.failedAt) return asWritten;

  const swapped = await attempt(account, {
    province: names.barangay,
    city: names.city,
    barangay: names.province,
  });
  if (!swapped.failedAt) return swapped;

  let citySearched = false;
  if (opts.allowCitySearch) {
    // The province may be in either column, and which one is not knowable in
    // advance — the shifted rows put it under `city`, the swapped ones under
    // `barangay`. Both are tried; each is refused unless the barangay it is
    // paired with lands in exactly one municipality.
    const candidates: { province: string; barangay: string }[] = [
      { province: names.city || "", barangay: names.barangay || "" },
      { province: names.province || "", barangay: names.barangay || "" },
      { province: names.city || "", barangay: names.province || "" },
    ];
    for (const c of candidates) {
      if (!normalise(c.province) || !normalise(c.barangay)) continue;
      citySearched = true;
      const found = await findCityByBarangay(account, c.province, c.barangay);
      if (!found.failedAt) return found;
    }
  }

  // The first pass's reason is the one reported. It describes the address as
  // somebody actually typed it, which is what a person fixing it will see.
  return { ...asWritten, citySearched };
}
