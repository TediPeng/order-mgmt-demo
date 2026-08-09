import * as XLSX from "xlsx";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDb } from "@/lib/db";
import { can } from "@/lib/permissions";
import { scopeAgentsForSchedule, eachDateInclusive, addDaysToYmd } from "@/lib/schedule-access";
import { displayUserName } from "@/lib/types";
import { todayInTz } from "@/lib/utils";
import {
  dateHeaderLabel,
  SCHEDULE_IMPORT_AGENT_HEADER,
  SCHEDULE_IMPORT_NAME_HEADER,
} from "@/lib/schedule-import";

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
 * range the template can produce is one it can also take back.
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

  const db = await readDb();
  if (!can(user.role, "schedules", "create", db.role_permissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const startParam = req.nextUrl.searchParams.get("start") || "";
  const start = /^\d{4}-\d{2}-\d{2}$/.test(startParam) ? startParam : nextMonday(todayInTz());
  const days = Math.min(31, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 7));
  const dates = eachDateInclusive(start, addDaysToYmd(start, days - 1));

  const agents = scopeAgentsForSchedule(db, user)
    .filter((p) => p.role === "agent" && p.is_active && !p.is_deleted)
    .sort((a, b) => displayUserName(a).localeCompare(displayUserName(b)));

  const header = [SCHEDULE_IMPORT_AGENT_HEADER, SCHEDULE_IMPORT_NAME_HEADER, ...dates.map(dateHeaderLabel)];
  const rows = agents.map((a) => [a.username, displayUserName(a), ...dates.map(() => "")]);

  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws["!cols"] = [{ wch: 18 }, { wch: 24 }, ...dates.map(() => ({ wch: 16 }))];

  const guide = XLSX.utils.aoa_to_sheet([
    ["How to fill in this roster"],
    [],
    ["1.", "One row per agent. The Agent column is the account and must not be edited or reordered."],
    ["2.", "One column per date. Add or remove date columns freely — keep the YYYY-MM-DD at the start of the header."],
    ["3.", "In each cell put one of:"],
    ["", "08:00-17:00", "a duty shift, 24-hour times"],
    ["", "REST", "a rest day (REST, RD, OFF and DAY OFF all work)"],
    ["", "(blank)", "nothing said about that day — any existing schedule is left alone"],
    [],
    ["Overnight shifts are fine: 22:00-06:00 ends the next morning."],
    ["A date already covered by an active suspension is skipped and reported; suspensions win."],
    ["An agent who already has a schedule on a date in this file will have it replaced by what the file says."],
    [],
    ["Agents listed:", String(agents.length)],
    ["Generated for:", displayUserName(user)],
  ]);
  guide["!cols"] = [{ wch: 4 }, { wch: 18 }, { wch: 70 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Schedule");
  XLSX.utils.book_append_sheet(wb, guide, "How to fill in");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="schedule-template-${start}.xlsx"`,
    },
  });
}
