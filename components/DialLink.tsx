"use client";

import { Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { dialHref, type DialScheme } from "@/lib/dial";

/**
 * A phone number that dials when clicked.
 *
 * Falls back to plain text whenever there is nothing to dial — an empty
 * number, or click-to-call switched off — so no caller has to decide between
 * two renderings. A link that goes nowhere would be worse than no link.
 *
 * `stopPropagation` because most of these sit inside a table row that opens a
 * popup: without it, dialling also opens the order behind the number, which is
 * two things from one click.
 */
export function DialLink({
  phone,
  scheme,
  className,
  showIcon = false,
}: {
  phone: string | null | undefined;
  scheme: DialScheme;
  className?: string;
  showIcon?: boolean;
}) {
  const href = dialHref(phone, scheme);
  const text = String(phone ?? "").trim();

  if (!href) return <span className={className}>{text || "—"}</span>;

  return (
    <a
      href={href}
      onClick={(e) => e.stopPropagation()}
      title={`Dial ${text}`}
      className={cn(
        "inline-flex items-center gap-1 text-[var(--brand-primary)] hover:underline",
        className
      )}
    >
      {showIcon && <Phone className="h-3 w-3 shrink-0" aria-hidden />}
      {text}
    </a>
  );
}
