import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDb } from "@/lib/db";
import { getUpload, listRecordsPage, canViewAgentRecords } from "@/lib/agent-call-logs";

export const dynamic = "force-dynamic";

/** A page of the rows stored from one upload, for the preview modal.
 *
 * Returns the records the system itself counted, so what the preview shows can
 * never disagree with the imported figure beside it. Read-only by design —
 * there is no write path here at all. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getCurrentUser();
  if (!viewer) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const upload = await getUpload(id);
  if (!upload) return NextResponse.json({ ok: false, error: "Upload not found." }, { status: 404 });

  const db = await readDb();
  if (!canViewAgentRecords(viewer, upload.agent_id, db.profiles)) {
    return NextResponse.json({ ok: false, error: "You do not have access to that upload." }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  try {
    const { rows, total } = await listRecordsPage({
      uploadId: id,
      search: sp.get("q") || "",
      sort: sp.get("sort") === "desc" ? "desc" : "asc",
      page: Number(sp.get("page") || 1),
      pageSize: Number(sp.get("pageSize") || 50),
    });

    const agent = db.profiles.find((p) => p.id === upload.agent_id);
    return NextResponse.json({
      ok: true,
      rows,
      total,
      upload: {
        id: upload.id,
        file_name: upload.file_name,
        uploaded_at: upload.uploaded_at,
        imported_rows: upload.imported_rows,
        total_rows: upload.total_rows,
        duplicate_rows: upload.duplicate_rows,
        rejected_rows: (upload.invalid_rows ?? 0) + (upload.failed_rows ?? 0),
        has_original_file: Boolean(upload.storage_path),
        agent_name: agent?.full_name || "Unknown",
        agent_call_name: agent?.call_name || null,
      },
    });
  } catch {
    // The message the spec asks for, rather than an internal error the reader
    // can do nothing with.
    return NextResponse.json(
      {
        ok: false,
        error:
          "Unable to preview this file. Please download the original file or upload a valid Excel or CSV file.",
      },
      { status: 422 }
    );
  }
}
