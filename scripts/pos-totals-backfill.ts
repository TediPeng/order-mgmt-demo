/**
 * Fills pos_daily_totals for a range of past days.
 *
 * The cron keeps the last few days fresh, which is enough to watch today but
 * not enough to answer the Dashboard's default range: it opens on All Time,
 * and ROMA has orders from 10 Aug. A sales tile that reads the POS has to have
 * the POS for every day in the range or it is quietly answering a different
 * question.
 *
 * Reads Pancake, writes ONLY pos_daily_totals. Days already stored are left
 * alone unless --force is passed, so it can be re-run after an interruption.
 *
 *   npx tsx scripts/pos-totals-backfill.ts --ref=<supabase-project-ref>
 *   npx tsx scripts/pos-totals-backfill.ts --ref=... --from=2026-08-10 --to=2026-10-08
 *   npx tsx scripts/pos-totals-backfill.ts --ref=... --force
 *
 * --ref is REQUIRED and must match the project the environment points at.
 * There is a dev database and a live one and they take the same shape; naming
 * the target out loud is what keeps a backfill off the wrong one.
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import type { PancakeAccount } from "../lib/types";

const TZ_OFFSET_HOURS = 8; // Asia/Manila, no DST

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function todayManila(): string {
  return new Date(Date.now() + TZ_OFFSET_HOURS * 3600_000).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = Date.parse(`${to}T00:00:00.000Z`);
  for (let t = Date.parse(`${from}T00:00:00.000Z`); t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

async function main() {
  const wantRef = arg("ref");
  if (!wantRef) throw new Error("Pass --ref=<supabase-project-ref>: the project this is allowed to write to.");

  // loadEnvConfig runs after hoisted imports, so anything reading process.env
  // has to be imported inside the async body.
  const { createClient } = await import("@supabase/supabase-js");
  const { pancakeFetch } = await import("../lib/pancake/client");
  const { summarise } = await import("../lib/pancake/posDailyTotals");

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set");

  const host = new URL(url).host;
  const ref = host.split(".")[0];
  console.log(`\nDatabase: ${host}`);
  if (ref !== wantRef) {
    throw new Error(`Refusing to write: the environment points at "${ref}" but --ref says "${wantRef}".`);
  }

  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data: accounts, error: accErr } = await db
    .from("pancake_accounts")
    .select("*")
    .eq("is_active", true);
  if (accErr) throw new Error(`Cannot read pancake_accounts: ${accErr.message}`);
  if (!accounts?.length) throw new Error("No active Pancake account");

  const force = process.argv.includes("--force");
  const to = arg("to") || todayManila();

  for (const account of accounts as unknown as PancakeAccount[]) {
    console.log(`\n=== ${account.account_name} (shop ${account.shop_or_page_id}) ===`);

    // Where does this shop's history actually begin? Asking beats assuming:
    // ROMA's first order is 10 Aug, but the POS predates ROMA and All Time in
    // one is not All Time in the other.
    let from = arg("from");
    if (!from) {
      const qs = new URLSearchParams({
        page_size: "1",
        page_number: "1",
        updateStatus: "inserted_at",
        startDateTime: String(Math.floor(Date.parse("2020-01-01T00:00:00Z") / 1000)),
        endDateTime: String(Math.floor(Date.now() / 1000)),
        option_sort: "inserted_at_asc",
      });
      const res = await pancakeFetch(account, `/shops/${encodeURIComponent(account.shop_or_page_id)}/orders?${qs}`, {
        method: "GET",
      });
      if (!res.ok) throw new Error(`Cannot find the shop's first order: ${res.error}`);
      const body = (res.body || {}) as Record<string, unknown>;
      const rows = (Array.isArray(body.data) ? body.data : []) as Record<string, unknown>[];
      const first = rows[0]?.inserted_at;
      if (!first) throw new Error("Pancake returned no orders at all for this shop.");
      // inserted_at is shop-local already; take its date part.
      from = String(first).slice(0, 10);
      console.log(`  unang order sa POS: ${String(first)}  ->  simula sa ${from}`);
      console.log(`  total_entries (buong kasaysayan): ${String(body.total_entries ?? "?")}`);
    }

    const { data: have, error: haveErr } = await db
      .from("pos_daily_totals")
      .select("day")
      .eq("pancake_account_id", account.id)
      .gte("day", from)
      .lte("day", to)
      .order("day");
    if (haveErr) throw new Error(`Cannot read stored days: ${haveErr.message}`);
    const stored = new Set((have || []).map((r) => String((r as { day: unknown }).day)));

    const all = daysBetween(from, to);
    const todo = force ? all : all.filter((d) => !stored.has(d));
    console.log(`  saklaw ${from}..${to} = ${all.length} araw; nasa DB na: ${stored.size}; gagawin: ${todo.length}\n`);

    let done = 0;
    for (const day of todo) {
      const rows: Record<string, unknown>[] = [];
      const startMs = Date.parse(`${day}T00:00:00.000Z`) - TZ_OFFSET_HOURS * 3600_000;
      const start = Math.floor(startMs / 1000);
      let failed: string | null = null;

      for (let page = 1; page <= 60; page++) {
        const qs = new URLSearchParams({
          page_size: "100",
          page_number: String(page),
          updateStatus: "inserted_at",
          startDateTime: String(start),
          endDateTime: String(start + 86_400),
          option_sort: "inserted_at_asc",
        });
        const res = await pancakeFetch(account, `/shops/${encodeURIComponent(account.shop_or_page_id)}/orders?${qs}`, {
          method: "GET",
        });
        if (!res.ok) {
          failed = `page ${page}: ${res.error}`;
          break;
        }
        const body = (res.body || {}) as Record<string, unknown>;
        const data = (Array.isArray(body.data) ? body.data : []) as Record<string, unknown>[];
        rows.push(...data);
        const totalPages = Number(body.total_pages ?? 1);
        if (data.length === 0 || page >= totalPages) break;
      }

      // A half-read day stored as the truth reads as a drop in sales. Skip it
      // and say so -- a re-run picks it up, because nothing was written.
      if (failed) {
        console.log(`  ${day}  LAKTAWAN (${failed})`);
        continue;
      }

      const t = summarise(day, rows);
      const { error } = await db.from("pos_daily_totals").upsert(
        {
          pancake_account_id: account.id,
          day,
          orders: t.orders,
          quantity: t.quantity,
          amount: t.amount,
          cancelled_orders: t.cancelledOrders,
          cancelled_amount: t.cancelledAmount,
          by_status: t.byStatus,
          duplicate_orders: t.duplicateOrders,
          duplicate_amount: t.duplicateAmount,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "pancake_account_id,day" }
      );
      if (error) throw new Error(`Cannot store ${day}: ${error.message}`);

      done++;
      console.log(
        `  ${day}  orders=${String(t.orders).padStart(4)}  halaga=${t.amount.toFixed(2).padStart(12)}` +
          `  kanselado=${t.cancelledOrders}  duplicado=${t.duplicateOrders}`
      );
    }
    console.log(`\n  naisulat: ${done} / ${todo.length}`);
  }
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
