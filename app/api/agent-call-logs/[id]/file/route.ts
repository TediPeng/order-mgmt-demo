import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDb } from "@/lib/db";
import { getUpload, canViewAgentRecords } from "@/lib/agent-call-logs";
import { downloadFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Downloads the original file behind an upload, from the private bucket.
 *
 * Uploads made before the original was retained have no stored file; that is
 * reported plainly rather than as a generic 404, so the reason is obvious
 * instead of looking like the file was lost. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getCurrentUser();
  if (!viewer) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const upload = await getUpload(id);
  if (!upload) return NextResponse.json({ ok: false, error: "Upload not found." }, { status: 404 });

  const db = await readDb();
  if (!canViewAgentRecords(viewer, upload.agent_id, db.profiles)) {
    return NextResponse.json({ ok: false, error: "You do not have access to that upload." }, { status: 403 });
  }

  if (!upload.storage_path) {
    return NextResponse.json(
      { ok: false, error: "The original file was not kept for this upload. Its imported rows are still available in the preview." },
      { status: 404 }
    );
  }

  const buffer = await downloadFile(upload.storage_path);
  if (!buffer) return NextResponse.json({ ok: false, error: "The stored file could not be read." }, { status: 404 });

  const isCsv = upload.file_name.toLowerCase().endsWith(".csv");
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": isCsv ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${upload.file_name.replace(/"/g, "")}"`,
    },
  });
}
