"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { UpdateLog } from "@/lib/types";
import { formatDate } from "@/lib/utils";

function Section({ title, items }: { title: string; items: string[] | null }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-600">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/** Release notes, newest first. Rendered as a side panel so it can be opened
 * from the login page without navigating away from the sign-in form. */
export function UpdateLogsPanel({ releases }: { releases: UpdateLog[] }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-slate-500 underline decoration-dotted underline-offset-2 hover:text-[var(--brand-primary)]"
      >
        Update Logs
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            aria-label="Close update logs"
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setOpen(false)}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Update logs"
            className="relative flex h-full w-full max-w-md flex-col overflow-hidden bg-white shadow-xl"
          >
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">Update Logs</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {releases.length === 0 && <p className="text-sm text-slate-400">No release notes published yet.</p>}
              {releases.map((r) => (
                <article key={r.id} className="border-b border-slate-100 py-4 first:pt-0 last:border-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="rounded bg-[var(--brand-primary)]/10 px-2 py-0.5 text-xs font-semibold text-[var(--brand-primary)]">
                      Version {r.version}
                    </span>
                    <span className="text-xs text-slate-400">{formatDate(r.release_date)}</span>
                  </div>
                  <h3 className="mt-2 text-sm font-semibold text-slate-800">{r.title}</h3>
                  <Section title="New Features" items={r.new_features} />
                  <Section title="Fixes" items={r.fixes} />
                  <Section title="Improvements" items={r.improvements} />
                  <Section title="Known Issues" items={r.known_issues} />
                </article>
              ))}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
