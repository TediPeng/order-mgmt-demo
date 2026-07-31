import Link from "next/link";
import { cn } from "@/lib/utils";

/** Accent per metric, drawn from the existing status palette so a KPI card and
 * its status badge never disagree about what "returned" looks like. */
export type StatTone = "brand" | "green" | "amber" | "maroon" | "slate" | "blue";

const TONE: Record<StatTone, { bar: string; chip: string }> = {
  brand: { bar: "bg-[var(--brand-primary)]", chip: "bg-[var(--brand-primary-10)] text-[var(--brand-primary)]" },
  green: { bar: "bg-green-500", chip: "bg-green-100 text-green-700" },
  amber: { bar: "bg-amber-500", chip: "bg-amber-100 text-amber-800" },
  maroon: { bar: "bg-red-900", chip: "bg-red-100 text-red-900" },
  slate: { bar: "bg-slate-400", chip: "bg-slate-100 text-slate-600" },
  blue: { bar: "bg-blue-500", chip: "bg-blue-100 text-blue-700" },
};

/**
 * The single KPI card used across every dashboard and report.
 *
 * One component rather than per-page markup, so every metric shares a size, a
 * weight and an accent vocabulary. CoreUI floods the whole card with a
 * saturated colour; here the accent is a thin top bar plus the icon chip, which
 * keeps the number itself at full contrast in both light and dark.
 *
 * `href` makes the entire card the click target, preserving the existing
 * click-through-to-a-filtered-list behaviour.
 */
export function StatCard({
  label,
  value,
  href,
  accent,
  extra,
  tone = "brand",
  icon: Icon,
}: {
  label: string;
  value: number | string;
  href?: string;
  /** Escape hatch for a one-off value colour; prefer `tone`. */
  accent?: string;
  extra?: React.ReactNode;
  tone?: StatTone;
  icon?: React.ElementType;
}) {
  const t = TONE[tone];

  const content = (
    <div
      className={cn(
        "relative h-full overflow-hidden rounded-lg border border-slate-200 bg-white p-4 transition-colors duration-150",
        href && "hover:border-slate-300"
      )}
    >
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-0.5", t.bar)} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
          <p className={cn("mt-1 text-card-value text-slate-900", accent)}>{value}</p>
          {extra && <div className="mt-0.5 space-y-0.5 text-xs text-slate-400">{extra}</div>}
        </div>
        {Icon && (
          <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-md", t.chip)}>
            <Icon className="h-[18px] w-[18px]" aria-hidden />
          </span>
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
      >
        {content}
      </Link>
    );
  }
  return content;
}

/** Consistent responsive grid for a row of KPI cards. */
export function StatGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4", className)}>{children}</div>;
}
