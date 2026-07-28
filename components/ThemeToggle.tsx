"use client";

import { useState, useTransition } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { setThemeAction } from "@/lib/actions/theme";
import type { ThemePreference } from "@/lib/types";

const OPTIONS: { value: ThemePreference; label: string; Icon: React.ElementType }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

/** Light / Dark / System selector.
 *
 * The class on <html> is flipped immediately so the change is instant, then the
 * server action persists it — waiting for the round-trip would leave the page
 * in the old theme for a noticeable beat. */
export function ThemeToggle({ current }: { current: ThemePreference }) {
  const [value, setValue] = useState<ThemePreference>(current);
  const [, startTransition] = useTransition();

  function apply(next: ThemePreference) {
    setValue(next);
    const root = document.documentElement;
    root.dataset.theme = next;
    const dark = next === "dark" || (next === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    root.classList.toggle("dark", dark);
    startTransition(() => {
      void setThemeAction(next);
    });
  }

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="group" aria-label="Theme">
      {OPTIONS.map(({ value: v, label, Icon }) => (
        <button
          key={v}
          type="button"
          onClick={() => apply(v)}
          aria-pressed={value === v}
          title={label}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors",
            value === v
              ? "bg-white text-[var(--brand-primary)] shadow-sm"
              : "text-slate-500 hover:text-slate-800"
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
