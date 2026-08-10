import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDbLite } from "@/lib/db";
import { can } from "@/lib/permissions";
import { buildProductTemplateCsv } from "@/lib/product-upload";

export const dynamic = "force-dynamic";

/** Downloads the blank product-list template (Section 7). CSV so it opens
 * cleanly in both Excel and Google Sheets; the upload accepts .xlsx too. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const db = await readDbLite();
  if (!can(user.role, "products", "view", db.role_permissions)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  return new NextResponse(buildProductTemplateCsv(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="4S-ROMA-product-template.csv"',
    },
  });
}
