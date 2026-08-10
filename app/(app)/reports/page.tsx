import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { readDbLite } from "@/lib/db";
import { auditByAction } from "@/lib/audit-log";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export default async function ReportsPage() {
  const user = (await getCurrentUser())!;
  const db = await readDbLite();

  if (!can(user.role, "reports", "view", db.role_permissions)) redirect("/dashboard");

  const reports = [
    {
      title: "Agent Performance",
      description: "Calls, orders, sales, conversion rate and AOV per agent for the selected date range.",
      href: "/api/performance/export?range=this_month",
      module: "performance" as const,
    },
    {
      title: "Attendance",
      description: "Time in/out and total hours for all attendance records currently in scope.",
      href: "/api/attendance/export",
      module: "attendance" as const,
    },
    {
      title: "Agent Activity",
      description:
        "Shift, talk, standby and break hours per agent for this month, with utilisation. Pick another range on the Activity Report.",
      href: "/api/attendance/activity-export?range=this_month",
      module: "attendance" as const,
    },
    {
      title: "Audit Log",
      description: "Full accountability trail: who did what, when, from where.",
      href: "/api/audit-logs/export",
      module: "audit_logs" as const,
    },
  ];

  const byId = new Map(db.profiles.map((p) => [p.id, p.full_name]));
  const recentExports = await auditByAction("REPORT_EXPORTED", 8);

  return (
    <div className="space-y-6">
      <h1 className="text-page-title text-slate-900">Reports</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {reports
          .filter((r) => can(user.role, r.module, "export", db.role_permissions))
          .map((r) => (
            <Card key={r.title}>
              <CardHeader>
                <CardTitle>{r.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-4 text-xs text-slate-500">{r.description}</p>
                <a href={r.href}>
                  <Button variant="outline" size="sm">
                    <Download className="h-4 w-4" /> Export CSV
                  </Button>
                </a>
              </CardContent>
            </Card>
          ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Exports</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-slate-100">
            {recentExports.map((e) => (
              <li key={e.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <span>
                  <span className="font-medium text-slate-700">{e.user_id ? byId.get(e.user_id) || "Unknown" : "System"}</span>{" "}
                  exported {e.entity_type || "a report"}
                </span>
                <span className="text-xs text-slate-400">{formatDateTime(e.created_at)}</span>
              </li>
            ))}
            {recentExports.length === 0 && (
              <li className="px-5 py-6 text-center text-sm text-slate-400">No exports yet.</li>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
