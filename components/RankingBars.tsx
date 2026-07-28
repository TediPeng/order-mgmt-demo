import { cn, formatCurrency, } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";

export interface RankingRow {
  agent_id: string;
  full_name: string;
  avatar_url: string | null;
  amount: number;
  orders: number;
  conversion_rate: number | null;
  barValue: number; // resolved value for the selected ranking metric -- drives progress-bar length
}

/** Horizontal performance bars for Agent Ranking (Section 3): one bar per
 * agent, sorted by the caller, bar length = value / top agent's value. */
export function RankingBars({
  rows,
  topValue,
  currentUserId,
  compact = false,
}: {
  rows: RankingRow[];
  topValue: number;
  currentUserId?: string;
  compact?: boolean;
}) {
  return (
    <div className="space-y-2">
      {rows.map((r, idx) => {
        const pct = topValue > 0 ? Math.min(100, Math.max(0, (Math.abs(r.barValue) / Math.abs(topValue)) * 100)) : 0;
        const isMe = r.agent_id === currentUserId;
        return (
          <div
            key={r.agent_id}
            className={cn(
              "flex items-center gap-3 rounded-lg border p-3 transition-colors motion-reduce:transition-none",
              isMe ? "border-[var(--brand-primary)] bg-[var(--brand-primary-10)]" : "border-slate-200 bg-white"
            )}
          >
            <span className="w-6 shrink-0 text-center text-sm font-semibold text-slate-500">#{idx + 1}</span>
            <Avatar name={r.full_name} src={r.avatar_url} size="md" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium text-slate-800">{r.full_name}</p>
                {isMe && (
                  <span className="shrink-0 rounded-full bg-[var(--brand-primary)] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    You
                  </span>
                )}
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-[var(--brand-primary)] transition-all duration-200 motion-reduce:transition-none"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
            {compact ? (
              <p className="shrink-0 text-sm font-semibold text-slate-800">{formatCurrency(r.amount)}</p>
            ) : (
              <div className="hidden shrink-0 gap-4 text-right text-xs text-slate-500 sm:flex">
                <div>
                  <p className="text-slate-400">Sales</p>
                  <p className="font-semibold text-slate-800">{formatCurrency(r.amount)}</p>
                </div>
                <div>
                  <p className="text-slate-400">Qty</p>
                  <p className="font-semibold text-slate-800">{r.orders}</p>
                </div>
                <div>
                  <p className="text-slate-400">Conv.</p>
                  <p className="font-semibold text-slate-800">{r.conversion_rate === null ? "—" : `${r.conversion_rate}%`}</p>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {rows.length === 0 && (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
          No agents in scope for this range.
        </p>
      )}
    </div>
  );
}
