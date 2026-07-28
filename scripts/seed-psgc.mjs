// One-off seeder for the PSGC reference tables.
//
//   node scripts/seed-psgc.mjs
//
// Reads the datasets in data/psgc/ (downloaded from the official PSGC API at
// https://psgc.gitlab.io/api/, which mirrors the PSA publication) and upserts
// them into psgc_provinces / psgc_cities / psgc_barangays. Safe to re-run:
// every write is an upsert keyed on the PSGC code.
//
// PSGC gives 19 cities no province — the 17 NCR districts (City of Manila and
// friends) plus City of Isabela. Their region stands in as the province so the
// Province -> City -> Barangay chain is unbroken for every address.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = path.resolve(import.meta.dirname, "..");

// Load SUPABASE_* from .env.local without pulling in a dependency.
for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const read = (f) => JSON.parse(fs.readFileSync(path.join(root, "data/psgc", f), "utf8").replace(/^﻿/, ""));
const regions = read("regions.json");
const provinces = read("provinces.json");
const cities = read("cities.json");
const barangays = read("barangays.json");

const regionName = new Map(regions.map((r) => [r.code, r.regionName || r.name]));

const provinceRows = provinces.map((p) => ({
  code: p.code,
  name: p.name,
  region_code: p.regionCode,
  is_region_proxy: false,
}));

// Region proxies for the province-less cities. Their formal region names are
// not what anyone types into an address ("National Capital Region" vs "Metro
// Manila"), so the everyday name is used with the region in parentheses.
const PROXY_NAMES = {
  "130000000": "Metro Manila (NCR)",
  "090000000": "Zamboanga Peninsula (Region IX)",
  "120000000": "SOCCSKSARGEN (Region XII)",
};
const proxyRegions = new Set(cities.filter((c) => !c.provinceCode).map((c) => c.regionCode));
for (const code of proxyRegions) {
  provinceRows.push({
    code,
    name: PROXY_NAMES[code] || regionName.get(code) || code,
    region_code: code,
    is_region_proxy: true,
  });
}

const cityRows = cities.map((c) => ({
  code: c.code,
  name: c.name,
  province_code: c.provinceCode || c.regionCode,
  is_city: Boolean(c.isCity),
}));

const cityCodes = new Set(cityRows.map((c) => c.code));
const barangayRows = [];
const orphans = [];
for (const b of barangays) {
  const parent = b.cityCode || b.municipalityCode || b.subMunicipalityCode;
  if (!parent || !cityCodes.has(parent)) {
    orphans.push(b.code);
    continue;
  }
  barangayRows.push({ code: b.code, name: b.name, city_code: parent });
}

async function upsertAll(table, rows, chunk = 1000) {
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const { error } = await supabase.from(table).upsert(slice, { onConflict: "code" });
    if (error) throw new Error(`${table} upsert failed at ${i}: ${error.message}`);
    process.stdout.write(`\r${table}: ${Math.min(i + chunk, rows.length)}/${rows.length}`);
  }
  process.stdout.write("\n");
}

await upsertAll("psgc_provinces", provinceRows);
await upsertAll("psgc_cities", cityRows);
await upsertAll("psgc_barangays", barangayRows);

console.log(
  `done — ${provinceRows.length} provinces (${proxyRegions.size} region proxies), ` +
    `${cityRows.length} cities, ${barangayRows.length} barangays` +
    (orphans.length ? `, ${orphans.length} barangays skipped (no matching city)` : "")
);
