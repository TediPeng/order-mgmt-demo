import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDb, writeDb } from "@/lib/db";
import { can } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { buildBrandedCsv } from "@/lib/csv";
import { formatDate } from "@/lib/utils";
import { scopeSchedules, dayOfWeekLabel } from "@/lib/schedule-access";

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  rest_day: "Rest Day",
  suspension: "Suspension",
  unassigned: "Unassigned",
};

/** Section 8: Excel/CSV export of the current filtered monthly view, gated by
 * schedules.export and audit-logged like the other export routes. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await readDb();
  if (!can(user.role, "schedules", "export", db.role_permissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const start = (searchParams.get("start") || "").slice(0, 10);
  const end = (searchParams.get("end") || "").slice(0, 10);
  const agentFilter = searchParams.get("agent") || "";
  const statusFilter = searchParams.get("status") || "";

  let schedules = scopeSchedules(user, db.schedules, db);
  if (start) schedules = schedules.filter((s) => s.schedule_date >= start);
  if (end) schedules = schedules.filter((s) => s.schedule_date <= end);
  if (agentFilter) schedules = schedules.filter((s) => s.agent_id === agentFilter);
  if (statusFilter) schedules = schedules.filter((s) => s.status === statusFilter);
  schedules.sort((a, b) => a.schedule_date.localeCompare(b.schedule_date));

  const byId = new Map(db.profiles.map((p) => [p.id, p.full_name]));
  const header = ["Agent", "Date", "Day of Week", "Duty Start", "Duty End", "Rest Day", "Status", "Remarks"];
  const rows = schedules.map((s) => [
    byId.get(s.agent_id) || "Unknown",
    formatDate(s.schedule_date),
    dayOfWeekLabel(s.schedule_date),
    s.duty_start || "",
    s.duty_end || "",
    s.is_rest_day ? "Yes" : "No",
    STATUS_LABELS[s.status] || s.status,
    s.remarks || "",
  ]);
  const csv = buildBrandedCsv("Monthly Schedule", header, rows);

  const info = await getRequestInfo();
  logActivity(db, user.id, "SCHEDULE_EXPORTED", "schedule", null, { count: schedules.length }, { module: "schedules", ...info });
  await writeDb(db);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="schedule-export-${Date.now()}.csv"`,
    },
  });
}
