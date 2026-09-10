"use client";

import { Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { dialHref, type DialScheme } from "@/lib/dial";

/**
 * A phone number, and a button that calls it.
 *
 * The number used to BE the button. It stopped being one on the first day of
 * the softphone rollout, for two reasons that only appear once real people use
 * it: nobody could tell a number was clickable until they were told, and
 * anybody who did know had to click the one thing on the row they most often
 * want to read, select and copy. A misjudged click on a link is a call to a
 * customer — the most expensive accidental click in the app.
 *
 * So the number is text again, and the call is a labelled button beside it.
 * Nothing about what it dials has changed: same scheme, same href, same
 * handler on the desktop.
 *
 * Falls back to plain text whenever there is nothing to dial — an empty number,
 * or click-to-call switched off. A button that goes nowhere is worse than none.
 *
 * `stopPropagation` because most of these sit inside a table row that opens a
 * popup: without it, dialling also opens the order behind the number, which is
 * two things from one click.
 */
export function DialLink({
  phone,
  scheme,
  className,
}: {
  phone: string | null | undefined;
  scheme: DialScheme;
  className?: string;
}) {
  const href = dialHref(phone, scheme);
  const text = String(phone ?? "").trim();

  if (!href) return <span className={className}>{text || "—"}</span>;

  return (
    <span className={cn("inline-flex items-center gap-2 whitespace-nowrap", className)}>
      <span>{text}</span>
      <a
        href={href}
        onClick={(e) => e.stopPropagation()}
        title={`Call ${text}`}
        className={cn(
          "inline-flex items-center gap-1 rounded-md border border-[var(--brand-primary)] px-1.5 py-0.5",
          "text-xs font-medium leading-none text-[var(--brand-primary)]",
          "hover:bg-[var(--brand-primary)] hover:text-white"
        )}
      >
        <Phone className="h-3 w-3 shrink-0" aria-hidden />
        Call
      </a>
    </span>
  );
}
