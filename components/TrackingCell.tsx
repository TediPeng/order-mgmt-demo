/** Pancake reports tracking as `tracking_link` — a full courier URL, often 200+
 * characters. Printed raw it stretched the row far past the viewport and pushed
 * every other column out of reach. A URL renders as a short link instead; a
 * plain code (some couriers send one via `partner.extend_code`) still shows as
 * text. The full value stays available via the title attribute either way.
 *
 * Shared by the agent and the management leads tables: the same column, the same
 * hazard, and a courier link that is readable in one and unusable in the other
 * would only be a bug waiting to be filed twice. */
export function TrackingCell({ value }: { value: string | null }) {
  if (!value) return <span className="text-slate-400">Not Available</span>;

  const isUrl = /^https?:\/\//i.test(value);
  if (!isUrl) {
    return (
      <span title={value} className="block max-w-[12rem] truncate">
        {value}
      </span>
    );
  }

  return (
    <a
      href={value}
      target="_blank"
      rel="noopener noreferrer"
      title={value}
      onClick={(e) => e.stopPropagation()}
      className="text-[var(--brand-primary)] hover:underline"
    >
      Track parcel ↗
    </a>
  );
}
