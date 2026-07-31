import { cn } from "@/lib/utils";

/**
 * The title row every page opens with: heading (and optional one-line
 * description) on the left, primary actions on the right.
 *
 * Shared so page titles keep one size and actions land in the same place on
 * every screen — the thing that most made the old per-page headers feel
 * inconsistent. Sits directly under the breadcrumb rendered by the shell.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h1 className="text-page-title text-slate-900">{title}</h1>
        {description && <p className="mt-0.5 text-control text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
