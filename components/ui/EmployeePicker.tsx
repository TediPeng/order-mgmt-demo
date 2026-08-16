"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

export interface PickerOption {
  id: string;
  full_name: string;
}

/**
 * A name picker with the search inside the list it opens.
 *
 * A native select cannot hold a search box, so a floor of twenty is found by
 * scrolling past nineteen people -- and the one thing worth being careful about
 * on a suspension form is picking the wrong name. Typing narrows the list where
 * the list is, which is where somebody looking for a name already is.
 *
 * The value still leaves in a hidden input under the same name the native
 * select used, so the form and its server action are unchanged.
 */
export function EmployeePicker({
  name,
  options,
  placeholder = "Select employee",
  required,
  id,
}: {
  name: string;
  options: PickerOption[];
  placeholder?: string;
  required?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [active, setActive] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.id === selectedId) || null;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.full_name.toLowerCase().includes(q)) : options;
  }, [options, query]);

  // Closing on an outside press rather than on blur: blur fires when the
  // pointer lands on the list itself, which would shut the panel before the
  // click it was aimed at ever arrived.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const choose = (o: PickerOption) => {
    setSelectedId(o.id);
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (matches.length === 0) return;
      setActive((i) => (e.key === "ArrowDown" ? (i + 1) % matches.length : (i - 1 + matches.length) % matches.length));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault(); // never submits the form from inside the search box
      if (matches[active]) choose(matches[active]);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      {/* The value the form actually sends. required lands on it so an
          unanswered picker stops submission the way the select did. */}
      <input type="hidden" name={name} value={selectedId} required={required} />

      <button
        type="button"
        id={id}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-[38px] w-full items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-3 text-control text-slate-900 transition-colors hover:border-slate-400 focus:border-[var(--brand-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-primary)]"
      >
        <span className={selected ? "truncate" : "truncate text-slate-400"}>{selected?.full_name || placeholder}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Search name"
              aria-label="Search the employee list"
              className="w-full bg-transparent text-control text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
          </div>

          <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
            {matches.map((o, i) => (
              <li key={o.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.id === selectedId}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o)}
                  className={[
                    "w-full px-3 py-1.5 text-left text-control transition-colors",
                    i === active ? "bg-slate-100" : "",
                    o.id === selectedId ? "font-semibold text-[var(--brand-primary)]" : "text-slate-700",
                  ].join(" ")}
                >
                  {o.full_name}
                </button>
              </li>
            ))}
            {matches.length === 0 && (
              <li className="px-3 py-3 text-control text-slate-400">No name matches “{query}”.</li>
            )}
          </ul>

          {query.trim() !== "" && matches.length > 0 && (
            <p className="border-t border-slate-100 px-3 py-1.5 text-xs text-slate-500">
              {matches.length} of {options.length} shown
            </p>
          )}
        </div>
      )}
    </div>
  );
}
