import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDbLite } from "@/lib/db";
import { downloadFile } from "@/lib/storage";
import { can } from "@/lib/permissions";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await readDbLite();
  const { id } = await params;
  const record = db.attendance.find((a) => a.id === id);
  if (!record || !record.attachment_path) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isOwner = record.user_id === user.id;
  const canManage = can(user.role, "attendance", "edit", db.role_permissions) || can(user.role, "attendance", "approve", db.role_permissions);
  if (!isOwner && !canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const buffer = await downloadFile(`attendance/${record.attachment_path}`);
  if (!buffer) return NextResponse.json({ error: "File missing" }, { status: 404 });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `inline; filename="${record.attachment_path}"`,
    },
  });
}
