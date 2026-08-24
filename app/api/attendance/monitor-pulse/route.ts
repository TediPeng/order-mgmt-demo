import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { todayInTz } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Has anything the monitor draws actually changed?
 *
 * The board used to learn about a Calling click by re-rendering itself on a
 * timer, which meant a supervisor waited out the interval to see something that
 * had already happened — and shortening the interval means running a full
 * server render (the database-lite read, four aggregates, the call-target
 * lookup) every couple of seconds for a screen that is usually identical.
 *
 * This is the cheap half of that question: one round trip, three small indexed
 * reads, a hash out. The board polls it every couple of seconds and only calls
 * router.refresh() when the hash moves, so a click lands on the board almost at
 * once and an idle floor costs almost nothing.
 *
 * Deliberately no permission check beyond being signed in: the response is a
 * hash of nothing, and the page behind it is already gated. Scope is applied
 * inside the function so a Team Lead is not woken by another team.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const { data, error } = await supabaseAdmin.rpc("monitor_pulse", {
    p_viewer: user.id,
    p_work_date: todayInTz(),
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, v: String(data || "") });
}
