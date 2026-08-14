"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Input, Label } from "@/components/ui/Field";
import { cn } from "@/lib/utils";

interface Option {
  /** Pancake's own ID for this location. */
  id: string;
  name: string;
}

/** Imported addresses arrive slugged — "Metro-manila", "Braulio-e.-dujali" —
 * while Pancake spells them out. Case, hyphens and full stops are the whole
 * difference for the overwhelming majority. */
function normalizePlace(value: string): string {
  return value
    .toLowerCase()
    .replace(/[-.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The one option whose name is exactly this, once both sides are normalised.
 *
 * Exact only, and only when exactly one option matches. A near-match would fill
 * these boxes with somewhere the customer does not live, and this address is
 * what a courier drives to — a blank box an agent has to fill is a smaller
 * problem than a filled one that is wrong.
 */
function matchByName(options: Option[], name: string): Option | null {
  const target = normalizePlace(name || "");
  if (!target) return null;
  const hits = options.filter((o) => normalizePlace(o.name) === target);
  return hits.length === 1 ? hits[0] : null;
}

export interface AddressValue {
  province_id: string;
  province: string;
  city_id: string;
  city: string;
  barangay_id: string;
  barangay: string;
}

export const EMPTY_ADDRESS: AddressValue = {
  province_id: "",
  province: "",
  city_id: "",
  city: "",
  barangay_id: "",
  barangay: "",
};

// One in-flight request per key serves every instance of the control, and the
// resolved list is reused for the life of the page.
const cache = new Map<string, Promise<{ options: Option[]; error: string | null }>>();

function load(key: string, url: string) {
  const hit = cache.get(key);
  if (hit) return hit;
  const p = fetch(url)
    .then((r) => r.json())
    .then((j) => (j.ok ? { options: j.options as Option[], error: null } : { options: [], error: String(j.error) }))
    .catch((e) => ({ options: [] as Option[], error: (e as Error).message }));
  cache.set(key, p);
  return p;
}

/**
 * Searchable single-select mirroring Pancake POS's own Select Address control:
 * type-to-search over a fixed list, never free text, and only ever emits an
 * option the list actually contains.
 */
function SearchableSelect({
  id,
  label,
  options,
  value,
  displayValue,
  disabled,
  loading,
  placeholder,
  error,
  onSelect,
}: {
  id: string;
  label: string;
  options: Option[];
  value: string;
  displayValue: string;
  disabled: boolean;
  loading: boolean;
  placeholder: string;
  error?: string;
  onSelect: (option: Option | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;
    return base.slice(0, 100);
  }, [options, query]);

  return (
    <div ref={boxRef} className="relative">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          autoComplete="off"
          disabled={disabled || loading}
          placeholder={loading ? "Loading…" : disabled ? placeholder : displayValue || placeholder}
          value={open ? query : displayValue}
          onFocus={() => {
            if (disabled || loading) return;
            setQuery("");
            setOpen(true);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            // Typing invalidates the previous pick, so the levels below reset.
            if (value) onSelect(null);
          }}
          className={cn(error && "border-red-400", loading && "pr-9")}
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {open && !disabled && !loading && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {filtered.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() => {
                  onSelect(o);
                  setOpen(false);
                }}
              >
                {o.name}
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">No matches.</li>}
          {filtered.length === 100 && (
            <li className="px-3 py-1.5 text-xs text-slate-400">Showing first 100 — keep typing to narrow.</li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * Province → City/Municipality → Barangay, sourced from **Pancake POS's own
 * address data** so a selection here is by construction one Pancake recognises.
 *
 * Replicates Pancake's Select Address behaviour:
 *  - each level is disabled until the level above it is chosen;
 *  - choosing a level loads the next one and shows a spinner while it fetches;
 *  - changing Province clears City and Barangay; changing City clears Barangay;
 *  - only list options can be selected — no free text, so invalid combinations
 *    cannot be expressed.
 *
 * Hidden inputs carry BOTH the Pancake IDs (what the order payload sends) and
 * the display names (what the app shows), so neither has to be re-derived.
 */
export function AddressSelect({
  value,
  onChange,
  errors,
  disabled = false,
}: {
  value: AddressValue;
  onChange: (next: AddressValue) => void;
  errors?: Partial<Record<"province" | "city" | "barangay", string>>;
  disabled?: boolean;
}) {
  const [provinces, setProvinces] = useState<Option[]>([]);
  const [cities, setCities] = useState<Option[]>([]);
  const [barangays, setBarangays] = useState<Option[]>([]);
  const [loading, setLoading] = useState({ province: true, city: false, barangay: false });
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * What the import said, kept from the first render.
   *
   * Nearly every lead arrives with an address as text and no Pancake IDs —
   * 49,301 of the 49,302 open ones — so these three boxes opened empty on a
   * lead that already knew where the customer lived, and the agent retyped it
   * during the call. Matching those names to Pancake's own lists fills them in.
   *
   * Held in a ref because choosing a province clears the city and barangay
   * below it, which would throw away the very names the next level needs.
   */
  const imported = useRef({ province: value.province, city: value.city, barangay: value.barangay });
  // One attempt per level. Without this, clearing a wrongly-matched box would
  // simply re-fill it and the agent could never overrule the import.
  const tried = useRef({ province: false, city: false, barangay: false });
  const [autoFilled, setAutoFilled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    load("provinces", "/api/pancake/geo?level=provinces").then((r) => {
      if (cancelled) return;
      setProvinces(r.options);
      setLoadError(r.error);
      setLoading((l) => ({ ...l, province: false }));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!value.province_id) {
      setCities([]);
      return;
    }
    let cancelled = false;
    setLoading((l) => ({ ...l, city: true }));
    load(`cities:${value.province_id}`, `/api/pancake/geo?level=districts&province_id=${encodeURIComponent(value.province_id)}`).then(
      (r) => {
        if (cancelled) return;
        setCities(r.options);
        if (r.error) setLoadError(r.error);
        setLoading((l) => ({ ...l, city: false }));
      }
    );
    return () => {
      cancelled = true;
    };
  }, [value.province_id]);

  useEffect(() => {
    if (!value.province_id || !value.city_id) {
      setBarangays([]);
      return;
    }
    let cancelled = false;
    setLoading((l) => ({ ...l, barangay: true }));
    const url =
      `/api/pancake/geo?level=communes&province_id=${encodeURIComponent(value.province_id)}` +
      `&district_id=${encodeURIComponent(value.city_id)}`;
    load(`brgy:${value.province_id}:${value.city_id}`, url).then((r) => {
      if (cancelled) return;
      setBarangays(r.options);
      if (r.error) setLoadError(r.error);
      setLoading((l) => ({ ...l, barangay: false }));
    });
    return () => {
      cancelled = true;
    };
  }, [value.province_id, value.city_id]);

  const setProvince = useCallback(
    (o: Option | null) =>
      onChange({
        province_id: o?.id || "",
        province: o?.name || "",
        // A different province invalidates both levels below it.
        city_id: "",
        city: "",
        barangay_id: "",
        barangay: "",
      }),
    [onChange]
  );

  const setCity = useCallback(
    (o: Option | null) => onChange({ ...value, city_id: o?.id || "", city: o?.name || "", barangay_id: "", barangay: "" }),
    [onChange, value]
  );

  const setBarangay = useCallback(
    (o: Option | null) => onChange({ ...value, barangay_id: o?.id || "", barangay: o?.name || "" }),
    [onChange, value]
  );

  // --- Auto-fill from the import -------------------------------------------
  // One level at a time, each as its list arrives: choosing a province is what
  // loads the cities, so the cascade drives itself. A level that does not match
  // exactly is left empty and stops the ones under it, which is the honest
  // outcome — the agent picks from there.
  useEffect(() => {
    if (tried.current.province || value.province_id || provinces.length === 0) return;
    tried.current.province = true;
    const hit = matchByName(provinces, imported.current.province);
    if (hit) {
      setProvince(hit);
      setAutoFilled(true);
    }
  }, [provinces, value.province_id, setProvince]);

  useEffect(() => {
    if (tried.current.city || value.city_id || cities.length === 0) return;
    tried.current.city = true;
    const hit = matchByName(cities, imported.current.city);
    if (hit) {
      setCity(hit);
      setAutoFilled(true);
    }
  }, [cities, value.city_id, setCity]);

  useEffect(() => {
    if (tried.current.barangay || value.barangay_id || barangays.length === 0) return;
    tried.current.barangay = true;
    const hit = matchByName(barangays, imported.current.barangay);
    if (hit) {
      setBarangay(hit);
      setAutoFilled(true);
    }
  }, [barangays, value.barangay_id, setBarangay]);

  // What the import said, always in view while any level is still unresolved —
  // so the agent is never hunting for it, and can see what the match was made
  // against when one was made.
  const importedLine = [imported.current.province, imported.current.city, imported.current.barangay]
    .filter(Boolean)
    .join(" / ");
  const anyUnresolved = !value.province_id || !value.city_id || !value.barangay_id;

  return (
    <div className="space-y-2">
      {loadError && (
        <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          Address options could not be loaded from Pancake POS: {loadError}
        </p>
      )}
      {/* Two different things, deliberately: what the import said, and whether
          anything was chosen for the agent on the strength of it. */}
      {importedLine && (anyUnresolved || autoFilled) && (
        <p className="text-xs text-slate-500">
          <span className="text-slate-400">Import:</span> {importedLine}
          {autoFilled && (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
              Auto-filled — check before saving
            </span>
          )}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SearchableSelect
          id="province"
          label="Province"
          options={provinces}
          value={value.province_id}
          displayValue={value.province_id ? value.province : ""}
          disabled={disabled}
          loading={loading.province}
          placeholder="Search province…"
          error={errors?.province}
          onSelect={setProvince}
        />
        <SearchableSelect
          id="city"
          label="City / Municipality"
          options={cities}
          value={value.city_id}
          displayValue={value.city_id ? value.city : ""}
          disabled={disabled || !value.province_id}
          loading={loading.city}
          placeholder={value.province_id ? "Search city…" : "Select a province first"}
          error={errors?.city}
          onSelect={setCity}
        />
        <SearchableSelect
          id="barangay"
          label="Barangay"
          options={barangays}
          value={value.barangay_id}
          displayValue={value.barangay_id ? value.barangay : ""}
          disabled={disabled || !value.city_id}
          loading={loading.barangay}
          placeholder={value.city_id ? "Search barangay…" : "Select a city first"}
          error={errors?.barangay}
          onSelect={setBarangay}
        />
      </div>

      {/* Pancake IDs — what the create-order payload actually sends. */}
      <input type="hidden" name="pancake_province_id" value={value.province_id} />
      <input type="hidden" name="pancake_district_id" value={value.city_id} />
      <input type="hidden" name="pancake_commune_id" value={value.barangay_id} />
      {/* Display names, stored alongside so lists and exports need no lookup. */}
      <input type="hidden" name="province" value={value.province} />
      <input type="hidden" name="city" value={value.city} />
      <input type="hidden" name="barangay" value={value.barangay} />
    </div>
  );
}
