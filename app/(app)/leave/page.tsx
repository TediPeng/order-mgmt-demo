import { redirect } from "next/navigation";
import { Paperclip } from "lucide-react";
import { readDbLite } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { formatDate, formatDateTime, todayInTz } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { LeaveStatusBadge } from "@/components/ui/Badge";
import { Badge } from "@/components/ui/Badge";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmitButton";
import { Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { LeaveRequestForm } from "@/components/LeaveRequestForm";
import { RequestLeaveButton } from "@/components/RequestLeaveButton";
import { fileLeaveAction, cancelLeaveAction, resubmitLeaveAction, reviewLeaveAction } from "@/lib/actions/leave";

export default async function LeavePage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    filed?: string;
    cancelled?: string;
    reviewed?: string;
    resubmit?: string;
    status?: string;
    type?: string;
    agent?: string;
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

  let queue = canApprove
    ? db.leave_requests.filter((r) => isFullAccess(user.role) || r.supervisor_id === user.id)
    : [];
  if (sp.status) queue = queue.filter((r) => r.status === sp.status);
  if (sp.type) queue = queue.filter((r) => r.leave_type === sp.type);
  if (sp.agent) queue = queue.filter((r) => r.agent_id === sp.agent);
  queue.sort((a, b) => b.created_at.localeCompare(a.created_at));

  const queueAgents = canApprove
    ? db.profiles.filter((p) => (isFullAccess(user.role) ? true : p.team_lead_id === user.id))
    : [];

  const today = todayInTz();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-page-title text-slate-900">Leave Requests</h1>
        {/* Filing now happens through the popup (Section 5) -- also available
            from the Attendance module. Resubmitting a returned request stays
            an inline flow below since it's tied to a specific existing request. */}
        {canFile && !resubmitTarget && <RequestLeaveButton action={fileLeaveAction} today={today} />}
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
            <LeaveRequestForm
              action={async (formData) => {
                "use server";
                formData.set("id", resubmitTarget.id);
                await resubmitLeaveAction(formData);
              }}
              today={today}
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
                        {r.leave_type}
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
            <form className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
              <Select name="status" defaultValue={sp.status || ""}>
                <option value="">All statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="cancelled">Cancelled</option>
                <option value="returned_for_revision">Returned for Revision</option>
              </Select>
              <Select name="type" defaultValue={sp.type || ""}>
                <option value="">All types</option>
                <option value="sick">Sick</option>
                <option value="emergency">Emergency</option>
                <option value="unpaid">Unpaid</option>
              </Select>
              <Select name="agent" defaultValue={sp.agent || ""}>
                <option value="">All agents</option>
                {queueAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.full_name}
                  </option>
                ))}
              </Select>
              <Button type="submit" variant="secondary">
                Filter
              </Button>
            </form>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Agent</th>
                    <th className="px-4 py-2">Filed</th>
                    <th className="px-4 py-2">Dates</th>
                    <th className="px-4 py-2">Type</th>
                    <th className="px-4 py-2">Reason</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {queue.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-2">
                        {byId.get(r.agent_id) || "—"}
                        {r.urgent_review && <Badge className="ml-1 bg-red-100 text-red-700">Urgent</Badge>}
                      </td>
                      <td className="px-4 py-2 text-slate-500">{formatDateTime(r.created_at)}</td>
                      <td className="px-4 py-2">
                        {formatDate(r.leave_start)} – {formatDate(r.leave_end)} ({r.leave_days}d)
                      </td>
                      <td className="px-4 py-2 capitalize">{r.leave_type}</td>
                      <td className="px-4 py-2 max-w-[220px] truncate text-slate-500" title={r.reason}>
                        {r.reason}
                        {r.attachment_path && (
                          <a href={`/api/leave/${r.id}/attachment`} className="ml-1 inline-flex text-[var(--brand-primary)]">
                            <Paperclip className="h-3 w-3" />
                          </a>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <LeaveStatusBadge status={r.status} />
                      </td>
                      <td className="px-4 py-2">
                        {r.status === "pending" ? (
                          <form action={reviewLeaveAction} className="flex flex-wrap items-center gap-1">
                            <input type="hidden" name="id" value={r.id} />
                            <Input name="management_remarks" placeholder="Remarks (optional)" className="w-32 text-xs" />
                            <button
                              name="decision"
                              value="approved"
                              className="rounded bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700"
                            >
                              Approve
                            </button>
                            <ConfirmSubmitButton
                              name="decision"
                              value="rejected"
                              confirmMessage="Reject this leave request? The agent will be notified."
                              className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                            >
                              Reject
                            </ConfirmSubmitButton>
                            <button
                              name="decision"
                              value="returned_for_revision"
                              className="rounded bg-orange-500 px-2 py-1 text-xs font-medium text-white hover:bg-orange-600"
                            >
                              Return
                            </button>
                          </form>
                        ) : (
                          <span className="text-xs text-slate-400">
                            {r.reviewed_by ? `by ${byId.get(r.reviewed_by) || "—"}` : "—"}
                          </span>
                        )}
                        {canViewHistory && (
                          <a
                            href={`/audit-logs?entity_id=${r.id}`}
                            className="ml-2 text-xs font-medium text-slate-500 hover:underline"
                          >
                            History
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                  {queue.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                        No leave requests match this filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
