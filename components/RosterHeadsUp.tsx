import { cn } from "@/lib/utils";

/**
 * Who cannot be rostered this cut-off, and who is already spoken for.
 *
 * One component for both roster screens. Create Schedule works this out in the
 * browser as it pages between cut-offs; the roster page works it out on the
 * server from the URL. The two arrive by different routes and must not look
 * like two different features — a supervisor moving between them is reading the
 * same fact about the same people.
 *
 * Presentational on purpose: it is handed finished chips rather than
 * suspensions and leave requests, because the two callers have different shapes
 * to hand it and neither should have to pretend otherwise.
 */
export interface HeadsUpEntry {
  /** Stable across renders — an agent id plus the span's start is enough. */
  key: string;
  name: string;
  /** "Aug 22 – Aug 24", already clamped to the period on screen. */
  span: string;
  /** Hover detail: the suspension's reason, or the kind of leave. */
  title?: string;
}

export function RosterHeadsUp({
  periodLabel,
  suspended,
  leave,
  action,
  className,
}: {
  /** "Aug 13 – 27", for the sentence shown when there is nothing to report. */
  periodLabel: string;
  suspended: HeadsUpEntry[];
  leave: HeadsUpEntry[];
  /** Optional control belonging to the leave row — Create Schedule offers to
   * write the days in; the roster page has nothing to offer. */
  action?: React.ReactNode;
  className?: string;
}) {
  const empty = suspended.length === 0 && leave.length === 0;

  return (
    <div className={cn("rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5", className)}>
      {empty ? (
        <p className="text-xs text-slate-500">
          No suspensions and no approved leave in {periodLabel}. Everyone on the roster is available.
        </p>
      ) : (
        <div className="space-y-2">
          {suspended.length > 0 && (
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Suspended ({suspended.length})
              </span>
              {suspended.map((e) => (
                <span
                  key={e.key}
                  title={e.title}
                  className="inline-flex items-center gap-1.5 rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-white"
                >
                  {e.name}
                  <span className="opacity-70">{e.span}</span>
                </span>
              ))}
              <span className="text-[11px] text-slate-400">Locked — lift it from Disciplinary.</span>
            </div>
          )}
          {leave.length > 0 && (
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Approved leave ({leave.length})
              </span>
              {leave.map((e) => (
                <span
                  key={e.key}
                  title={e.title}
                  className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800"
                >
                  {e.name}
                  <span className="opacity-70">{e.span}</span>
                </span>
              ))}
              {action}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
