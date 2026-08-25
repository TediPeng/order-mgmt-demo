import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDbLite } from "@/lib/db";
import { canAssignLeads } from "@/lib/order-access";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizePhone } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Who holds this number.
 *
 * Typing a phone number is how a person refers to a lead out loud — "the one
 * who called back on 0917…" — so it is how they should be able to refer to one
 * on the transfer screen. The answer comes as they type rather than behind a
 * button, because the question being asked is "is this the right one", and an
 * answer that needs a click is one they will skip.
 *
 * The same grant as transferring: this says which agent holds a customer, which
 * is not something to hand to anyone who can merely view leads.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const db = await readDbLite();
  if (!canAssignLeads(user, db)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  // Normalised the same way the lead index is, so 0917…, +63917… and 917… are
  // one number rather than three.
  const key = normalizePhone(searchParams.get("phone") || "");
  if (!key) return NextResponse.json({ ok: true, key: "", leads: [] });

  const { data, error } = await supabaseAdmin.rpc("leads_on_phone", { p_phone_key: key });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, key, leads: data || [] });
}
