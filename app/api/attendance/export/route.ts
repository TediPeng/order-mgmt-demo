import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDb, writeDb } from "@/lib/db";
import { can } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { formatDate, formatTime } from "@/lib/utils";
import { buildBrandedCsv } from "@/lib/csv";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await readDb();
  if (!can(user.role, "attendance", "export", db.role_permissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const userFilter = searchParams.get("user") || "";
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";

  const visibleUserIds =
    user.role === "team_lead"
      ? new Set([user.id, ...db.profiles.filter((p) => p.team_lead_id === user.id).map((p) => p.id)])
      : null;

  let records = visibleUserIds ? db.attendance.filter((a) => visibleUserIds.has(a.user_id)) : [...db.attendance];
  if (userFilter) records = records.filter((a) => a.user_id === userFilter);
  if (from) records = records.filter((a) => a.work_date >= from);
  if (to) records = records.filter((a) => a.work_date <= to);
  records.sort((a, b) => b.work_date.localeCompare(a.work_date));

  const byId = new Map(db.profiles.map((p) => [p.id, p.full_name]));

  const header = [
    "Employee",
    "Date",
    "Scheduled In",
    "Time In",
    "Time Out",
    "Minutes Late",
    "Break Start",
    "Break End",
    "Break Minutes",
    "Over Break Minutes",
    "Total Hours",
    "Status",
  ];
  const rows = records.map((r) => [
    byId.get(r.user_id) || "",
    formatDate(r.work_date),
    r.scheduled_time_in,
    formatTime(r.time_in),
    formatTime(r.time_out),
    r.minutes_late,
    formatTime(r.break_start),
    formatTime(r.break_end),
    r.break_minutes ?? "",
    r.over_break_minutes,
    r.total_hours ?? "",
    r.status,
  ]);
  const csv = buildBrandedCsv("Attendance Export", header, rows);

  logActivity(db, user.id, "REPORT_EXPORTED", "attendance", null, { user_filter: userFilter, from, to, count: records.length }, {
    module: "attendance",
  });
  await writeDb(db);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="attendance-export-${Date.now()}.csv"`,
    },
  });
}
