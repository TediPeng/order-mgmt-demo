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

/** The three metals, and the plain gold used from fourth place down. */
const MEDAL = {
  1: { ring: "#f0c000", badge: "from-[#ffdc5e] to-[#c99a06]", face: "from-[#f0c000] to-[#a87f05]", ink: "#3a2c10" },
  2: { ring: "#dcd8cc", badge: "from-[#f2efe8] to-[#a8a293]", face: "from-[#dcd8cc] to-[#9d978a]", ink: "#2b2820" },
  3: { ring: "#d9a273", badge: "from-[#eec49b] to-[#a97b4f]", face: "from-[#d9a273] to-[#a06f45]", ink: "#2f1f10" },
} as const;

function Avatar({ row, size, ring }: { row: HallOfFameRow; size: number; ring: string }) {
  return (
    <div
      className="overflow-hidden rounded-full bg-[#f7ecd0]"
      style={{ width: size, height: size, boxShadow: `0 0 0 3px ${ring}, 0 0 0 6px rgba(0,0,0,.28)` }}
    >
      {row.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatars are
        // arbitrary remote URLs; next/image would need every host allow-listed.
        <img src={row.avatar_url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center font-semibold text-[#8a5a1a]"
          style={{ fontSize: size * 0.34 }}
        >
          {initials(row.full_name)}
        </div>
      )}
    </div>
  );
}

/** The rank, as a medal that overlaps the portrait. The number is the point —
 * the podium shows position by height, but height is only readable next to its
 * neighbours, and the number is readable on its own. */
function Medal({ place, size = 26 }: { place: 1 | 2 | 3; size?: number }) {
  const m = MEDAL[place];
  return (
    <span
      className={cn(
        "absolute left-1/2 grid -translate-x-1/2 place-items-center rounded-full bg-gradient-to-b font-bold tabular-nums shadow-md",
        m.badge
      )}
      style={{ bottom: -size / 2.6, width: size, height: size, fontSize: size * 0.55, color: m.ink, boxShadow: "0 2px 6px rgba(0,0,0,.45)" }}
    >
      {place}
    </span>
  );
}

function Plinth({ row, place, isYou }: { row: HallOfFameRow | undefined; place: 1 | 2 | 3; isYou: boolean }) {
  const m = MEDAL[place];
  const height = place === 1 ? 128 : place === 2 ? 100 : 84;

  if (!row) {
    return (
      <div className="flex w-full flex-col items-center justify-end">
        <div className="w-full rounded-t-md bg-white/[.04]" style={{ height }} />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center justify-end">
      <div className="relative mb-4 flex flex-col items-center">
        {place === 1 && (
          <>
            {/* The spotlight. Behind the winner only — a stage lit evenly has
                no focus, which is the one thing a podium is for. */}
            <div
              aria-hidden
              className="pointer-events-none absolute -z-10 h-56 w-56 rounded-full"
              style={{ background: "radial-gradient(circle, rgba(240,192,0,.28) 0%, rgba(240,192,0,0) 68%)", top: -46 }}
            />
            <Crown className="mb-1.5 h-7 w-7 text-[#f0c000] drop-shadow" aria-hidden />
          </>
        )}
        <div className="relative">
          <Avatar row={row} size={place === 1 ? 92 : 70} ring={m.ring} />
          <Medal place={place} size={place === 1 ? 30 : 26} />
        </div>
      </div>

      {/* Two tones make the box read as a box: a lit top edge, then the face. */}
      <div className="w-full">
        <div className={cn("h-2 rounded-t-md bg-gradient-to-b", m.face, "brightness-125")} />
        <div
          className={cn("flex flex-col justify-center rounded-b-md bg-gradient-to-b px-2 pb-3 pt-2 text-center", m.face)}
          style={{ height, color: m.ink, boxShadow: "inset 0 -8px 16px rgba(0,0,0,.18)" }}
        >
          <p className="truncate text-[13px] font-semibold leading-tight" title={row.full_name}>
            {row.full_name}
          </p>
          {isYou && (
            <span className="mx-auto mt-0.5 rounded bg-black/25 px-1.5 text-[9px] font-bold uppercase tracking-wide">
              You
            </span>
          )}
          <p className={cn("mt-1 font-bold tabular-nums", place === 1 ? "text-xl" : "text-base")}>{row.display}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * The ranking as a Hall of Fame: a podium for the top three, everybody else
 * below it.
 *
 * The same rows, the same metric and the same scope as the bar chart beside it
 * — this is a way of reading them, not a second answer. A bar chart is read by
 * management and a podium is read by the floor, and it is the floor whose week
 * it describes.
 *
 * Ranks four and down are a plain grid rather than a lengthening tail: the
 * point of the arrangement is that everybody is on it, not that the bottom is
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
    <div className="overflow-hidden rounded-xl border border-[#6b5117] shadow-xl">
      <div className="border-b border-[#6b5117] bg-gradient-to-b from-[#4a3512] to-[#3a2c10] px-5 py-4 text-center">
        <h2 className="text-xl font-bold tracking-wide text-[#f0c000] drop-shadow-sm">Hall of Fame</h2>
        <p className="mt-1 text-[11px] uppercase tracking-[.18em] text-amber-200/70">{metricLabel}</p>
      </div>

      <div
        className="px-4 pb-2 pt-10"
        style={{
          background:
            "radial-gradient(120% 70% at 50% 0%, #5c441a 0%, #40300f 45%, #2c2109 100%)",
        }}
      >
        {/* Second, first, third — the order they stand in, not the order they
            rank in. */}
        <div className="mx-auto flex max-w-lg items-end gap-2 sm:gap-3">
          <Plinth row={second} place={2} isYou={second?.agent_id === currentUserId} />
          <Plinth row={first} place={1} isYou={first?.agent_id === currentUserId} />
          <Plinth row={third} place={3} isYou={third?.agent_id === currentUserId} />
        </div>
        {/* The floor the podium stands on. */}
        <div className="mx-auto mt-0 h-3 max-w-xl rounded-b-lg bg-gradient-to-b from-black/35 to-transparent" />
      </div>

      {rest.length > 0 && (
        <div className="grid grid-cols-2 gap-3 bg-[#2c2109] px-4 pb-6 pt-5 sm:grid-cols-3 lg:grid-cols-4">
          {rest.map((row, i) => {
            const isYou = row.agent_id === currentUserId;
            return (
              <div
                key={row.agent_id}
                className={cn(
                  "flex flex-col items-center rounded-lg border px-2 py-3 text-center transition-colors",
                  isYou ? "border-[#f0c000]/60 bg-[#f0c000]/[.08]" : "border-white/[.07] bg-white/[.03]"
                )}
              >
                <div className="relative">
                  <Avatar row={row} size={54} ring="#8f660c" />
                  <span
                    className="absolute -bottom-2 left-1/2 grid h-5 w-5 -translate-x-1/2 place-items-center rounded-full bg-[#8f660c] text-[10px] font-bold text-amber-50 tabular-nums"
                    style={{ boxShadow: "0 2px 5px rgba(0,0,0,.5)" }}
                  >
                    {i + 4}
                  </span>
                </div>
                <p className="mt-3.5 max-w-full truncate text-xs font-medium text-amber-50" title={row.full_name}>
                  {row.full_name}
                </p>
                {isYou && (
                  <span className="mt-0.5 rounded bg-[#f0c000] px-1 text-[9px] font-bold uppercase text-[#3a2c10]">You</span>
                )}
                <p className="mt-0.5 text-sm font-semibold text-[#f0c000] tabular-nums">{row.display}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
