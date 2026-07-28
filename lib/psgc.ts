import { supabaseAdmin } from "./supabaseAdmin";

export interface PsgcOption {
  code: string;
  name: string;
}

/** Reference data never changes between deploys, so each list is fetched once
 * per server instance. Barangays are cached per city — the full set is ~42k
 * rows and must never be loaded in one go. */
const provinceCache: { rows: PsgcOption[] | null } = { rows: null };
const cityCache = new Map<string, PsgcOption[]>();
const barangayCache = new Map<string, PsgcOption[]>();

export async function listProvinces(): Promise<PsgcOption[]> {
  if (provinceCache.rows) return provinceCache.rows;
  const { data, error } = await supabaseAdmin.from("psgc_provinces").select("code, name").order("name");
  if (error) throw new Error(`PSGC provinces read failed: ${error.message}`);
  provinceCache.rows = (data || []) as PsgcOption[];
  return provinceCache.rows;
}

export async function listCities(provinceCode: string): Promise<PsgcOption[]> {
  const cached = cityCache.get(provinceCode);
  if (cached) return cached;
  const { data, error } = await supabaseAdmin
    .from("psgc_cities")
    .select("code, name")
    .eq("province_code", provinceCode)
    .order("name");
  if (error) throw new Error(`PSGC cities read failed: ${error.message}`);
  const rows = (data || []) as PsgcOption[];
  cityCache.set(provinceCode, rows);
  return rows;
}

export async function listBarangays(cityCode: string): Promise<PsgcOption[]> {
  const cached = barangayCache.get(cityCode);
  if (cached) return cached;
  const { data, error } = await supabaseAdmin
    .from("psgc_barangays")
    .select("code, name")
    .eq("city_code", cityCode)
    .order("name");
  if (error) throw new Error(`PSGC barangays read failed: ${error.message}`);
  const rows = (data || []) as PsgcOption[];
  barangayCache.set(cityCode, rows);
  return rows;
}

export interface AddressCodes {
  province_code: string | null;
  city_code: string | null;
  barangay_code: string | null;
}

export interface AddressValidation {
  ok: boolean;
  /** Field-keyed messages, for inline display next to each control. */
  errors: Partial<Record<"province" | "city" | "barangay", string>>;
  /** Display names resolved from the codes, so the caller stores both. */
  names: { province: string; city: string; barangay: string };
}

/** Confirms the three codes exist AND that province → city → barangay actually
 * nest. Checking existence alone would accept a barangay from another city, so
 * each level is verified against its parent. */
export async function validateAddressCodes(codes: AddressCodes): Promise<AddressValidation> {
  const errors: AddressValidation["errors"] = {};
  const names = { province: "", city: "", barangay: "" };

  if (!codes.province_code) errors.province = "Province is required.";
  if (!codes.city_code) errors.city = "City / Municipality is required.";
  if (!codes.barangay_code) errors.barangay = "Barangay is required.";
  if (!codes.province_code || !codes.city_code || !codes.barangay_code) {
    return { ok: false, errors, names };
  }

  const [{ data: province }, { data: city }, { data: barangay }] = await Promise.all([
    supabaseAdmin.from("psgc_provinces").select("code, name").eq("code", codes.province_code).maybeSingle(),
    supabaseAdmin.from("psgc_cities").select("code, name, province_code").eq("code", codes.city_code).maybeSingle(),
    supabaseAdmin.from("psgc_barangays").select("code, name, city_code").eq("code", codes.barangay_code).maybeSingle(),
  ]);

  if (!province) errors.province = "Unknown province.";
  else names.province = province.name as string;

  if (!city) errors.city = "Unknown city / municipality.";
  else if (city.province_code !== codes.province_code) errors.city = "That city does not belong to the selected province.";
  else names.city = city.name as string;

  if (!barangay) errors.barangay = "Unknown barangay.";
  else if (barangay.city_code !== codes.city_code) errors.barangay = "That barangay does not belong to the selected city.";
  else names.barangay = barangay.name as string;

  return { ok: Object.keys(errors).length === 0, errors, names };
}

function normalize(v: string): string {
  return v
    .toLowerCase()
    .replace(/^(city of|municipality of)\s+/, "")
    .replace(/\b(city|municipality|province)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Best-effort match of legacy free-text province/city onto PSGC codes, used to
 * backfill existing rows. Deliberately conservative: an ambiguous or missing
 * match returns nulls so the row can be flagged for review rather than being
 * silently assigned the wrong location. */
export async function matchLegacyAddress(
  provinceText: string,
  cityText: string
): Promise<{ province_code: string | null; city_code: string | null }> {
  const provinces = await listProvinces();
  const wantedProvince = normalize(provinceText || "");
  const provinceMatches = provinces.filter((p) => normalize(p.name) === wantedProvince);
  if (provinceMatches.length !== 1) return { province_code: null, city_code: null };

  const cities = await listCities(provinceMatches[0].code);
  const wantedCity = normalize(cityText || "");
  const cityMatches = cities.filter((c) => normalize(c.name) === wantedCity);
  return {
    province_code: provinceMatches[0].code,
    city_code: cityMatches.length === 1 ? cityMatches[0].code : null,
  };
}
