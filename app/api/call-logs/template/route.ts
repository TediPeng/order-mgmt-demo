import * as XLSX from "xlsx";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { CALL_LOG_HEADERS } from "@/lib/validation";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // When, and what number. Whose log it is comes from who uploads it.
  const wsData = [CALL_LOG_HEADERS, ["2026-07-20 09:15", "0917-000-0000"]];
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
      // wrong one gets filled in for the next month. The name says what is in
      // it, so the right file is picked without opening either.
      "Content-Disposition": 'attachment; filename="call-log-template-date-phone.xlsx"',
    },
  });
}
