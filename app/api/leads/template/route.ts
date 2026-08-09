import * as XLSX from "xlsx";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { LEAD_IMPORT_HEADERS } from "@/lib/validation";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const wsData = [
    LEAD_IMPORT_HEADERS,
    [
      "jamie.santos",
      "Juan Dela Cruz",
      "0917-000-0000",
      "Purok 2",
      "Barangay Sample",
      "Manila",
      "Metro Manila",
      "Near the sari-sari store",
      // Previous Order Date / Product / Amount / Note — all optional. Left
      // blank in the sample: the system fills them from the customer's last
      // packaged order when the file does not.
      "",
      "",
      "",
      "",
    ],
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Leads");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="leads-import-template.xlsx"',
    },
  });
}
