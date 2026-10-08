import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { PancakeAccount } from "@/lib/types";
import { syncRecentDays } from "@/lib/pancake/posDailyTotals";

export const dynamic = "force-dynamic";

/** Mirrors the last few days of Pancake totals into pos_daily_totals.
 *
 * Nothing reads that table yet. This fills it so the figures can be checked
 * against the POS screen before the dashboard is pointed at them.
 *
 * Protected by CRON_SECRET, the same Bearer token the other crons take. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin.from("pancake_accounts").select("*").eq("is_active", true);
  if (error) {
    return NextResponse.json({ ok: false, error: `Cannot read pancake_accounts: ${error.message}` }, { status: 500 });
  }
  const accounts = (data || []) as unknown as PancakeAccount[];
  if (accounts.length === 0) {
    return NextResponse.json({ ok: true, accounts: 0, note: "No active Pancake account" });
  }

  // One account's outage must not cost the others their refresh, so each is
  // reported on its own rather than taking the whole run down.
  const results = await Promise.all(
    accounts.map(async (account) => {
      try {
        const days = await syncRecentDays(account);
        return { account: account.account_name, ok: true as const, days };
      } catch (e) {
        return { account: account.account_name, ok: false as const, error: e instanceof Error ? e.message : String(e) };
      }
    })
  );

  // 200 even when an account failed: the body says which, and a red mark in the
  // dashboard for a Pancake timeout would cry wolf several times a week.
  return NextResponse.json({ ok: results.every((r) => r.ok), results });
}
