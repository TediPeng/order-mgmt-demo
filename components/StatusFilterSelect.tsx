"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StatusFilterOption {
  /** "" is All Leads. Otherwise the OrderStatus. */
  value: string;
  label: string;
  href: string;
  count: number;
}

/**
 * Every status, as a dropdown you can type into.
 *
 * A native <select> cannot hold a search field, and nineteen statuses is enough
 * that finding one means reading a list rather than recognising a position —
 * RETURNING, RETURNED and PARTIAL RETURN sit three apart and look alike. Typing
 * "ret" is faster than any amount of scrolling, and it is what somebody who
 * knows the list already expects to be able to do.
 *
 * The href for each option is built on the server by the same hrefFor() the
 * cards use, so choosing a status keeps whatever other filters are on the page.
 * This component only navigates.
 */
export function StatusFilterSelect({ options, value }: { options: StatusFilterOption[]; value: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value) || options[0];

  const matches = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return options;
    return options.filter((o) => o.label.toLowerCase().includes(t));
  }, [options, term]);

  // Opening starts on the current selection rather than at the top, so Enter
  // straight after opening changes nothing — the way a native select behaves.
  useEffect(() => {
    if (!open) return;
    const i = matches.findIndex((o) => o.value === value);
    setActive(i >= 0 ? i : 0);
    inputRef.current?.focus();
    // Only when the panel opens: re-running on every keystroke would fight the
    // arrow keys for control of the highlight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Typing narrows the list under the highlight, which can leave it pointing
  // past the end.
  useEffect(() => {
    setActive((i) => Math.min(i, Math.max(0, matches.length - 1)));
  }, [matches.length]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function choose(option: StatusFilterOption | undefined) {
    if (!option) return;
    setOpen(false);
    setTerm("");
    router.push(option.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      setTerm("");
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!matches.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + matches.length) % matches.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      choose(matches[active]);
    }
  }

  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex min-w-[13rem] items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 shadow-sm hover:border-slate-400 focus:border-[var(--brand-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-primary)]"
      >
        <span className="truncate">
          {selected?.label} ({selected?.count ?? 0})
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>

      {open && (
        <div className="absolute left-0 z-40 mt-1 w-[16rem] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-slate-100 px-2.5 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <input
              ref={inputRef}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search status"
              aria-label="Search status"
              className="w-full bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
            />
          </div>

          <ul role="listbox" className="max-h-64 overflow-auto py-1">
            {matches.map((o, i) => {
              const isSelected = o.value === value;
              return (
                <li key={o.value || "all"}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => choose(o)}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-sm",
                      i === active ? "bg-[var(--brand-primary-10)] text-slate-900" : "text-slate-700",
                      isSelected && "font-medium"
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Check
                        className={cn("h-3.5 w-3.5 shrink-0", isSelected ? "text-[var(--brand-primary)]" : "invisible")}
                      />
                      <span className="truncate">{o.label}</span>
                    </span>
                    {/* Dimmed: the count is context for the choice, not the
                        thing being chosen. A zero still shows — knowing a status
                        is empty is an answer. */}
                    <span className="shrink-0 tabular-nums text-slate-400">{o.count}</span>
                  </button>
                </li>
              );
            })}

            {matches.length === 0 && (
              <li className="px-2.5 py-3 text-center text-xs text-slate-400">No status matches “{term}”.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
