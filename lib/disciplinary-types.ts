/**
 * Disciplinary records — the whole ladder, not just the last rung.
 *
 * ROMA has had a `disciplinary` permission and a Disciplinary menu entry for a
 * long time, and behind both sat one thing: suspensions. So the only conduct
 * this company could prove was the kind severe enough to stop somebody working.
 * A verbal warning given in March was a memory by June, and a final warning
 * that nobody could produce is a final warning that never happened.
 *
 * The names and shapes only. Split from the query in lib/disciplinary.ts
 * because the form that offers these types is a client component, and the
 * query imports the service role -- one file for both would either pull a
 * database key towards the browser or make the labels unreachable from it.
 */

export const DISCIPLINARY_TYPES = [
  "verbal_warning",
  "written_warning",
  "final_warning",
  "suspension",
  "termination",
] as const;

export type DisciplinaryType = (typeof DISCIPLINARY_TYPES)[number];

/** In escalation order, which is the order the form offers them. */
export const DISCIPLINARY_TYPE_LABELS: Record<DisciplinaryType, string> = {
  verbal_warning: "Verbal Warning",
  written_warning: "Written Warning",
  final_warning: "Final Warning",
  suspension: "Suspension",
  termination: "Termination",
};

export type DisciplinaryStatus = "active" | "acknowledged" | "withdrawn";

export const DISCIPLINARY_STATUS_BADGE: Record<DisciplinaryStatus, string> = {
  active: "bg-orange-100 text-orange-700",
  acknowledged: "bg-green-100 text-green-700",
  withdrawn: "bg-slate-200 text-slate-600",
};

export interface DisciplinaryAction {
  id: string;
  employee_id: string;
  action_date: string;
  action_type: DisciplinaryType;
  offense: string;
  details: string | null;
  issued_by: string;
  status: DisciplinaryStatus;
  acknowledged_at: string | null;
  withdrawn_reason: string | null;
  withdrawn_by: string | null;
  withdrawn_at: string | null;
  /** Set when this record IS a suspension, so the days and the record point at each other. */
  suspension_id: string | null;
  created_at: string;
}
