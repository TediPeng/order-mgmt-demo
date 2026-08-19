/**
 * The five duty statuses, shared by the roster grid and the spreadsheet import.
 *
 * The schedule row has one rest-day flag, not five states, so the status is
 * carried the way the importer has always carried it: ON DUTY and OFF are what
 * the row already says by itself, and the other three ride in `remarks`. This
 * module is the one place that mapping is written, in both directions —
 * lib/actions/schedule-import.ts encodes it, the grid reads it back, and a
 * status set in a spreadsheet and one set in the grid have to be the same row.
 *
 * Client-safe on purpose: lib/schedule-import.ts pulls in the spreadsheet
 * reader, which has no business in a browser bundle.
 */

export const DUTY_STATUSES = ["ON DUTY", "HALF DAY", "ON LEAVE", "OFF", "TRAINING"] as const;
export type DutyStatus = (typeof DUTY_STATUSES)[number];

/** What a cell can show. SUSPENDED is never chosen — the disciplinary module
 * sets it and the grid only reports it. NONE is "nothing said about this day". */
export type CellStatus = DutyStatus | "SUSPENDED" | "NONE";

/** Title case, as the remark is stored: "ON LEAVE" → "On Leave". */
export function titleCaseStatus(status: string): string {
  return status
    .toLowerCase()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Statuses the row states by itself, so they carry no remark. */
const PLAIN: DutyStatus[] = ["ON DUTY", "OFF"];

/** The remark that encodes a status, or null for the two that need none. */
export function remarkForStatus(status: DutyStatus): string | null {
  return PLAIN.includes(status) ? null : titleCaseStatus(status);
}

/**
 * Reads the status back off a stored schedule.
 *
 * The remark decides when it names one of the three that need it; otherwise the
 * rest-day flag does. A remark somebody typed by hand ("swapped with Jade")
 * falls through to ON DUTY or OFF, which is what the row means without it.
 */
export function statusOf(row: {
  is_rest_day?: boolean | null;
  remarks?: string | null;
  status?: string | null;
  suspension_id?: string | null;
}): CellStatus {
  if (row.suspension_id || row.status === "suspension") return "SUSPENDED";
  const remark = (row.remarks || "").trim().toLowerCase();
  if (remark === "half day") return "HALF DAY";
  if (remark === "on leave") return "ON LEAVE";
  if (remark === "training") return "TRAINING";
  return row.is_rest_day || row.status === "rest_day" ? "OFF" : "ON DUTY";
}

/** Cell colours, matching the spreadsheet template's own fills so a roster
 * looks the same whichever way it was set. */
export const STATUS_STYLE: Record<CellStatus, string> = {
  "ON DUTY": "bg-green-700 text-white",
  "HALF DAY": "bg-amber-500 text-slate-900",
  "ON LEAVE": "bg-blue-500 text-white",
  OFF: "bg-red-600 text-white",
  TRAINING: "bg-violet-600 text-white",
  // Near-black rather than the orange it used to carry, for two reasons. Orange
  // sat next to HALF DAY's amber and the two were hard to tell apart in a row of
  // fifteen cells. And SUSPENDED is not a duty status somebody picked — it is
  // imposed by the disciplinary module and cannot be changed from the grid — so
  // it should not look like one more colour in the same family.
  SUSPENDED: "bg-slate-800 text-white",
  NONE: "bg-white text-slate-300",
};

/** Hover shades, for the cells that can be clicked. */
export const STATUS_HOVER: Record<CellStatus, string> = {
  "ON DUTY": "hover:bg-green-800",
  "HALF DAY": "hover:bg-amber-600",
  "ON LEAVE": "hover:bg-blue-600",
  OFF: "hover:bg-red-700",
  TRAINING: "hover:bg-violet-700",
  SUSPENDED: "",
  NONE: "hover:bg-slate-50",
};

export const STATUS_LABEL: Record<CellStatus, string> = {
  "ON DUTY": "ON DUTY",
  "HALF DAY": "HALF DAY",
  "ON LEAVE": "ON LEAVE",
  OFF: "OFF",
  TRAINING: "TRAINING",
  SUSPENDED: "SUSPENDED",
  NONE: "—",
};

/** Whether the status means the agent is not working that day. */
export function isRestStatus(status: DutyStatus): boolean {
  return status === "OFF" || status === "ON LEAVE";
}
