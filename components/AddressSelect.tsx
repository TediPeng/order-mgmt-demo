"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Input, Label } from "@/components/ui/Field";
import { cn } from "@/lib/utils";

interface Option {
  code: string;
  name: string;
}

export interface AddressValue {
  province_code: string;
  province: string;
  city_code: string;
  city: string;
  barangay_code: string;
  barangay: string;
}

// Lists are immutable reference data, so one fetch per key serves every
// instance of the control for the lifetime of the page.
const cache = new Map<string, Promise<Option[]>>();
function fetchOptions(key: string, url: string): Promise<Option[]> {
  const hit = cache.get(key);
  if (hit) return hit;
  const p = fetch(url)
    .then((r) => r.json())
    .then((j) => (j.ok ? (j.options as Option[]) : []))
    .catch(() => []);
  cache.set(key, p);
  return p;
}

/** Searchable single-select. A plain <select> is unusable at 1,600 cities or
 * several thousand barangays, and free text is not allowed — the value must be
 * a real PSGC code — so this filters a fixed list and only ever emits a code. */
function SearchableSelect({
  id,
  label,
  options,
  value,
  displayValue,
  disabled,
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
      <Input
        id={id}
        autoComplete="off"
        disabled={disabled}
        placeholder={disabled ? placeholder : displayValue || placeholder}
        value={open ? query : displayValue}
        onFocus={() => {
          if (disabled) return;
          setQuery("");
          setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          // Typing invalidates the previous pick, so downstream levels reset.
          if (value) onSelect(null);
        }}
        className={cn(error && "border-red-400")}
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {open && !disabled && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {filtered.map((o) => (
            <li key={o.code}>
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

/** Province → City/Municipality → Barangay, each level unlocked and filtered by
 * the one above it and reset when that changes. Emits codes and display names
 * together so the caller stores both; hidden inputs keep it usable inside a
 * plain form post. */
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

  useEffect(() => {
    fetchOptions("provinces", "/api/psgc").then(setProvinces);
  }, []);

  useEffect(() => {
    if (!value.province_code) {
      setCities([]);
      return;
    }
    fetchOptions(`cities:${value.province_code}`, `/api/psgc?province=${encodeURIComponent(value.province_code)}`).then(
      setCities
    );
  }, [value.province_code]);

  useEffect(() => {
    if (!value.city_code) {
      setBarangays([]);
      return;
    }
    fetchOptions(`brgy:${value.city_code}`, `/api/psgc?city=${encodeURIComponent(value.city_code)}`).then(setBarangays);
  }, [value.city_code]);

  const setProvince = useCallback(
    (o: Option | null) =>
      onChange({
        province_code: o?.code || "",
        province: o?.name || "",
        // A different province invalidates both levels below it.
        city_code: "",
        city: "",
        barangay_code: "",
        barangay: "",
      }),
    [onChange]
  );

  const setCity = useCallback(
    (o: Option | null) =>
      onChange({ ...value, city_code: o?.code || "", city: o?.name || "", barangay_code: "", barangay: "" }),
    [onChange, value]
  );

  const setBarangay = useCallback(
    (o: Option | null) => onChange({ ...value, barangay_code: o?.code || "", barangay: o?.name || "" }),
    [onChange, value]
  );

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <SearchableSelect
        id="province"
        label="Province"
        options={provinces}
        value={value.province_code}
        displayValue={value.province_code ? value.province : ""}
        disabled={disabled}
        placeholder="Search province…"
        error={errors?.province}
        onSelect={setProvince}
      />
      <SearchableSelect
        id="city"
        label="City / Municipality"
        options={cities}
        value={value.city_code}
        displayValue={value.city_code ? value.city : ""}
        disabled={disabled || !value.province_code}
        placeholder={value.province_code ? "Search city…" : "Select a province first"}
        error={errors?.city}
        onSelect={setCity}
      />
      <SearchableSelect
        id="barangay"
        label="Barangay"
        options={barangays}
        value={value.barangay_code}
        displayValue={value.barangay_code ? value.barangay : ""}
        disabled={disabled || !value.city_code}
        placeholder={value.city_code ? "Search barangay…" : "Select a city first"}
        error={errors?.barangay}
        onSelect={setBarangay}
      />

      <input type="hidden" name="province_code" value={value.province_code} />
      <input type="hidden" name="province" value={value.province} />
      <input type="hidden" name="city_code" value={value.city_code} />
      <input type="hidden" name="city" value={value.city} />
      <input type="hidden" name="barangay_code" value={value.barangay_code} />
      <input type="hidden" name="barangay" value={value.barangay} />
    </div>
  );
}
