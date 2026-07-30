import { supabaseAdmin } from "./supabaseAdmin";
import type { DbShape } from "./types";

// Plain module, deliberately NOT "use server": these are read helpers called
// from server components. Exporting them from an action file would both break
// the build (actions must all be async) and publish countLinkedRecords as a
// callable endpoint taking a whole DbShape.

export interface LinkedRecordCounts {
  orders: number;
  call_logs: number;
  attendance: number;
  schedules: number;
  leave_requests: number;
  suspensions: number;
  audit_logs: number;
  pancake_transactions: number;
}

export const LINKED_RECORD_LABELS: Record<keyof LinkedRecordCounts, string> = {
  orders: "Orders / leads",
  call_logs: "Call log uploads",
  attendance: "Attendance records",
  schedules: "Schedule entries",
  leave_requests: "Leave requests",
  suspensions: "Disciplinary records",
  audit_logs: "Audit log entries",
  pancake_transactions: "Pancake transactions",
};

/**
 * Everything that would be orphaned by deleting this account. Run BEFORE the
 * confirmation flow so an Administrator sees the real cost, and again at commit
 * time so a record created in between is not missed.
 */
export async function countLinkedRecords(db: DbShape, userId: string): Promise<LinkedRecordCounts> {
  const orders = db.orders.filter(
    (o) => o.agent_id === userId || o.created_by === userId || o.updated_by === userId
  ).length;

  // Pancake sync rows live outside DbShape (targeted queries), so they are
  // counted directly.
  const { count: pancakeCount } = await supabaseAdmin
    .from("pancake_sync_logs")
    .select("id", { count: "exact", head: true })
    .eq("triggered_by", userId);

  return {
    orders,
    call_logs: db.call_logs.filter((c) => c.uploaded_by === userId).length,
    attendance: db.attendance.filter((a) => a.user_id === userId).length,
    schedules: db.schedules.filter((s) => s.agent_id === userId).length,
    leave_requests: db.leave_requests.filter((l) => l.agent_id === userId).length,
    suspensions: db.suspensions.filter((s) => s.employee_id === userId).length,
    audit_logs: db.activity_log.filter((e) => e.user_id === userId).length,
    pancake_transactions: pancakeCount ?? 0,
  };
}

export function totalLinked(counts: LinkedRecordCounts): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}
