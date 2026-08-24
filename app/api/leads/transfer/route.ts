import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDbLite, writeDb } from "@/lib/db";
import { can, isFullAccess } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { notify } from "@/lib/notifications";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { displayUserName } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Hands one agent's leads to another.
 *
 * Reassigning a single lead has always been full-access only — the Agent field
 * on the edit form is hidden from everyone else, and applyLeadUpdate() ignores a
 * posted agent_id unless isFullAccess. Doing it a thousand at a time is the same
 * act, so it takes the same role rather than a softer one.
 *
 * The move itself is one statement (transfer_leads), because an agent can be
 * holding eight thousand leads and the point of readDbLite() is that nothing
 * pulls that into memory to change one column on each.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const db = await readDbLite();
  if (!isFullAccess(user.role) || !can(user.role, "orders", "edit", db.role_permissions)) {
    return NextResponse.json({ ok: false, error: "Only Administrators and Management can transfer leads." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const from = String(body.from || "");
  const to = String(body.to || "");
  const statuses = Array.isArray(body.statuses) ? (body.statuses as string[]).map(String) : [];
  const limit = Number(body.limit) > 0 ? Math.floor(Number(body.limit)) : null;
  const apply = !!body.apply;

  const byId = new Map(db.profiles.map((p) => [p.id, p]));
  const fromAgent = byId.get(from);
  const toAgent = byId.get(to);
  if (!fromAgent || !toAgent) {
    return NextResponse.json({ ok: false, error: "Pick both a source and a destination agent." }, { status: 400 });
  }
  if (from === to) {
    return NextResponse.json({ ok: false, error: "Those are the same agent." }, { status: 400 });
  }
  // Handing leads to somebody who cannot open them is a silent way to lose
  // them: they would leave one queue and appear in nobody's.
  if (!toAgent.is_active || toAgent.is_deleted) {
    return NextResponse.json({ ok: false, error: `${displayUserName(toAgent)} is not an active account.` }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.rpc("transfer_leads", {
    p_from: from,
    p_to: to,
    p_statuses: statuses.length > 0 ? statuses : null,
    p_actor: user.id,
    p_limit: limit,
    p_apply: apply,
  });
  if (error) return NextResponse.json({ ok: false, error: `Transfer failed: ${error.message}` }, { status: 500 });

  const result = (data || { moved: 0 }) as { moved: number; ids?: string[]; error?: string };
  if (result.error) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  if (!apply) return NextResponse.json({ ok: true, preview: true, moved: result.moved });

  // One entry for the transfer rather than one per lead: a thousand
  // LEAD_REASSIGNED rows would bury the day's real activity, and the ids are
  // here in full, so this is reversible by transferring back.
  const info = await getRequestInfo();
  logActivity(db, user.id, "LEADS_TRANSFERRED", "order", null, {
    from_agent_id: from,
    from_agent: displayUserName(fromAgent),
    to_agent_id: to,
    to_agent: displayUserName(toAgent),
    statuses,
    limit,
    moved: result.moved,
    order_ids: result.ids || [],
  }, { module: "orders", ...info });

  if (result.moved > 0) {
    notify(db, [to], "lead_transfer", "Leads transferred to you",
      `${result.moved} lead(s) moved from ${displayUserName(fromAgent)}.`, "/leads");
    notify(db, [from], "lead_transfer", "Leads moved to another agent",
      `${result.moved} of your lead(s) were transferred to ${displayUserName(toAgent)}.`, "/leads");
  }
  await writeDb(db);

  return NextResponse.json({ ok: true, preview: false, moved: result.moved });
}
