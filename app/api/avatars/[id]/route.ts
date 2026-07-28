import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { downloadFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Serves a profile picture from the private bucket.
 *
 * Any signed-in user may fetch any avatar, because avatars appear in rankings,
 * user lists and audit rows — that is the point of them. What stays private is
 * the storage bucket itself: nothing is publicly addressable, so a picture
 * cannot leak to anyone without a session. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getCurrentUser();
  if (!viewer) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // The newest file for this user; the upload path is timestamped.
  const { data: files, error } = await supabaseAdmin.storage.from("uploads").list(`avatars/${id}`, {
    limit: 1,
    sortBy: { column: "name", order: "desc" },
  });
  if (error || !files || files.length === 0) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const buffer = await downloadFile(`avatars/${id}/${files[0].name}`);
  if (!buffer) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const ext = files[0].name.split(".").pop()?.toLowerCase();
  const contentType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentType,
      // The URL carries a ?v= cache-buster on change, so this can cache hard.
      "Cache-Control": "private, max-age=86400",
    },
  });
}
