import * as XLSX from "xlsx";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDbLite } from "@/lib/db";
import { can } from "@/lib/permissions";
import { leadScopeFor } from "@/lib/leads-query";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { displayUserName, type Profile } from "@/lib/types";
import { LEAD_STATUS_LABELS } from "@/lib/validation";
import { todayInTz } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Every duplicate row on this viewer's scope, as a workbook.
 *
 * Deleting duplicates has no undo. The audit entry keeps whole rows so they
 * could in principle be rebuilt, but only the first fifty of a sweep
 * (AUDIT_SAMPLE), and a floor-wide clean is measured in thousands — so past
 * that fiftieth row the only copy of a deleted lead was nothing at all.
 *
 * This is that copy. Taken before the button is pressed, it is the difference
 * between a mistake that is annoying and one that is permanent.
 *
 * Every duplicate is listed, kept and deletable alike, with the reason a row is
 * protected — a file that showed only what is about to go would not let anyone
 * check that the right lead is being kept.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await readDbLite();
  if (!can(user.role, "orders", "view", db.role_permissions)) {
    return NextResponse.json({ error: "You do not have permission to view leads." }, { status: 403 });
  }

  const scope = leadScopeFor(user, db);
  const { data, error } = await supabaseAdmin.rpc("lead_duplicate_rows", { p_agent_ids: scope });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const nameById = new Map(db.profiles.map((p: Profile) => [p.id, displayUserName(p)]));
  const rows = (data || []) as Record<string, unknown>[];

  const aoa: unknown[][] = [
    [
      "Phone (grouping key)",
      "Order ID",
      "Customer Name",
      "Phone Number",
      "Purok",
      "Barangay",
      "City",
      "Province",
      "Agent",
      "Status",
      "Created",
      "Kept or deletable",
      "Protected because",
    ],
  ];

  for (const r of rows) {
    const rn = Number(r.rn);
    const protectedReason = r.protected_reason ? String(r.protected_reason) : "";
    const status = String(r.status);
    aoa.push([
      String(r.phone_key ?? ""),
      String(r.order_number ?? ""),
      String(r.customer_name ?? ""),
      String(r.customer_phone ?? ""),
      String(r.purok ?? ""),
      String(r.barangay ?? ""),
      String(r.city ?? ""),
      String(r.province ?? ""),
      nameById.get(String(r.agent_id)) || "",
      LEAD_STATUS_LABELS[status as keyof typeof LEAD_STATUS_LABELS] || status,
      new Date(String(r.created_at)).toLocaleString("en-PH", { timeZone: "Asia/Manila" }),
      rn === 1 ? "KEPT" : protectedReason ? "PROTECTED" : "WILL BE DELETED",
      protectedReason,
    ]);
  }

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet["!cols"] = [
    { wch: 14 },
    { wch: 22 },
    { wch: 26 },
    { wch: 16 },
    { wch: 16 },
    { wch: 18 },
    { wch: 16 },
    { wch: 16 },
    { wch: 18 },
    { wch: 14 },
    { wch: 22 },
    { wch: 18 },
    { wch: 34 },
  ];
  // Sorted by number already, since lead_duplicate_rows partitions by it — the
  // freeze keeps the header in view while somebody reads down a group.
  sheet["!freeze"] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Duplicate leads");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="duplicate-leads-${todayInTz()}.xlsx"`,
    },
  });
}
