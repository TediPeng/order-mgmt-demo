import { redirect } from "next/navigation";
import Link from "next/link";
import { Paperclip } from "lucide-react";
import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { ATTENDANCE_STATUSES } from "@/lib/validation";
import { STATUS_LABELS } from "@/lib/attendance-logic";
import { formatDate, formatTime } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Label, Select, Textarea } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { AttendanceStatusBadge } from "@/components/ui/AttendanceBadge";
import { createOrUpdateAttendanceAction } from "@/lib/actions/attendance-manage";
import type { AttendanceStatus } from "@/lib/types";

export default async function AttendanceManagePage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; saved?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = readDb();

  const canCreate = can(user.role, "attendance", "create", db.role_permissions);
  const canEdit = can(user.role, "attendance", "edit", db.role_permissions);
  if (!canCreate && !canEdit) redirect("/attendance");

  const employees = isFullAccess(user.role)
    ? db.profiles.filter((p) => p.is_active)
    : db.profiles.filter((p) => p.is_active && (p.team_lead_id === user.id || p.id === user.id));

  const editing = sp.edit ? db.attendance.find((a) => a.id === sp.edit) : null;
  const byId = new Map(db.profiles.map((p) => [p.id, p.full_name]));

  const employeeIds = new Set(employees.map((e) => e.id));
  const records = db.attendance
    .filter((a) => employeeIds.has(a.user_id))
    .sort((a, b) => b.work_date.localeCompare(a.work_date))
    .slice(0, 25);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Attendance Management</h1>

      {sp.saved && <Alert kind="success">Attendance record saved.</Alert>}
      {sp.error && <Alert kind="error">{sp.error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>{editing ? `Edit record — ${byId.get(editing.user_id) || ""} (${formatDate(editing.work_date)})` : "Create attendance record"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createOrUpdateAttendanceAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <input type="hidden" name="id" value={editing?.id || ""} />
            <div>
              <Label htmlFor="user_id">Employee</Label>
              <Select id="user_id" name={editing ? undefined : "user_id"} defaultValue={editing?.user_id || ""} required disabled={!!editing}>
                <option value="" disabled>
                  Select employee
                </option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name}
                  </option>
                ))}
              </Select>
              {/* Disabled selects/inputs don't submit -- carry the fixed value via a hidden field instead. */}
              {editing && <input type="hidden" name="user_id" value={editing.user_id} />}
            </div>
            <div>
              <Label htmlFor="work_date">Date</Label>
              <Input
                id="work_date"
                name={editing ? undefined : "work_date"}
                type="date"
                defaultValue={editing?.work_date}
                required
                disabled={!!editing}
              />
              {editing && <input type="hidden" name="work_date" value={editing.work_date} />}
            </div>
            <div>
              <Label htmlFor="scheduled_time_in">Scheduled time in</Label>
              <Input
                id="scheduled_time_in"
                name="scheduled_time_in"
                type="time"
                defaultValue={editing?.scheduled_time_in || db.work_schedule.work_start}
                required
              />
            </div>
            <div>
              <Label htmlFor="scheduled_time_out">Scheduled time out</Label>
              <Input
                id="scheduled_time_out"
                name="scheduled_time_out"
                type="time"
                defaultValue={editing?.scheduled_time_out || db.work_schedule.work_end}
                required
              />
            </div>
            <div>
              <Label htmlFor="time_in">Actual time in</Label>
              <Input id="time_in" name="time_in" type="time" defaultValue={editing?.time_in ? editing.time_in.slice(11, 16) : ""} />
            </div>
            <div>
              <Label htmlFor="time_out">Actual time out</Label>
              <Input id="time_out" name="time_out" type="time" defaultValue={editing?.time_out ? editing.time_out.slice(11, 16) : ""} />
            </div>
            <div>
              <Label htmlFor="break_start">Break start</Label>
              <Input id="break_start" name="break_start" type="time" defaultValue={editing?.break_start ? editing.break_start.slice(11, 16) : ""} />
            </div>
            <div>
              <Label htmlFor="break_end">Break end</Label>
              <Input id="break_end" name="break_end" type="time" defaultValue={editing?.break_end ? editing.break_end.slice(11, 16) : ""} />
            </div>
            <div>
              <Label htmlFor="status">Status</Label>
              <Select id="status" name="status" defaultValue={editing?.status || "on_time"} required>
                {ATTENDANCE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s as AttendanceStatus]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="attachment">Supporting document (optional, PDF/JPG/PNG, max 5 MB)</Label>
              <Input id="attachment" name="attachment" type="file" accept=".pdf,.jpg,.jpeg,.png" />
              {editing?.attachment_path && (
                <a
                  href={`/api/attendance/${editing.id}/attachment`}
                  className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--brand-primary)] hover:underline"
                >
                  <Paperclip className="h-3 w-3" /> View current attachment
                </a>
              )}
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="remarks">Remarks</Label>
              <Textarea id="remarks" name="remarks" rows={2} defaultValue={editing?.remarks || ""} placeholder="Reason for this record / correction" />
            </div>
            <div className="sm:col-span-2 flex items-center justify-between">
              {editing && (
                <p className="text-xs text-slate-400">
                  Created by {editing.created_by ? byId.get(editing.created_by) || "self" : "self"} · Last updated by{" "}
                  {editing.updated_by ? byId.get(editing.updated_by) || "—" : "—"} ·{" "}
                  <Link href={`/audit-logs?entity_id=${editing.id}`} className="text-[var(--brand-primary)] hover:underline">
                    View history
                  </Link>
                </p>
              )}
              <Button type="submit" className="ml-auto">
                {editing ? "Save Changes" : "Create Record"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent records</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Employee</th>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Time In</th>
                <th className="px-4 py-2">Time Out</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Created By</th>
                <th className="px-4 py-2">Updated By</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {records.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2">{byId.get(r.user_id) || "—"}</td>
                  <td className="px-4 py-2">{formatDate(r.work_date)}</td>
                  <td className="px-4 py-2">{formatTime(r.time_in)}</td>
                  <td className="px-4 py-2">{formatTime(r.time_out)}</td>
                  <td className="px-4 py-2">
                    <AttendanceStatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-2 text-slate-500">{r.created_by ? byId.get(r.created_by) || "—" : "self"}</td>
                  <td className="px-4 py-2 text-slate-500">{r.updated_by ? byId.get(r.updated_by) || "—" : "—"}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-3">
                      <Link href={`/attendance/manage?edit=${r.id}`} className="text-xs font-medium text-[var(--brand-primary)] hover:underline">
                        Edit
                      </Link>
                      <Link href={`/audit-logs?entity_id=${r.id}`} className="text-xs font-medium text-slate-500 hover:underline">
                        History
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
              {records.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                    No attendance records found for your scope.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
