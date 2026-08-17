import { redirect } from "next/navigation";
import { readDbLite } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { scopeAgentsForUser } from "@/lib/performance";
import { agentRemainingLeads } from "@/lib/performance-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";

/**
 * How many leads are waiting, per agent.
 *
 * Its own page rather than a panel on Agent Performance, because it is the
 * question asked most often and the one that has to be answered fastest: it
 * should be one click from anywhere, not something found by scrolling a page
 * about conversion rates.
 *
 * No date range. A backlog is a standing quantity -- how much work is waiting
 * does not become a different question because a filter moved, and a queue
 * that shrank when the dates narrowed would be read as progress.
 *
 * Administrators and Management only, like the panel it replaces. A Team Lead's
 * pages stop at their own team; the size of the floor's queue is a management
 * view.
 */
export default async function RemainingLeadsPage() {
  const user = (await getCurrentUser())!;
  const db = await readDbLite();

  if (!can(user.role, "performance", "view", db.role_permissions)) redirect("/dashboard");
  if (!isFullAccess(user.role)) redirect("/performance/agents");

  const agents = scopeAgentsForUser(db, user);
  const counts = await agentRemainingLeads(agents.map((a) => a.id));

  const rows = agents
    // The Call Name in brackets, because that is the name the floor uses out
    // loud and on the leads themselves — a queue you read to decide who to give
    // work to should carry the name you would say to them. Omitted, brackets
    // and all, for an account that has none.
    .map((a) => ({
      id: a.id,
      name: a.full_name,
      callName: a.call_name?.trim() || null,
      remaining: counts.get(a.id) || 0,
    }))
    .filter((r) => r.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name));
  const total = rows.reduce((sum, r) => sum + r.remaining, 0);
  // The bar is read against whoever is carrying the most, not against the
  // total: proportions of a floor-wide sum are all small and all alike.
  const largest = rows.length > 0 ? rows[0].remaining : 0;

  return (
    <div className="space-y-4">
      <h1 className="text-page-title text-slate-900">Remaining Leads</h1>

      <Card>
        <CardHeader className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <CardTitle>Never called</CardTitle>
          <p className="text-xs text-slate-500">
            {total.toLocaleString()} waiting across {rows.length} {rows.length === 1 ? "agent" : "agents"}
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500">Nothing is waiting. Every lead has been called.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map((r) => (
                <li key={r.id} className="px-4 py-2.5">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="truncate text-table font-medium text-slate-700">
                      {r.name}
                      {r.callName && <span className="ml-1.5 text-slate-400">({r.callName})</span>}
                    </span>
                    <span className="num shrink-0 text-table font-semibold text-slate-900">
                      {r.remaining.toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-[var(--brand-primary)]"
                      style={{ width: `${largest > 0 ? Math.max((r.remaining / largest) * 100, 2) : 0}%` }}
                    />
                  </div>
                </li>
              ))}
              <li className="flex items-baseline justify-between gap-4 border-t border-slate-200 bg-slate-50 px-4 py-2.5">
                <span className="text-table font-semibold text-slate-900">All agents</span>
                <span className="num shrink-0 text-table font-semibold text-slate-900">{total.toLocaleString()}</span>
              </li>
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
