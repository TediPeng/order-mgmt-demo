"use client";

import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface ProductOption {
  id: string;
  name: string;
  code: string | null;
}

export function ProductCombobox({
  name,
  products,
  defaultValue,
  defaultLabel,
  disabled,
  required,
  onChange,
}: {
  name: string;
  products: ProductOption[];
  defaultValue?: string;
  defaultLabel?: string;
  disabled?: boolean;
  required?: boolean;
  onChange?: (productId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState(defaultValue || "");
  const [query, setQuery] = useState(defaultLabel || "");
  const [open, setOpen] = useState(false);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q ? products.filter((p) => p.name.toLowerCase().includes(q) || (p.code || "").toLowerCase().includes(q)) : products;
    return pool.slice(0, 20);
  }, [query, products]);

  function selectProduct(p: ProductOption) {
    setSelectedId(p.id);
    setQuery(p.name);
    setOpen(false);
    onChange?.(p.id);
  }

  function handleBlur() {
    // Delay so a click on an option registers before we revert stray text.
    blurTimeout.current = setTimeout(() => {
      setOpen(false);
      const selected = products.find((p) => p.id === selectedId);
      setQuery(selected ? selected.name : "");
    }, 150);
  }

  function handleFocus() {
    if (blurTimeout.current) clearTimeout(blurTimeout.current);
    setOpen(true);
  }

  return (
    <div className="relative">
      <input type="hidden" name={name} value={selectedId} required={required} />
      <input
        type="text"
        value={query}
        disabled={disabled}
        placeholder="Search product by name or code…"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className={cn(
          "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-[var(--brand-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-primary)] disabled:bg-slate-50 disabled:text-slate-500"
        )}
      />
      {open && !disabled && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg">
          {matches.map((p) => (
            <li
              key={p.id}
              onMouseDown={(e) => {
                e.preventDefault();
                selectProduct(p);
              }}
              className={cn(
                "cursor-pointer px-3 py-2 hover:bg-slate-50",
                p.id === selectedId && "bg-[var(--brand-primary-10)] font-medium"
              )}
            >
              {p.name}
              {p.code && <span className="ml-2 text-xs text-slate-400">{p.code}</span>}
            </li>
          ))}
          {matches.length === 0 && <li className="px-3 py-2 text-slate-400">No matching active products.</li>}
        </ul>
      )}
    </div>
  );
}
