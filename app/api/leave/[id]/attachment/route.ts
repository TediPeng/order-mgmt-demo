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
  const request = db.leave_requests.find((r) => r.id === id);
  if (!request || !request.attachment_path) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isOwner = request.agent_id === user.id;
  const canApprove = can(user.role, "leave", "approve", db.role_permissions);
  const isSupervisor = user.role === "team_lead" && request.supervisor_id === user.id;
  if (!isOwner && !canApprove && !isSupervisor) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const buffer = await downloadFile(`leave/${request.attachment_path}`);
  if (!buffer) return NextResponse.json({ error: "File missing" }, { status: 404 });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `inline; filename="${request.attachment_path}"`,
    },
  });
}
