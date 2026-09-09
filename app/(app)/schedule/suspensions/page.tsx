import { redirect } from "next/navigation";
import { readDbLite } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { scopeAgentsForSchedule, scopeSuspensions, effectiveSuspensionStatus } from "@/lib/schedule-access";
import { formatDate, todayInTz } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { IssueSuspensionForm } from "@/components/IssueSuspensionForm";
import { LiftSuspensionButton } from "@/components/LiftSuspensionButton";
import { issueSuspensionAction, liftSuspensionAction } from "@/lib/actions/suspensions";
import {
  recordDisciplinaryAction,
  acknowledgeDisciplinaryAction,
  withdrawDisciplinaryAction,
} from "@/lib/actions/disciplinary";
import { listDisciplinaryActions } from "@/lib/disciplinary";
import { DISCIPLINARY_TYPE_LABELS, DISCIPLINARY_STATUS_BADGE } from "@/lib/disciplinary-types";
import { RecordDisciplinaryForm } from "@/components/RecordDisciplinaryForm";
import { WithdrawDisciplinaryButton } from "@/components/WithdrawDisciplinaryButton";
import { Button } from "@/components/ui/Button";
import type { SuspensionStatus } from "@/lib/types";

const STATUS_BADGE: Record<SuspensionStatus, string> = {
  active: "bg-orange-100 text-orange-700",
  completed: "bg-slate-200 text-slate-600",
  lifted: "bg-blue-100 text-blue-700",
};

export default async function SuspensionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; issued?: string; replaced?: string; lifted?: string; recorded?: string; acknowledged?: string; withdrawn?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDbLite();

  if (!can(user.role, "disciplinary", "view", db.role_permissions)) redirect("/dashboard");
  const canManage = can(user.role, "disciplinary", "manage", db.role_permissions);
  const isAgentView = user.role === "agent";

  const today = todayInTz();
  // Who can actually be suspended: the floor, and only the floor.
  //
  // scopeAgentsForSchedule answers "whose schedule may this person see", which
  // is a wider question -- it includes Administrators and Management, because
  // they appear on rosters. Nobody suspends an Administrator from this form,
  // and the test account is not a person at all, so both are dropped here
  // rather than in the shared helper the Schedule module also relies on.
  const employees = scopeAgentsForSchedule(db, user).filter((p) => !isFullAccess(p.role) && !p.is_test_account);
  const byId = new Map(db.profiles.map((p) => [p.id, p]));

  const suspensions = scopeSuspensions(user, db.suspensions, db).sort((a, b) => b.created_at.localeCompare(a.created_at));

  // Whose records this person may read. Wider than the list they may write up:
  // somebody who has left still has a file, and scopeAgentsForSchedule drops
  // inactive profiles -- which would quietly erase the history of everybody no
  // longer on the floor, exactly when it is most likely to be asked for.
  const visibleIds = isFullAccess(user.role)
    ? db.profiles.map((p) => p.id)
    : scopeAgentsForSchedule(db, user).map((p) => p.id);
  const actions = await listDisciplinaryActions(visibleIds);

  return (
    <div className="space-y-6">
      <h1 className="text-page-title text-slate-900">{isAgentView ? "My Disciplinary History" : "Disciplinary Actions"}</h1>

      {sp.error && <Alert kind="error">{sp.error}</Alert>}
      {sp.issued && (
        <Alert kind="success">
          Suspension issued.{sp.replaced ? ` ${sp.replaced} existing schedule(s) were replaced.` : ""}
        </Alert>
      )}
      {sp.lifted && <Alert kind="success">Suspension lifted.</Alert>}
      {sp.recorded && <Alert kind="success">Disciplinary action recorded. The employee has been notified.</Alert>}
      {sp.acknowledged && <Alert kind="success">Acknowledged. Thank you.</Alert>}
      {sp.withdrawn && <Alert kind="success">Disciplinary action withdrawn.</Alert>}

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Record Disciplinary Action</CardTitle>
          </CardHeader>
          <CardContent>
            <RecordDisciplinaryForm action={recordDisciplinaryAction} employees={employees} today={today} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{isAgentView ? "My Disciplinary Records" : "Disciplinary Records"}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  {!isAgentView && <th className="px-4 py-3">Employee</th>}
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Offense</th>
                  <th className="px-4 py-3">Issued By</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {actions.map((a) => {
                  const boundAcknowledge = async (formData: FormData) => {
                    "use server";
                    await acknowledgeDisciplinaryAction(formData);
                  };
                  const boundWithdraw = async (formData: FormData) => {
                    "use server";
                    await withdrawDisciplinaryAction(formData);
                  };
                  const mine = a.employee_id === user.id;
                  return (
                    <tr key={a.id}>
                      {!isAgentView && (
                        <td className="px-4 py-3 font-medium text-slate-800">
                          {byId.get(a.employee_id)?.full_name || "\u2014"}
                        </td>
                      )}
                      <td className="px-4 py-3">{formatDate(a.action_date)}</td>
                      <td className="px-4 py-3">{DISCIPLINARY_TYPE_LABELS[a.action_type]}</td>
                      <td className="max-w-[260px] px-4 py-3 text-slate-600">
                        <span className="block truncate" title={a.offense}>
                          {a.offense}
                        </span>
                        {a.details && (
                          <span className="mt-0.5 block truncate text-xs text-slate-400" title={a.details}>
                            {a.details}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{byId.get(a.issued_by)?.full_name || "\u2014"}</td>
                      <td className="px-4 py-3">
                        <Badge className={DISCIPLINARY_STATUS_BADGE[a.status]}>
                          {a.status[0].toUpperCase() + a.status.slice(1)}
                        </Badge>
                        {a.status === "withdrawn" && a.withdrawn_reason && (
                          <p className="mt-1 text-xs text-slate-400" title={a.withdrawn_reason}>
                            Withdrawn: {a.withdrawn_reason}
                          </p>
                        )}
                        {a.suspension_id && <p className="mt-1 text-xs text-slate-400">Suspension \u2014 see below</p>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {/* Their own hand only. That is the whole value of the
                              field: a supervisor ticking it would be recording
                              that a conversation happened, which is the fact in
                              dispute. */}
                          {mine && a.status === "active" && (
                            <form action={boundAcknowledge}>
                              <input type="hidden" name="id" value={a.id} />
                              <Button type="submit" variant="outline" size="sm">
                                Acknowledge
                              </Button>
                            </form>
                          )}
                          {canManage && a.status !== "withdrawn" && (
                            <WithdrawDisciplinaryButton action={boundWithdraw} id={a.id} />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {actions.length === 0 && (
                  <tr>
                    <td colSpan={isAgentView ? 6 : 7} className="px-4 py-10 text-center text-slate-400">
                      No disciplinary records.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Issue Suspension</CardTitle>
          </CardHeader>
          <CardContent>
            <IssueSuspensionForm action={issueSuspensionAction} employees={employees} today={today} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{isAgentView ? "My Suspensions" : "Suspension Records"}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  {!isAgentView && <th className="px-4 py-3">Employee</th>}
                  <th className="px-4 py-3">Start</th>
                  <th className="px-4 py-3">End</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Issued By</th>
                  <th className="px-4 py-3">Date Issued</th>
                  <th className="px-4 py-3">Status</th>
                  {canManage && <th className="px-4 py-3"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {suspensions.map((s) => {
                  const status = effectiveSuspensionStatus(s, today);
                  const boundLift = async (formData: FormData) => {
                    "use server";
                    await liftSuspensionAction(formData);
                  };
                  return (
                    <tr key={s.id} title={s.reason}>
                      {!isAgentView && (
                        <td className="px-4 py-3 font-medium text-slate-800">{byId.get(s.employee_id)?.full_name || "—"}</td>
                      )}
                      <td className="px-4 py-3">{formatDate(s.start_date)}</td>
                      <td className="px-4 py-3">{formatDate(s.end_date)}</td>
                      <td className="px-4 py-3">{s.duration_days} days</td>
                      <td className="max-w-[220px] truncate px-4 py-3 text-slate-600" title={s.reason}>
                        {s.reason}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{byId.get(s.issued_by)?.full_name || "—"}</td>
                      <td className="px-4 py-3 text-slate-500">{formatDate(s.date_issued)}</td>
                      <td className="px-4 py-3">
                        <Badge className={STATUS_BADGE[status]}>{status[0].toUpperCase() + status.slice(1)}</Badge>
                        {s.status === "lifted" && s.lifted_reason && (
                          <p className="mt-1 text-xs text-slate-400" title={s.lifted_reason}>
                            Lifted: {s.lifted_reason}
                          </p>
                        )}
                      </td>
                      {canManage && (
                        <td className="px-4 py-3">
                          {status === "active" && <LiftSuspensionButton action={boundLift} id={s.id} />}
                        </td>
                      )}
                    </tr>
                  );
                })}
                {suspensions.length === 0 && (
                  <tr>
                    <td colSpan={canManage ? 9 : 8} className="px-4 py-10 text-center text-slate-400">
                      No suspension records.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
