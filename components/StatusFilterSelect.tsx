"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/Field";

export interface StatusFilterOption {
  /** "" is All Leads. Otherwise the OrderStatus. */
  value: string;
  label: string;
  href: string;
  count: number;
}

/**
 * Every status, as a dropdown.
 *
 * The cards can only show a handful before they wrap into three rows and take
 * the leads table below the fold, so the five the floor works in keep their
 * cards and the rest live here. The href for each option is built on the server
 * by the same hrefFor() the cards use, so choosing a status keeps whatever other
 * filters are already on the page — this component only navigates.
 */
export function StatusFilterSelect({ options, value }: { options: StatusFilterOption[]; value: string }) {
  const router = useRouter();

  return (
    <label className="flex items-center gap-2">
      <span className="whitespace-nowrap text-xs font-medium text-slate-500">Status</span>
      <Select
        value={value}
        aria-label="Filter leads by status"
        onChange={(e) => {
          const next = options.find((o) => o.value === e.target.value);
          if (next) router.push(next.href);
        }}
        className="min-w-[13rem]"
      >
        {options.map((o) => (
          <option key={o.value || "all"} value={o.value}>
            {o.label} ({o.count})
          </option>
        ))}
      </Select>
    </label>
  );
}
