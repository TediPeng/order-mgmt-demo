import { cn } from "@/lib/utils";
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/attendance-logic";
import type { AttendanceStatus } from "@/lib/types";

export function AttendanceStatusBadge({ status }: { status: AttendanceStatus }) {
  return (
    <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", STATUS_COLORS[status])}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function LateFlag({ minutesLate }: { minutesLate: number }) {
  if (!minutesLate) return null;
  return (
    <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
      {minutesLate}m late
    </span>
  );
}

export function OverBreakFlag({ minutes }: { minutes: number }) {
  if (!minutes) return null;
  return (
    <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
      +{minutes}m over break
    </span>
  );
}
