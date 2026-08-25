"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Which day the board is showing.
 *
 * The monitor could only ever answer "what is the floor doing now", which meant
 * the question people actually ask of it — what did the floor do yesterday —
 * was answerable only by having been watching at the time. The board already
 * reads every figure per day; it simply had the day hard-coded.
 *
 * The date rides in the URL rather than in state so it survives the board's own
 * refresh, can be sent to somebody, and steps through with the back button. The
 * state filter is carried along, so paging from one day to the next does not
 * silently drop it.
 */
export function MonitorDatePicker({ date, today }: { date: string; today: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function go(next: string) {
    if (next > today) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next === today) params.delete("date");
    else params.set("date", next);
    router.push(`/attendance/monitor?${params.toString()}`, { scroll: false });
  }

  const isToday = date === today;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => go(shift(date, -1))} aria-label="Previous day">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Input
        type="date"
        value={date}
        // No future: the board would be empty, which reads as a fault rather
        // than as a day that has not happened.
        max={today}
        onChange={(e) => e.target.value && go(e.target.value)}
        className="w-auto"
        aria-label="Day to show"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => go(shift(date, 1))}
        disabled={isToday}
        aria-label="Next day"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      {!isToday && (
        <Button type="button" variant="secondary" size="sm" onClick={() => go(today)}>
          Today
        </Button>
      )}
    </div>
  );
}
