import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDb, writeDb } from "@/lib/db";
import { can } from "@/lib/permissions";
import { applyLeadUpdate } from "@/lib/actions/leads";

/** Powers the Order Details modal's Edit/Update Status flows -- same
 * validation, RTS gating, and activity logging as the full-page form
 * (lib/actions/leads.ts#applyLeadUpdate), but responds with JSON instead of
 * redirecting so the modal never navigates or reloads the Leads page. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const db = readDb();
  if (!can(user.role, "orders", "edit", db.role_permissions)) {
    return NextResponse.json({ ok: false, error: "You do not have permission to perform this action." }, { status: 403 });
  }

  let raw: Record<string, unknown>;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const result = await applyLeadUpdate(user, db, id, raw);
  if (!result.ok) {
    const status = result.code === "not_found" ? 404 : result.code === "forbidden" ? 403 : 400;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }

  writeDb(db);
  return NextResponse.json({ ok: true, order: result.order });
}
