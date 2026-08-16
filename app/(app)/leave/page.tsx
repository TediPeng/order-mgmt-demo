import { redirect } from "next/navigation";
import { readDbLite } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { formatDate, formatDateTime, todayInTz } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { LeaveStatusBadge } from "@/components/ui/Badge";
import { Badge } from "@/components/ui/Badge";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { LeaveRequestForm } from "@/components/LeaveRequestForm";
import { RequestLeaveButton } from "@/components/RequestLeaveButton";
import { LeaveQueueCalendar } from "@/components/LeaveQueueCalendar";
import { LEAVE_TYPE_LABELS } from "@/lib/validation";
import { leaveCountsByDate, leavePickerWindow, maxApprovedPerDay } from "@/lib/leave";
import { fileLeaveAction, cancelLeaveAction, resubmitLeaveAction } from "@/lib/actions/leave";

/** One month either side of a YYYY-MM, in UTC. */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function LeavePage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    filed?: string;
    cancelled?: string;
    reviewed?: string;
    resubmit?: string;
    /** YYYY-MM — the month the queue calendar is showing. */
    month?: string;
  }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDbLite();

  const canFile = can(user.role, "leave", "create", db.role_permissions);
  const canApprove = can(user.role, "leave", "approve", db.role_permissions);
  const canViewHistory = can(user.role, "audit_logs", "view", db.role_permissions);
  if (!canFile && !canApprove) redirect("/dashboard");

  const byId = new Map(db.profiles.map((p) => [p.id, p.full_name]));
  const supervisor = user.team_lead_id ? db.profiles.find((p) => p.id === user.team_lead_id) : null;

  const myRequests = db.leave_requests
    .filter((r) => r.agent_id === user.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const resubmitTarget = sp.resubmit ? myRequests.find((r) => r.id === sp.resubmit && r.status === "returned_for_revision") : null;

  const scopedQueue = canApprove
    ? db.leave_requests.filter((r) => isFullAccess(user.role) || r.supervisor_id === user.id)
    : [];

  /**
   * Who else is away on the same days.
   *
   * The queue arrives newest-filed first, so six people asking for the same
   * Tuesday appear scattered down the list in the order they happened to file —
   * and the one thing an approver has to know before saying yes is how many
   * others already have that day. Counted here, per row.
   *
   * Deliberately counted against the WHOLE scoped queue, not the filtered view:
   * a clash you cannot see because you filtered by agent is still a clash. And
   * only against requests that would actually take somebody off the floor —
   * a cancelled or rejected one is not a clash, it is a row.
   */
  const CLASHABLE = new Set(["pending", "approved"]);
  const clashPool = scopedQueue.filter((r) => CLASHABLE.has(r.status));
  // Inclusive ranges, compared as YYYY-MM-DD strings — the same ordering as
  // dates, without constructing one per comparison.
  const overlaps = (a: { leave_start: string; leave_end: string }, b: { leave_start: string; leave_end: string }) =>
    a.leave_start <= b.leave_end && b.leave_start <= a.leave_end;
  const clashesFor = (r: (typeof scopedQueue)[number]) =>
    clashPool.filter((other) => other.id !== r.id && overlaps(other, r));

  const today = todayInTz();
  // The month the queue calendar draws.
  const queueMonth = /^\d{4}-\d{2}$/.test(sp.month || "") ? sp.month! : today.slice(0, 7);
  const monthHref = (m: string) => `?month=${m}`;

  /** Everything the details panel shows, formatted here so the panel and the
   *  row it came from can never disagree about a date. */
  const detailsFor = (r: (typeof scopedQueue)[number]) => ({
    id: r.id,
    agentName: byId.get(r.agent_id) || "—",
    filedAt: formatDateTime(r.created_at),
    dates: `${formatDate(r.leave_start)} – ${formatDate(r.leave_end)}`,
    days: r.leave_days,
    leaveType: r.leave_type,
    reason: r.reason,
    attachmentHref: r.attachment_path ? `/api/leave/${r.id}/attachment` : null,
    status: r.status,
    urgent: r.urgent_review,
    supervisorName: r.supervisor_id ? byId.get(r.supervisor_id) || null : null,
    remarks: r.management_remarks,
    reviewedBy: r.reviewed_by ? byId.get(r.reviewed_by) || null : null,
    reviewedAt: r.reviewed_at ? formatDateTime(r.reviewed_at) : null,
    clashes: clashesFor(r).map((c) => ({
      name: byId.get(c.agent_id) || "—",
      dates: `${formatDate(c.leave_start)} – ${formatDate(c.leave_end)}`,
      status: c.status,
    })),
  });

  // The grid the queue calendar draws: whole weeks around the month, each day
  // carrying the requests that land on it. Undecided ones are what an approver
  // is here for; approved ones are counted for the cap.
  const queueDays = (() => {
    const [y, m] = queueMonth.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1));
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
    const last = new Date(Date.UTC(y, m, 0));
    const end = new Date(last);
    end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay()));

    const out = [];
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0, 10);
      const onDay = scopedQueue.filter((r) => r.leave_start <= date && date <= r.leave_end);
      out.push({
        date,
        requests: onDay.filter((r) => r.status === "pending").map(detailsFor),
        // Everything settled, newest decision first, so the most recent answer
        // on a contested day is the one read first.
        decided: onDay
          .filter((r) => r.status !== "pending")
          .sort((a, b) => (b.reviewed_at || b.updated_at).localeCompare(a.reviewed_at || a.updated_at))
          .map(detailsFor),
        approved: onDay.filter((r) => r.status === "approved").length,
      });
    }
    return out;
  })();

  // The six weeks the leave form's calendar draws.
  const leaveWindow = leavePickerWindow(today);
  const leaveDays = leaveCountsByDate(db, leaveWindow.from, leaveWindow.to);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-page-title text-slate-900">Leave Requests</h1>
        {/* Filing now happens through the popup (Section 5) -- also available
            from the Attendance module. Resubmitting a returned request stays
            an inline flow below since it's tied to a specific existing request. */}
        {canFile && !resubmitTarget && <RequestLeaveButton action={fileLeaveAction} today={today} leaveDays={leaveDays} cap={maxApprovedPerDay(db)} />}
      </div>

      {sp.error && <Alert kind="error">{sp.error}</Alert>}
      {sp.filed && <Alert kind="success">Leave request submitted.</Alert>}
      {sp.cancelled && <Alert kind="success">Leave request cancelled.</Alert>}
      {sp.reviewed && <Alert kind="success">Leave request updated.</Alert>}

      {canFile && resubmitTarget && (
        <Card>
          <CardHeader>
            <CardTitle>Edit &amp; Resubmit Request</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 rounded-md bg-slate-50 p-3 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs text-slate-400">Name</p>
                <p className="font-medium text-slate-700">{user.full_name}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Email</p>
                <p className="font-medium text-slate-700">{user.email}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Supervisor</p>
                <p className="font-medium text-slate-700">{supervisor?.full_name || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Filing date</p>
                <p className="font-medium text-slate-700">{formatDate(new Date().toISOString())}</p>
              </div>
            </div>

            <input type="hidden" name="id" value={resubmitTarget.id} />
            {/* Resubmitting picks dates like filing does, and the cap applies the
                same way, so it gets the same calendar to pick them in. */}
            <LeaveRequestForm
              action={async (formData) => {
                "use server";
                formData.set("id", resubmitTarget.id);
                await resubmitLeaveAction(formData);
              }}
              today={today}
              leaveDays={leaveDays}
              cap={maxApprovedPerDay(db)}
              defaults={{
                leave_start: resubmitTarget.leave_start,
                leave_end: resubmitTarget.leave_end,
                leave_type: resubmitTarget.leave_type,
                reason: resubmitTarget.reason,
              }}
              submitLabel="Resubmit Request"
            />
            <p className="text-xs text-slate-400">
              Unpaid and Sick leave must be filed at least 3 days in advance. Emergency leave may be filed within 3
              days but will be flagged for urgent review.
            </p>
          </CardContent>
        </Card>
      )}

      {canFile && (
        <Card>
          <CardHeader>
            <CardTitle>My Requests</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {/* Not sticky: this table has no scroll box of its own, so a sticky
                header would pin itself to the page and float over whatever came
                after the card. */}
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2">Filed</th>
                  <th className="px-4 py-2">Dates</th>
                  <th className="px-4 py-2">Days</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Remarks</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {myRequests.map((r) => {
                  const boundCancel = async () => {
                    "use server";
                    await cancelLeaveAction(r.id);
                  };
                  return (
                    <tr key={r.id}>
                      <td className="px-4 py-2 text-slate-500">{formatDate(r.filing_date)}</td>
                      <td className="px-4 py-2">
                        {formatDate(r.leave_start)} – {formatDate(r.leave_end)}
                      </td>
                      <td className="px-4 py-2">{r.leave_days}</td>
                      <td className="px-4 py-2 capitalize">
                        {LEAVE_TYPE_LABELS[r.leave_type]}
                        {r.urgent_review && (
                          <Badge className="ml-1 bg-red-100 text-red-700">Urgent review</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <LeaveStatusBadge status={r.status} />
                      </td>
                      <td className="px-4 py-2 text-slate-500">{r.management_remarks || "—"}</td>
                      <td className="px-4 py-2">
                        <div className="flex justify-end gap-2">
                          {r.status === "pending" && (
                            <ConfirmButton
                              action={boundCancel}
                              label="Cancel"
                              variant="outline"
                              size="sm"
                              confirmTitle="Cancel this leave request?"
                              confirmBody="This cannot be undone; you may file a new request afterward."
                            />
                          )}
                          {r.status === "returned_for_revision" && (
                            <a href={`/leave?resubmit=${r.id}`} className="text-xs font-medium text-[var(--brand-primary)] hover:underline">
                              Edit &amp; Resubmit
                            </a>
                          )}
                          {canViewHistory && (
                            <a href={`/audit-logs?entity_id=${r.id}`} className="text-xs font-medium text-slate-500 hover:underline">
                              History
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {myRequests.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                      You haven&apos;t filed any leave requests yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {canApprove && (
        <Card>
          <CardHeader>
            <CardTitle>Review Queue</CardTitle>
          </CardHeader>
          <CardContent>
            {/* The month first, the list under it. Which day is heavy is not a
                thing a filed-order list can show, and it is the first thing an
                approver needs to know. */}
            <LeaveQueueCalendar
              month={queueMonth}
              days={queueDays}
              today={today}
              cap={maxApprovedPerDay(db)}
              // Changing month drops the day filter: you have gone to look
              // somewhere else, and a list still pinned to a date you can no
              // longer see in the grid is a filter nobody remembers setting.
              prevMonthHref={monthHref(shiftMonth(queueMonth, -1))}
              nextMonthHref={monthHref(shiftMonth(queueMonth, 1))}
            />

          </CardContent>
        </Card>
      )}
    </div>
  );
}
