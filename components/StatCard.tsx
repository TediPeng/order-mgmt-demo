import Link from "next/link";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  href,
  accent,
  extra,
}: {
  label: string;
  value: number | string;
  href?: string;
  accent?: string;
  extra?: React.ReactNode;
}) {
  const content = (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={cn("mt-2 text-2xl font-semibold text-slate-900", accent)}>{value}</p>
      {extra && <div className="mt-1 space-y-0.5 text-xs text-slate-500">{extra}</div>}
    </div>
  );
  if (href) {
    return <Link href={href}>{content}</Link>;
  }
  return content;
}
