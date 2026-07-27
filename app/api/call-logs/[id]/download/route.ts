import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDb, writeDb } from "@/lib/db";
import { downloadFile } from "@/lib/storage";
import { can } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await readDb();
  if (!can(user.role, "call_logs", "view", db.role_permissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const callLog = db.call_logs.find((c) => c.id === id);
  if (!callLog) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const buffer = await downloadFile(`call-logs/${callLog.storage_path}`);
  if (!buffer) return NextResponse.json({ error: "File missing" }, { status: 404 });

  logActivity(db, user.id, "CALL_LOG_DOWNLOADED", "call_log", callLog.id, { file_name: callLog.file_name });
  await writeDb(db);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${callLog.file_name}"`,
    },
  });
}
