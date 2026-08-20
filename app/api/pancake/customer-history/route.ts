import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDbLite } from "@/lib/db";
import { can } from "@/lib/permissions";
import { listAccounts } from "@/lib/pancake/store";
import { pancakeCustomerHistory, type PancakeCustomerHistory } from "@/lib/pancake/customerHistory";
import { normalizePhone } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * A customer's delivered/returned counts, from Pancake POS.
 *
 * Asked per popup rather than per row. The Leads list shows twenty-five leads
 * and this is one Pancake call per number: fetching the page would be
 * twenty-five outbound calls on every render, for numbers nobody opened. An
 * agent needs the figure at the moment they open the order, and that is when it
 * is fetched.
 */

interface CacheEntry {
  value: PancakeCustomerHistory;
  fetchedAt: number;
}

/**
 * In-memory, per server instance, for fifteen minutes.
 *
 * Deliberately not a table: that would be a schema change on a live database
 * and nobody has asked for one. The cost of losing it on a deploy is one
 * repeated Pancake call per number, which is the same call the popup would have
 * made anyway. Fifteen minutes is short enough that a parcel marked returned
 * this morning shows up in the same shift.
 */
const cache = new Map<string, CacheEntry>();
const TTL_MS = 15 * 60 * 1000;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const db = await readDbLite();
  // The same grant that lets someone see a lead at all — this is a fact about
  // the customer on the lead they already have open.
  if (!can(user.role, "orders", "view", db.role_permissions)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const phone = req.nextUrl.searchParams.get("phone") || "";
  const key = normalizePhone(phone);
  if (!key) return NextResponse.json({ ok: true, history: null });

  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) {
    return NextResponse.json({ ok: true, history: hit.value, cached: true });
  }

  const accounts = (await listAccounts()).filter((a) => a.is_active);
  const account = accounts.find((a) => a.is_default) || accounts[0];
  if (!account) {
    // Not an error the agent can act on, and not a zero either — the popup
    // shows nothing rather than claiming a clean record.
    return NextResponse.json({ ok: true, history: null });
  }

  const history = await pancakeCustomerHistory(account, phone);
  // A failed lookup is not cached: the next open should try again rather than
  // repeat a stale failure for a quarter of an hour.
  if (!history.error) cache.set(key, { value: history, fetchedAt: Date.now() });

  return NextResponse.json({ ok: true, history });
}
