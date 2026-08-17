"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CopyPlus, CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { BulkAssignModal } from "@/components/BulkAssignModal";
import { CopyScheduleModal } from "@/components/CopyScheduleModal";
import type { AgentOption } from "@/components/ScheduleEventModal";

/**
 * Filling a cut-off, rather than editing a day of it.
 *
 * Both of these used to hang off the month calendar's toolbar and went with it
 * when the calendar was removed. They are how a fortnight is set in the first
 * place — nobody rosters twenty agents by opening three hundred dropdowns — so
 * they moved onto the grid instead of being lost with the view that happened to
 * host them.
 *
 * Behind schedules.assign, the same grant that gated them before: assigning a
 * month to a team at once is a different act from correcting one cell.
 */
export function ScheduleBulkActions({ agents }: { agents: AgentOption[] }) {
  const router = useRouter();
  const [showBulk, setShowBulk] = useState(false);
  const [showCopy, setShowCopy] = useState(false);

  // The grid is server-rendered from the same rows these write, so it has to be
  // asked again once they are done — otherwise a fortnight is assigned and the
  // screen still shows it empty.
  const done = () => router.refresh();

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setShowBulk(true)}>
        <CalendarRange className="h-4 w-4" /> Bulk Assign
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => setShowCopy(true)}>
        <CopyPlus className="h-4 w-4" /> Copy Schedule
      </Button>

      {showBulk && <BulkAssignModal agents={agents} onClose={() => setShowBulk(false)} onDone={done} />}
      {showCopy && <CopyScheduleModal agents={agents} onClose={() => setShowCopy(false)} onDone={done} />}
    </>
  );
}
