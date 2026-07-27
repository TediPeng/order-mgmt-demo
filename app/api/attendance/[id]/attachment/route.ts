import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDb, UPLOADS_DIR } from "@/lib/db";
import { can } from "@/lib/permissions";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = readDb();
  const { id } = await params;
  const record = db.attendance.find((a) => a.id === id);
  if (!record || !record.attachment_path) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isOwner = record.user_id === user.id;
  const canManage = can(user.role, "attendance", "edit", db.role_permissions) || can(user.role, "attendance", "approve", db.role_permissions);
  if (!isOwner && !canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const filePath = path.join(UPLOADS_DIR, "attendance", record.attachment_path);
  if (!fs.existsSync(filePath)) return NextResponse.json({ error: "File missing" }, { status: 404 });

  const buffer = fs.readFileSync(filePath);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `inline; filename="${record.attachment_path}"`,
    },
  });
}
