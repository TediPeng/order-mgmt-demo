import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDb, writeDb } from "@/lib/db";
import { queryAuditLogForExport } from "@/lib/audit-log";
import { can } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { formatDateTime } from "@/lib/utils";
import { buildBrandedCsv } from "@/lib/csv";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await readDb();
  if (!can(user.role, "audit_logs", "export", db.role_permissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const userFilter = searchParams.get("user") || "";
  const moduleFilter = searchParams.get("module") || "";
  const actionFilter = searchParams.get("action") || "";
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";

  const entries = await queryAuditLogForExport({
    user: userFilter,
    module: moduleFilter,
    action: actionFilter,
    from,
    to,
  });

  const byId = new Map(db.profiles.map((p) => [p.id, p.full_name]));
  const header = ["When", "User", "Email", "Action", "Module", "Previous", "Updated", "IP", "Device"];
  const rows = entries.map((e) => [
    formatDateTime(e.created_at),
    e.user_id ? byId.get(e.user_id) || "Unknown" : "System",
    e.user_email || "",
    e.action,
    e.module || "",
    e.previous_value ? JSON.stringify(e.previous_value) : "",
    e.updated_value ? JSON.stringify(e.updated_value) : "",
    e.ip_address || "",
    e.device_info || "",
  ]);
  const csv = buildBrandedCsv("Audit Log Export", header, rows);

  const info = await getRequestInfo();
  logActivity(db, user.id, "REPORT_EXPORTED", "audit_log", null, { count: entries.length }, {
    module: "audit_logs",
    ...info,
  });
  await writeDb(db);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="audit-log-export-${Date.now()}.csv"`,
    },
  });
}
