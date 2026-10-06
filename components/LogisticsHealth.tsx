import { cn } from "@/lib/utils";
import type { LogisticsConnectionHealth } from "@/lib/types";

/** One vocabulary for connection state, used by the connections table and the
 * Logistics overview so the same shop never reads two ways on two screens. */
const HEALTH_STYLES: Record<LogisticsConnectionHealth, { label: string; className: string }> = {
  connected: { label: "Connected", className: "bg-green-100 text-green-700" },
  syncing: { label: "Syncing", className: "bg-blue-100 text-blue-700" },
  // Amber, not red: nothing has failed, but nothing has succeeded recently
  // either — a sync that quietly stopped running looks healthy to any check
  // that only reads the last error.
  degraded: { label: "Degraded", className: "bg-amber-100 text-amber-800" },
  error: { label: "Error", className: "bg-red-100 text-red-700" },
  disabled: { label: "Disabled", className: "bg-slate-200 text-slate-600" },
};

export function LogisticsHealthBadge({ health, className }: { health: LogisticsConnectionHealth; className?: string }) {
  const style = HEALTH_STYLES[health];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        style.className,
        className
      )}
    >
      {style.label}
    </span>
  );
}

/**
 * "2 minutes ago", the way the spec's example writes it.
 *
 * Rendered on the server from an absolute timestamp, so it is the time on the
 * server's clock at render — which is what a page that refreshes itself every
 * 45 seconds wants. A never-synced connection says so in words rather than
 * showing a dash that could be mistaken for a missing field.
 */
export function relativeTime(iso: string | null | undefined, emptyLabel = "Never"): string {
  if (!iso) return emptyLabel;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return emptyLabel;
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 0) return "just now"; // clock skew reads better than "in -3 seconds"
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
