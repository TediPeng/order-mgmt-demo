import * as XLSX from "xlsx";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { CALL_LOG_HEADERS } from "@/lib/validation";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // No Agent Name column: the log belongs to whoever uploads it.
  const wsData = [
    CALL_LOG_HEADERS,
    ["Juan Dela Cruz", "0917-000-0000", "2026-07-20 09:15", 180, "inbound", "Follow up"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Call Logs");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // A new name, deliberately. The old template downloaded as
      // call-log-import-template.xlsx and is sitting in everybody's Downloads
      // folder; handing out a different file under the same name is how the
      // wrong one gets filled in for the next month. Both still import — this
      // is about which file a person picks, not which the server accepts.
      "Content-Disposition": 'attachment; filename="call-log-template-v2.xlsx"',
    },
  });
}
