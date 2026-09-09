import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { DisciplinaryAction } from "@/lib/disciplinary-types";

/**
 * Reading disciplinary records.
 *
 * Through the service role like the rest of the server, and NOT through readDb:
 * that reads thirteen tables in full on every request, and a table only one
 * screen asks about has no business being in it.
 *
 * The names, labels and shapes live in lib/disciplinary-types.ts, which the
 * form can import without dragging a database key into the browser.
 */

const COLUMNS =
  "id, employee_id, action_date, action_type, offense, details, issued_by, status, " +
  "acknowledged_at, withdrawn_reason, withdrawn_by, withdrawn_at, suspension_id, created_at";

/**
 * A ceiling, not a page size. Nineteen people cannot legitimately produce this
 * many records; if they ever do, the screen needs a date filter rather than a
 * bigger number, and truncating silently is how a history stops being one.
 */
const MAX_ROWS = 500;

/**
 * Every record for the people this user may see.
 *
 * Scoped by the caller, deliberately. Who may see whose record is the same
 * question the Schedule module already answers, and answering it twice is how
 * two answers start to differ — an agent must see their own history and nobody
 * else's, and a Team Lead only their own team's.
 */
export async function listDisciplinaryActions(employeeIds: string[]): Promise<DisciplinaryAction[]> {
  if (employeeIds.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from("disciplinary_actions")
    .select(COLUMNS)
    .in("employee_id", employeeIds)
    .order("action_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);

  if (error) {
    // Thrown rather than swallowed. This is the screen's whole content, not a
    // column on somebody else's board: an empty history reads as "this person
    // has never been written up", which is a statement, and a false one.
    console.error("[disciplinary] read failed: %s", error.message);
    throw new Error("Could not load disciplinary records.");
  }

  return (data || []) as unknown as DisciplinaryAction[];
}
