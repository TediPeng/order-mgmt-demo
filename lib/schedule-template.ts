import ExcelJS from "exceljs";
import {
  dateHeaderLabel,
  DUTY_STATUS_COLORS,
  DUTY_STATUSES,
  SCHEDULE_IMPORT_AGENT_HEADER,
  SCHEDULE_IMPORT_NAME_HEADER,
  shiftForStatus,
} from "@/lib/schedule-import";
import type { WorkDayTimes } from "@/lib/schedule-import";

/**
 * Builds the roster workbook.
 *
 * Kept out of the route so the file's shape can be exercised without an HTTP
 * request or a database: everything here is a pure function of the agents, the
 * dates and the work day.
 *
 * The format mirrors the roster the client already keeps by hand — every date
 * cell is a dropdown of the five duty statuses, pre-set to ON DUTY, colouring
 * itself as soon as a status is chosen (green on duty, red off). Nobody types
 * into the grid; they pick.
 *
 * ExcelJS rather than SheetJS for exactly this: the community build of SheetJS
 * writes neither data validation nor cell styling, which between them are the
 * whole format.
 */

const HEADER_FILL = "FF1F2937";

export interface TemplateAgent {
  username: string;
  full_name: string;
}

export function buildScheduleWorkbook(input: {
  agents: TemplateAgent[];
  dates: string[];
  times: WorkDayTimes;
  generatedFor: string;
  /** The period the dates cover, named the way the roster names it
   * ("Aug 13 – 27, 2026"). Written into the guide sheet so a file that has been
   * sitting in somebody's Downloads for a fortnight still says which one it is. */
  periodLabel: string;
}): ExcelJS.Workbook {
  const { agents, dates, times } = input;

  const wb = new ExcelJS.Workbook();
  wb.creator = "4S ROMA";
  // Frozen panes so the names stay put while scrolling across the period.
  const ws = wb.addWorksheet("Schedule", { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });

  ws.columns = [
    { header: SCHEDULE_IMPORT_AGENT_HEADER, key: "agent", width: 18 },
    { header: SCHEDULE_IMPORT_NAME_HEADER, key: "name", width: 24 },
    ...dates.map((d) => ({ header: dateHeaderLabel(d), key: d, width: 14 })),
  ];

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.alignment = { horizontal: "center", vertical: "middle" };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  headerRow.height = 22;

  for (const agent of agents) {
    // Pre-set to ON DUTY: a roster is mostly working days, so only the
    // exceptions have to be changed — which is how it is filled in today.
    ws.addRow([agent.username, agent.full_name, ...dates.map(() => "ON DUTY")]);
  }

  const firstDataRow = 2;
  const lastDataRow = Math.max(firstDataRow, agents.length + 1);
  const firstDateCol = 3;
  const lastDateCol = 2 + dates.length;

  for (let r = firstDataRow; r <= lastDataRow; r++) {
    const row = ws.getRow(r);
    row.height = 18;
    row.getCell(1).font = { bold: true };
    for (let c = firstDateCol; c <= lastDateCol; c++) {
      const cell = row.getCell(c);
      cell.alignment = { horizontal: "center", vertical: "middle" };
      // allowBlank, because a blank cell is a real answer here: it means
      // "nothing said about this day".
      cell.dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`"${DUTY_STATUSES.join(",")}"`],
        showErrorMessage: true,
        errorStyle: "warning",
        errorTitle: "Not a duty status",
        error: `Pick one of: ${DUTY_STATUSES.join(", ")}. Times like 08:00-17:00 are also accepted.`,
      };
    }
  }

  // Colour follows the value rather than being painted on once, so a cell
  // changed after download still looks right — and a blank cell stays plain.
  if (agents.length > 0 && dates.length > 0) {
    const ref = `C${firstDataRow}:${ws.getColumn(lastDateCol).letter}${lastDataRow}`;
    ws.addConditionalFormatting({
      ref,
      rules: DUTY_STATUSES.map((status, i) => ({
        type: "cellIs" as const,
        operator: "equal" as const,
        priority: i + 1,
        formulae: [`"${status}"`],
        style: {
          fill: {
            type: "pattern" as const,
            pattern: "solid" as const,
            fgColor: { argb: DUTY_STATUS_COLORS[status].fill },
          },
          font: { color: { argb: DUTY_STATUS_COLORS[status].font }, bold: true },
        },
      })),
    });
  }

  const guide = wb.addWorksheet("How to fill in");
  guide.columns = [{ width: 16 }, { width: 22 }, { width: 68 }];
  guide.addRows([
    ["How to fill in this roster"],
    [],
    ["1.", "One row per agent.", "The Agent column is the account — do not edit or reorder it."],
    ["2.", "One column per date.", "Add or remove date columns freely; keep the YYYY-MM-DD at the start of the header."],
    ["3.", "Pick a status per cell.", "Every date cell is a dropdown. What each one means when imported:"],
    [],
    ["", "ON DUTY", `A full day, ${times.work_start}–${times.work_end} (the company work schedule)`],
    ["", "HALF DAY", `${times.work_start}–${shiftForStatus("HALF DAY", times).duty_end}`],
    ["", "ON LEAVE", "No duty. Recorded as a rest day with the remark 'On Leave'"],
    ["", "OFF", "No duty — a plain rest day"],
    ["", "TRAINING", `A full day, ${times.work_start}–${times.work_end}, with the remark 'Training'`],
    ["", "(blank)", "Nothing said about that day — any existing schedule is left alone"],
    [],
    ["", "08:00-17:00", "A specific shift, if it does not follow the company hours. Overnight is fine: 22:00-06:00"],
    [],
    ["Notes"],
    ["", "", "A date already covered by an active suspension is skipped and reported; suspensions win."],
    ["", "", "An agent who already has a schedule on a date in this file will have it replaced by what the file says."],
    [],
    // Appended after the "Notes" heading on purpose — the bold styling below
    // addresses rows by number, and every index it names is at or above this.
    ["Period:", input.periodLabel],
    ["Agents listed:", String(agents.length)],
    ["Generated for:", input.generatedFor],
  ]);
  guide.getRow(1).font = { bold: true, size: 14 };
  guide.getRow(16).font = { bold: true };
  for (const r of [7, 8, 9, 10, 11, 12, 14]) guide.getRow(r).getCell(2).font = { bold: true };

  return wb;
}
