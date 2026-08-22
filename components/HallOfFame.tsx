import { Crown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface HallOfFameRow {
  agent_id: string;
  full_name: string;
  avatar_url: string | null;
  /** Already formatted for the metric being ranked — pesos, a percentage, or a
   * count. The page knows which; this only has to place it. */
  display: string;
}

/** Initials, for an agent with no photo. Two letters at most: three is a
 * monogram nobody reads at 56 pixels. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function Avatar({
  row,
  size,
  ring,
}: {
  row: HallOfFameRow;
  size: number;
  ring: string;
}) {
  return (
    <div
      className={cn("relative shrink-0 overflow-hidden rounded-full bg-amber-100 ring-2 ring-offset-2 ring-offset-[#3a2c10]", ring)}
      style={{ width: size, height: size }}
    >
      {row.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatars are
        // arbitrary remote URLs; next/image would need every host allow-listed.
        <img src={row.avatar_url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center font-semibold text-amber-900"
          style={{ fontSize: size * 0.36 }}
        >
          {initials(row.full_name)}
        </div>
      )}
    </div>
  );
}

/** One plinth. The centre is tallest and carries the crown; the numbers under
 * the name are the metric, not a rank, because the rank is the position. */
function Plinth({
  row,
  place,
  isYou,
}: {
  row: HallOfFameRow | undefined;
  place: 1 | 2 | 3;
  isYou: boolean;
}) {
  const height = place === 1 ? "h-32" : place === 2 ? "h-24" : "h-20";
  const face =
    place === 1
      ? "bg-gradient-to-b from-[#f0c000] to-[#b08908] text-[#3a2c10]"
      : place === 2
        ? "bg-gradient-to-b from-[#d8d3c4] to-[#a8a293] text-[#2b2820]"
        : "bg-gradient-to-b from-[#d4a373] to-[#a97b4f] text-[#2f1f10]";
  const ring = place === 1 ? "ring-[#f0c000]" : place === 2 ? "ring-[#d8d3c4]" : "ring-[#d4a373]";

  if (!row) {
    return (
      <div className="flex w-full flex-col items-center justify-end">
        <div className={cn("w-full rounded-t-lg bg-white/5", height)} />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center justify-end">
      <div className="relative mb-3 flex flex-col items-center">
        {place === 1 && <Crown className="mb-1 h-6 w-6 text-[#f0c000]" aria-hidden />}
        <Avatar row={row} size={place === 1 ? 88 : 68} ring={ring} />
      </div>
      <div className={cn("w-full rounded-t-lg px-2 py-2 text-center shadow-lg", face, height, "flex flex-col justify-center")}>
        <p className="truncate text-sm font-semibold" title={row.full_name}>
          {row.full_name}
          {isYou && <span className="ml-1 rounded bg-black/20 px-1 text-[10px] font-bold uppercase">You</span>}
        </p>
        <p className="text-lg font-bold tabular-nums">{row.display}</p>
      </div>
    </div>
  );
}

/**
 * The ranking as a Hall of Fame: a podium for the top three, everybody else
 * below it.
 *
 * The same rows, the same metric and the same scope as the bar chart beside it
 * — this is a way of reading them, not a second answer. A leaderboard is worth
 * having because a bar chart is read by management and a podium is read by the
 * floor, and it is the floor whose week it describes.
 *
 * Ranks 4 and down are a plain grid rather than a lengthening tail: the point
 * of the arrangement is that everybody is on it, not that the bottom is
 * conspicuous.
 */
export function HallOfFame({
  rows,
  metricLabel,
  currentUserId,
}: {
  rows: HallOfFameRow[];
  metricLabel: string;
  currentUserId: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white py-16 text-center text-sm text-slate-400">
        No agents in scope for this range.
      </div>
    );
  }

  const [first, second, third, ...rest] = rows;

  return (
    <div className="overflow-hidden rounded-xl border border-[#5a4416] bg-gradient-to-b from-[#4a3512] to-[#2d2109] shadow-lg">
      <div className="border-b border-[#5a4416] bg-[#3a2c10] px-5 py-3 text-center">
        <h2 className="text-lg font-bold tracking-wide text-[#f0c000]">Hall of Fame</h2>
        <p className="mt-0.5 text-xs uppercase tracking-widest text-amber-200/70">{metricLabel}</p>
      </div>

      {/* Second, first, third — the order they stand in, not the order they
          rank in. */}
      <div className="bg-[#3a2c10] px-4 pt-8">
        <div className="mx-auto flex max-w-xl items-end gap-2">
          <Plinth row={second} place={2} isYou={second?.agent_id === currentUserId} />
          <Plinth row={first} place={1} isYou={first?.agent_id === currentUserId} />
          <Plinth row={third} place={3} isYou={third?.agent_id === currentUserId} />
        </div>
      </div>

      {rest.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 px-5 py-7 sm:grid-cols-3 lg:grid-cols-4">
          {rest.map((row, i) => (
            <div key={row.agent_id} className="flex flex-col items-center text-center">
              <div className="relative">
                <Avatar row={row} size={56} ring="ring-[#8f660c]" />
                <span className="absolute -bottom-1 -right-1 rounded-full bg-[#8f660c] px-1.5 text-[10px] font-bold text-white tabular-nums">
                  {i + 4}
                </span>
              </div>
              <p className="mt-2 max-w-full truncate text-xs font-medium text-amber-50" title={row.full_name}>
                {row.full_name}
                {row.agent_id === currentUserId && (
                  <span className="ml-1 rounded bg-[#f0c000] px-1 text-[9px] font-bold uppercase text-[#3a2c10]">You</span>
                )}
              </p>
              <p className="text-sm font-semibold text-[#f0c000] tabular-nums">{row.display}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
