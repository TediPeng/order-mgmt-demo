import { redirect } from "next/navigation";
import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeAgentsForSchedule, scopeSuspensions, effectiveSuspensionStatus } from "@/lib/schedule-access";
import { formatDate, todayInTz } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { IssueSuspensionForm } from "@/components/IssueSuspensionForm";
import { LiftSuspensionButton } from "@/components/LiftSuspensionButton";
import { issueSuspensionAction, liftSuspensionAction } from "@/lib/actions/suspensions";
import type { SuspensionStatus } from "@/lib/types";

const STATUS_BADGE: Record<SuspensionStatus, string> = {
  active: "bg-orange-100 text-orange-700",
  completed: "bg-slate-200 text-slate-600",
  lifted: "bg-blue-100 text-blue-700",
};

export default async function SuspensionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; issued?: string; replaced?: string; lifted?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = readDb();

  if (!can(user.role, "disciplinary", "view", db.role_permissions)) redirect("/dashboard");
  const canManage = can(user.role, "disciplinary", "manage", db.role_permissions);
  const isAgentView = user.role === "agent";

  const today = todayInTz();
  const employees = scopeAgentsForSchedule(db, user);
  const byId = new Map(db.profiles.map((p) => [p.id, p]));

  const suspensions = scopeSuspensions(user, db.suspensions, db).sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">{isAgentView ? "My Disciplinary History" : "Disciplinary Actions"}</h1>

      {sp.error && <Alert kind="error">{sp.error}</Alert>}
      {sp.issued && (
        <Alert kind="success">
          Suspension issued.{sp.replaced ? ` ${sp.replaced} existing schedule(s) were replaced.` : ""}
        </Alert>
      )}
      {sp.lifted && <Alert kind="success">Suspension lifted.</Alert>}

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
