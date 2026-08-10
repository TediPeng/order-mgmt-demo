import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDbLite } from "@/lib/db";
import { can } from "@/lib/permissions";
import { scopeAgentsForSchedule, eachDateInclusive, addDaysToYmd } from "@/lib/schedule-access";
import { displayUserName } from "@/lib/types";
import { todayInTz } from "@/lib/utils";
import { buildScheduleWorkbook } from "@/lib/schedule-template";

/**
 * The schedule roster template, generated per user rather than shipped as a
 * static file — the whole value is that it arrives with the agent accounts
 * already in it, scoped to whoever asked (a Team Lead gets their own team, an
 * Administrator gets everyone).
 *
 * Only AGENT accounts are listed. Administrators and Team Leads are not on the
 * duty roster, and putting them in the file would invite scheduling them by
 * accident.
 *
 * Defaults to the coming Monday-to-Sunday week; ?start=YYYY-MM-DD and ?days=N
 * override it. The importer reads the dates back out of the header, so any
 * range this can produce is one it can also take back. The workbook itself is
 * built in lib/schedule-template.ts.
 */

/** The Monday on or after `ymd`. Rosters are drawn up a week ahead, so the
 * default is the NEXT week rather than the current one. */
function nextMonday(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDaysToYmd(ymd, dow === 1 ? 7 : (8 - dow) % 7 || 7);
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await readDbLite();
  if (!can(user.role, "schedules", "create", db.role_permissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const startParam = req.nextUrl.searchParams.get("start") || "";
  const start = /^\d{4}-\d{2}-\d{2}$/.test(startParam) ? startParam : nextMonday(todayInTz());
  const days = Math.min(31, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 7));
  const dates = eachDateInclusive(start, addDaysToYmd(start, days - 1));

  const agents = scopeAgentsForSchedule(db, user)
    .filter((p) => p.role === "agent" && p.is_active && !p.is_deleted)
    .sort((a, b) => displayUserName(a).localeCompare(displayUserName(b)))
    .map((p) => ({ username: p.username, full_name: displayUserName(p) }));

  const wb = buildScheduleWorkbook({
    agents,
    dates,
    times: { work_start: db.work_schedule.work_start, work_end: db.work_schedule.work_end },
    generatedFor: displayUserName(user),
  });
  const buf = await wb.xlsx.writeBuffer();

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="schedule-template-${start}.xlsx"`,
    },
  });
}
