import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDb } from "@/lib/db";
import { isFullAccess } from "@/lib/permissions";
import { getCallLogImage } from "@/lib/agent-call-logs";
import { downloadFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Serves a call-log screenshot from the private bucket.
 *
 * Scoped the same way the rest of the app scopes records: an agent may see
 * only their own, a team lead their team's, Management everyone's. The bucket
 * itself stays private, so the only way to an image is through this check —
 * there is no public URL to guess or share. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getCurrentUser();
  if (!viewer) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const image = await getCallLogImage(id);
  if (!image) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  if (!isFullAccess(viewer.role)) {
    const db = await readDb();
    const allowed =
      viewer.role === "team_lead"
        ? [viewer.id, ...db.profiles.filter((p) => p.team_lead_id === viewer.id).map((p) => p.id)]
        : [viewer.id];
    if (!allowed.includes(image.agent_id)) {
      return NextResponse.json({ ok: false, error: "You do not have access to that image." }, { status: 403 });
    }
  }

  const buffer = await downloadFile(image.storage_path);
  if (!buffer) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const ext = image.storage_path.split(".").pop()?.toLowerCase();
  const contentType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

  return new NextResponse(new Uint8Array(buffer), {
    headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=3600" },
  });
}
