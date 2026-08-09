"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import type { DateClickArg } from "@fullcalendar/interaction";
import type { EventClickArg, EventDropArg } from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";
import { Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { ScheduleEventModal, type AgentOption, type ScheduleModalState } from "@/components/ScheduleEventModal";
import { BulkAssignModal } from "@/components/BulkAssignModal";
import { CopyScheduleModal } from "@/components/CopyScheduleModal";

// Must match SCHEDULE_STATUS_COLORS in app/api/schedule/route.ts — the swatch
// here is what tells someone what the coloured bar in the grid means.
const LEGEND = [
  { color: "bg-green-700", label: "Scheduled for Duty" },
  { color: "bg-blue-700", label: "Rest Day" },
  { color: "bg-orange-700", label: "Suspension" },
  { color: "bg-slate-500", label: "No Schedule Assigned" },
];

export function ScheduleCalendar({
  agents,
  canCreate,
  canEdit,
  canDelete,
  canBulk,
}: {
  agents: AgentOption[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canBulk: boolean;
}) {
  const router = useRouter();
  const calendarRef = useRef<InstanceType<typeof FullCalendar>>(null);
  const [agentFilter, setAgentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [q, setQ] = useState("");
  const filtersRef = useRef({ agentFilter, statusFilter, q });
  filtersRef.current = { agentFilter, statusFilter, q };
  const [showBulk, setShowBulk] = useState(false);
  const [showCopy, setShowCopy] = useState(false);
  const [modalState, setModalState] = useState<ScheduleModalState | null>(null);

  const fetchEvents = useCallback(async (fetchInfo: { startStr: string; endStr: string }) => {
    const params = new URLSearchParams({
      start: fetchInfo.startStr.slice(0, 10),
      end: fetchInfo.endStr.slice(0, 10),
    });
    const { agentFilter, statusFilter, q } = filtersRef.current;
    if (agentFilter) params.set("agent", agentFilter);
    if (statusFilter) params.set("status", statusFilter);
    if (q) params.set("q", q);
    const res = await fetch(`/api/schedule?${params.toString()}`);
    if (!res.ok) return [];
    return res.json();
  }, []);

  function refetch() {
    calendarRef.current?.getApi().refetchEvents();
    router.refresh();
  }

  // Section 5: summary cards and the calendar "update in real time / on data
  // change like the other dashboards" -- no websocket backend here, so this
  // periodically refetches events (same polling approach as AppShell).
  useEffect(() => {
    const id = setInterval(() => calendarRef.current?.getApi().refetchEvents(), 30000);
    return () => clearInterval(id);
  }, []);

  function handleDateClick(arg: DateClickArg) {
    if (!canCreate) return;
    setModalState({ mode: "create", date: arg.dateStr.slice(0, 10) });
  }

  function handleEventClick(arg: EventClickArg) {
    const ep = arg.event.extendedProps as Record<string, unknown>;
    setModalState({
      mode: "edit",
      eventId: arg.event.id,
      data: {
        agent_id: String(ep.agent_id),
        agent_name: String(ep.agent_name),
        schedule_date: String(ep.schedule_date),
        duty_start: (ep.duty_start as string) || null,
        duty_end: (ep.duty_end as string) || null,
        is_rest_day: !!ep.is_rest_day,
        status: String(ep.status),
        remarks: (ep.remarks as string) || null,
        suspension_id: (ep.suspension_id as string) || null,
      },
    });
  }

  async function handleEventDrop(arg: EventDropArg) {
    if (!canEdit) {
      arg.revert();
      return;
    }
    const newDate = arg.event.startStr.slice(0, 10);
    const res = await fetch(`/api/schedule/${arg.event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schedule_date: newDate }),
    });
    const json = await res.json();
    if (!json.ok) {
      if (json.code === "conflict" && window.confirm(json.error)) {
        const retry = await fetch(`/api/schedule/${arg.event.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ schedule_date: newDate, confirm_replace: true }),
        });
        const retryJson = await retry.json();
        if (!retryJson.ok) {
          window.alert(retryJson.error);
          arg.revert();
        } else {
          refetch();
        }
        return;
      }
      window.alert(json.error);
      arg.revert();
    } else {
      refetch();
    }
  }

  async function handleEventResize(arg: EventResizeDoneArg) {
    if (!canEdit) {
      arg.revert();
      return;
    }
    const startTime = arg.event.startStr.slice(11, 16);
    const endTime = arg.event.endStr ? arg.event.endStr.slice(11, 16) : startTime;
    const res = await fetch(`/api/schedule/${arg.event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duty_start: startTime, duty_end: endTime }),
    });
    const json = await res.json();
    if (!json.ok) {
      window.alert(json.error);
      arg.revert();
    } else {
      refetch();
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
        {LEGEND.map((l) => (
          <span key={l.label} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${l.color}`} /> {l.label}
          </span>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input placeholder="Search agent name" value={q} onChange={(e) => setQ(e.target.value)} className="w-56" />
        <Select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} className="w-52">
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.full_name}
            </option>
          ))}
        </Select>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-44">
          <option value="">All statuses</option>
          <option value="scheduled">Scheduled</option>
          <option value="rest_day">Rest Day</option>
          <option value="suspension">Suspension</option>
        </Select>
        <button
          type="button"
          onClick={refetch}
          className="rounded-md bg-[var(--brand-primary)] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          Apply Filters
        </button>
        {canBulk && (
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowBulk(true)}>
              Multi-Assign / Bulk / Recurring
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setShowCopy(true)}>
              Copy Schedule
            </Button>
          </div>
        )}
      </div>

      <div className="schedule-calendar rounded-lg border border-slate-200 bg-white p-2">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek" }}
          events={fetchEvents}
          editable={canEdit}
          eventResizableFromStart={canEdit}
          dateClick={handleDateClick}
          eventClick={handleEventClick}
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          height="auto"
          firstDay={1}
          // Every schedule is a filled bar in its status colour with just the
          // name on it — the same highlight the rest-day entries always had,
          // now applied to duty as well. Left global rather than per-view:
          // FullCalendar only honours eventDisplay at the top level, and in
          // the time-grid views a timed event is drawn as a block regardless.
          eventDisplay="block"
          // The time itself is dropped from the month grid only. Week and day
          // views keep it, where position already implies the hour and the
          // label is the confirmation.
          views={{ dayGridMonth: { displayEventTime: false } }}
        />
      </div>

      {modalState && (
        <ScheduleEventModal
          state={modalState}
          agents={agents}
          canEdit={canEdit}
          canDelete={canDelete}
          onClose={() => setModalState(null)}
          onSaved={() => {
            setModalState(null);
            refetch();
          }}
          onDeleted={() => {
            setModalState(null);
            refetch();
          }}
        />
      )}

      {showBulk && (
        <BulkAssignModal
          agents={agents}
          onClose={() => setShowBulk(false)}
          onDone={() => {
            setShowBulk(false);
            refetch();
          }}
        />
      )}
      {showCopy && (
        <CopyScheduleModal
          agents={agents}
          onClose={() => setShowCopy(false)}
          onDone={() => {
            setShowCopy(false);
            refetch();
          }}
        />
      )}
    </div>
  );
}
