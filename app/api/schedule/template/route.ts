import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDbLite } from "@/lib/db";
import { can } from "@/lib/permissions";
import { scopeAgentsForSchedule, eachDateInclusive, addDaysToYmd } from "@/lib/schedule-access";
import { cutoffFor } from "@/lib/cutoff";
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
 * Covers a cut-off period — the 13th to the 27th, then the 28th to the 12th —
 * because that is the unit the floor rosters in and the one /schedule and the
 * roster builder both open on. It used to default to the coming Monday-to-Sunday
 * week, which meant the Excel half of Create Schedule described a different
 * fortnight from the grid directly above it, and a week downloaded on the 26th
 * straddled two periods.
 *
 * ?start=YYYY-MM-DD picks the cut-off that date falls in, matching how
 * /schedule?start= already reads. ?days=N is the escape hatch: it asks for a
 * literal N-day range from the anchor instead, which is what the importer's
 * contract rests on — it reads the dates back out of the header, so any range
 * this can produce is one it can also take back. The workbook itself is built
 * in lib/schedule-template.ts.
 */

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await readDbLite();
  if (!can(user.role, "schedules", "create", db.role_permissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const startParam = req.nextUrl.searchParams.get("start") || "";
  const daysParam = req.nextUrl.searchParams.get("days");
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(startParam) ? startParam : todayInTz();

  // Without ?days= the file is the whole cut-off the anchor falls in. With it,
  // the anchor is taken literally and N days run from there — an arbitrary
  // range is still downloadable for the roster that does not fit a period.
  const cutoff = cutoffFor(anchor);
  const days = daysParam ? Math.min(31, Math.max(1, Number(daysParam) || 7)) : 0;
  const start = days ? anchor : cutoff.start;
  const end = days ? addDaysToYmd(anchor, days - 1) : cutoff.end;
  const dates = eachDateInclusive(start, end);

  const agents = scopeAgentsForSchedule(db, user)
    .filter((p) => p.role === "agent" && p.is_active && !p.is_deleted)
    .sort((a, b) => displayUserName(a).localeCompare(displayUserName(b)))
    .map((p) => ({ username: p.username, full_name: displayUserName(p) }));

  const wb = buildScheduleWorkbook({
    agents,
    dates,
    times: { work_start: db.work_schedule.work_start, work_end: db.work_schedule.work_end },
    generatedFor: displayUserName(user),
    periodLabel: days ? `${start} – ${end}` : cutoff.label,
  });
  const buf = await wb.xlsx.writeBuffer();

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // Both ends in the name: a cut-off crosses a month boundary half the
      // time, so a start date alone does not say which fortnight this is.
      "Content-Disposition": `attachment; filename="schedule-template-${start}-to-${end}.xlsx"`,
    },
  });
}
