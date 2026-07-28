import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** The agent call-log template: exactly the three columns the importer reads.
 *
 * Deliberately not the richer Management call-log template — an agent supplies
 * only who they called and when, and every row is attributed to them on
 * import, so an agent column would be misleading. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const header = ["CALL NAME", "PHONE NUMBER", "CALL DATE"];
  const sample = [user.call_name || "CALL NAME", "09171234567", "2026-07-28"];
  const csv = [header, sample].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="call-log-template.csv"',
    },
  });
}
