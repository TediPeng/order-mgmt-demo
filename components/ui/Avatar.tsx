import { cn, initials } from "@/lib/utils";

const SIZES = {
  sm: "h-7 w-7 text-[10px]",
  md: "h-9 w-9 text-xs",
  lg: "h-16 w-16 text-lg",
} as const;

/** Deterministic colour from the name, so the same person keeps the same
 * placeholder everywhere rather than flickering between renders. */
const PALETTE = [
  "bg-blue-100 text-blue-700",
  "bg-teal-100 text-teal-700",
  "bg-violet-100 text-violet-700",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-700",
  "bg-emerald-100 text-emerald-700",
  "bg-indigo-100 text-indigo-700",
];

function paletteFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

/** Profile picture, falling back to coloured initials when none is uploaded.
 * Used in the header, account profile, ranking, user lists and audit rows. */
export function Avatar({
  name,
  src,
  size = "md",
  className,
}: {
  name: string;
  src?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  if (src) {
    return (
      // Stored in Supabase Storage and served through our own route, so
      // next/image optimisation would add a hop for no benefit here.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={`${name} profile picture`}
        className={cn("shrink-0 rounded-full object-cover", SIZES[size], className)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        SIZES[size],
        paletteFor(name),
        className
      )}
      title={name}
    >
      {initials(name) || "?"}
    </span>
  );
}
