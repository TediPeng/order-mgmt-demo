/**
 * READ ONLY. Lists orders from Pancake for a date window and reports which of
 * them ROMA has never heard of.
 *
 * It writes nothing, to Pancake or to Supabase. Its whole job is to size the
 * gap and prove the matching rule before a single row is created: on 8 Oct the
 * POS showed 171 orders where ROMA held 169, and the day before the gap was
 * eight. Nobody should be importing anything until we can see exactly which
 * orders those are and why they are missing.
 *
 *   npx tsx scripts/pancake-missing-probe.ts            # today, Manila
 *   npx tsx scripts/pancake-missing-probe.ts 2026-10-07 # one named day
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { createClient } from "@supabase/supabase-js";
import { pancakeFetch, unwrapData } from "../lib/pancake/client";

const TZ_OFFSET_HOURS = 8; // Asia/Manila, no DST
const PAGE_SIZE = 100;

/** Unix SECONDS for the start of a Manila day. The API takes seconds, not
 *  milliseconds and not ISO -- the reference calls this out in capitals. */
function manilaDayWindow(ymd: string): { start: number; end: number } {
  const startMs = Date.parse(`${ymd}T00:00:00.000Z`) - TZ_OFFSET_HOURS * 3600_000;
  return { start: Math.floor(startMs / 1000), end: Math.floor(startMs / 1000) + 86_400 };
}

function todayManila(): string {
  return new Date(Date.now() + TZ_OFFSET_HOURS * 3600_000).toISOString().slice(0, 10);
}

interface PancakeOrderRow {
  id?: unknown;
  status?: unknown;
  total_price?: unknown;
  order_sources_name?: unknown;
  inserted_at?: unknown;
  bill_full_name?: unknown;
}

async function main() {
  const day = process.argv[2] || todayManila();
  const { start, end } = manilaDayWindow(day);
  console.log(`\nAraw: ${day} (Manila)   window ${start}..${end}\n`);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: accounts, error: accErr } = await db
    .from("pancake_accounts")
    .select("id, account_name, shop_or_page_id, api_endpoint, api_key_encrypted")
    .eq("is_active", true);
  if (accErr) throw new Error(`Cannot read pancake_accounts: ${accErr.message}`);
  if (!accounts?.length) throw new Error("No active Pancake account");

  for (const acc of accounts) {
    console.log(`=== ${acc.account_name}  (shop ${acc.shop_or_page_id}) ===`);
    const fromPancake: PancakeOrderRow[] = [];

    // Ascending, and paged to the end. Descending over a window that is still
    // being written to lets an order updated mid-paging jump to page 1 and push
    // an unread row off the back.
    for (let page = 1; page <= 100; page++) {
      const qs = new URLSearchParams({
        page_size: String(PAGE_SIZE),
        page_number: String(page),
        updateStatus: "inserted_at",
        startDateTime: String(start),
        endDateTime: String(end),
        option_sort: "inserted_at_asc",
      });
      const res = await pancakeFetch(acc, `/shops/${encodeURIComponent(acc.shop_or_page_id)}/orders?${qs}`, {
        method: "GET",
      });
      if (!res.ok) {
        console.log(`  page ${page}: HTTP ${res.httpStatus} — ${res.error}`);
        break;
      }
      const body = res.body as Record<string, unknown>;
      const rows = (Array.isArray(body?.data) ? body.data : []) as PancakeOrderRow[];
      const totalPages = Number(body?.total_pages ?? 1);
      const totalEntries = Number(body?.total_entries ?? rows.length);
      fromPancake.push(...rows);
      if (page === 1) console.log(`  total_entries=${totalEntries}  total_pages=${totalPages}`);
      if (page >= totalPages || rows.length === 0) break;
    }

    const ids = fromPancake.map((o) => String(o.id ?? "")).filter(Boolean);
    console.log(`  nakuha sa Pancake: ${ids.length}`);
    if (ids.length === 0) {
      console.log("");
      continue;
    }

    // Chunked: a few hundred ids in one `in` list is fine, thousands is not.
    const known = new Set<string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await db
        .from("orders")
        .select("pancake_order_id")
        .in("pancake_order_id", ids.slice(i, i + 200));
      if (error) throw new Error(`Cannot read orders: ${error.message}`);
      for (const r of data || []) if (r.pancake_order_id) known.add(String(r.pancake_order_id));
    }

    const missing = fromPancake.filter((o) => !known.has(String(o.id ?? "")));
    console.log(`  nasa ROMA: ${known.size}`);
    console.log(`  WALA SA ROMA: ${missing.length}`);
    for (const m of missing.slice(0, 25)) {
      console.log(
        `     id=${String(m.id)}  status=${String(m.status)}  halaga=${String(m.total_price)}` +
          `  source=${String(m.order_sources_name ?? "(wala)")}  ${String(m.bill_full_name ?? "")}`
      );
    }
    if (missing.length > 25) console.log(`     … at ${missing.length - 25} pa`);
    console.log("");
  }
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
