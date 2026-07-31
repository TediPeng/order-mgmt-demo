"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isFullAccess } from "@/lib/permissions";
import { getAccount, listAccounts } from "@/lib/pancake/store";
import {
  fetchOrderSources,
  fetchStaffList,
  invalidateLookupCache,
  matchOrderSource,
  matchStaffByEmail,
  type PancakeOrderSource,
  type PancakeStaff,
} from "@/lib/pancake/lookups";
import type { PancakeAccount } from "@/lib/types";

const PATH = "/settings/integrations/mappings";

export interface AgentMappingRow {
  agentId: string;
  fullName: string;
  callName: string | null;
  email: string;
  matchedOrderSource: PancakeOrderSource | null;
  matchedStaff: PancakeStaff | null;
}

export interface MappingReport {
  account: PancakeAccount | null;
  orderSources: PancakeOrderSource[];
  staff: PancakeStaff[];
  rows: AgentMappingRow[];
  orderSourceError: string | null;
  staffError: string | null;
}

/**
 * Builds the Administrator's reconciliation view: every agent alongside the
 * Pancake Order Source its Call Name resolves to, and the Pancake staff member
 * its email resolves to. An unmatched row is exactly what will block that
 * agent's next forward, so this page is the place to see it before an order
 * fails rather than after.
 */
export async function buildMappingReport(accountId?: string): Promise<MappingReport> {
  const db = await readDb();
  const accounts = await listAccounts();
  const active = accounts.filter((a) => a.is_active);
  const account = accountId
    ? await getAccount(accountId)
    : active.find((a) => a.is_default) || active[0] || null;

  if (!account) {
    return {
      account: null,
      orderSources: [],
      staff: [],
      rows: [],
      orderSourceError: "No active Pancake account is configured.",
      staffError: "No active Pancake account is configured.",
    };
  }

  const [sources, staff] = await Promise.all([fetchOrderSources(account), fetchStaffList(account)]);

  // Everyone who can own an order — agents and team leads both appear as an
  // order's agent_id, so both need a resolvable Order Source.
  const agents = db.profiles.filter((p) => p.is_active && !p.is_deleted && !isFullAccess(p.role));

  const rows: AgentMappingRow[] = agents
    .map((p) => ({
      agentId: p.id,
      fullName: p.full_name,
      callName: p.call_name,
      email: p.email,
      matchedOrderSource: matchOrderSource(sources.items, p.call_name),
      matchedStaff: matchStaffByEmail(staff.items, p.email),
    }))
    // Unmatched first: the whole point of the page is to surface the gaps.
    .sort((a, b) => {
      const aBad = Number(!a.matchedOrderSource) + Number(!a.matchedStaff);
      const bBad = Number(!b.matchedOrderSource) + Number(!b.matchedStaff);
      if (aBad !== bBad) return bBad - aBad;
      return a.fullName.localeCompare(b.fullName);
    });

  return {
    account,
    orderSources: sources.items,
    staff: staff.items,
    rows,
    orderSourceError: sources.error,
    staffError: staff.error,
  };
}

/** Drops the cached lists and re-reads them from Pancake on the next render. */
export async function refreshPancakeLookupsAction(accountId: string) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!isFullAccess(user.role)) {
    redirect(`${PATH}?error=${encodeURIComponent("Administrator access required.")}`);
  }

  const account = await getAccount(accountId);
  if (!account) redirect(`${PATH}?error=${encodeURIComponent("That Pancake account no longer exists.")}`);

  invalidateLookupCache(accountId);
  const [sources, staff] = await Promise.all([
    fetchOrderSources(account!, { force: true }),
    fetchStaffList(account!, { force: true }),
  ]);

  if (!sources.ok || !staff.ok) {
    const problem = [sources.error, staff.error].filter(Boolean).join(" · ");
    redirect(`${PATH}?account=${accountId}&error=${encodeURIComponent(problem)}`);
  }

  revalidatePath(PATH);
  redirect(`${PATH}?account=${accountId}&refreshed=1&sources=${sources.items.length}&staff=${staff.items.length}`);
}
