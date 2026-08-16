import Link from "next/link";
import { redirect } from "next/navigation";
import { readDbLite } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { displayUserName } from "@/lib/types";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/Card";
import { Button, LinkButton } from "@/components/ui/Button";
import { listOrdersWithFailedSync } from "@/lib/pancake/store";
import { RETRY_BATCH } from "@/lib/pancake/config";
import { retryFailedSyncsAction } from "@/lib/actions/pancake";
import type { Order } from "@/lib/types";

/** Retrying twenty orders is twenty conversations with somebody else's API. */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Every order Pancake would not take, grouped by the reason it would not.
 *
 * The failures were only ever visible one at a time — a red line inside one
 * order's popup, and a notification per attempt. Nothing said how many there
 * were or that eleven of them came down to two causes, so the queue was worked
 * by opening orders one by one, if it was worked at all.
 *
 * Grouping is the point. Six orders blocked on one agent's email is one thing to
 * fix and one button to press afterwards, not six.
 */

interface Cause {
  /** Groups the rows. Carries the offending value, so two agents missing from
   * Pancake are two groups — they are two different things to go and fix. */
  key: string;
  title: string;
  detail: string;
  /** Where the fix is made, when it is somewhere in this app. */
  fixHref?: string;
  fixLabel?: string;
  /** A retry cannot help until a person has done something first. */
  needsPerson?: boolean;
}

function causeOf(error: string | null): Cause {
  const message = (error || "").trim() || "Sync failed";

  if (/refusing to guess/i.test(message)) {
    return {
      key: "ambiguous",
      title: "Pancake may already hold these orders",
      detail:
        "An attempt that timed out can still have reached Pancake. More than one Pancake order matches this phone and total, so the retry will not guess which one is ours — a duplicate shipment is worse than a late one. Find the number in Pancake, cancel the duplicate, then retry.",
      needsPerson: true,
    };
  }

  const staff = message.match(/No matching staff found in Pancake POS for email:\s*(.+)$/i);
  if (staff) {
    return {
      key: `staff:${staff[1]}`,
      title: `Not a Pancake staff member: ${staff[1]}`,
      detail:
        "Pancake takes a staff ID for Customer Care, never an email, so the agent has to exist as an employee of the shop itself. Add them in Pancake and retry — a failed match now re-reads the staff list on its own, so there is no cache to clear first.",
      fixHref: "/settings/integrations/mappings",
      fixLabel: "Order Source & Staff",
    };
  }

  const source = message.match(/No matching Order Source found in Pancake POS for call name:\s*(.+)$/i);
  if (source) {
    return {
      key: `source:${source[1]}`,
      title: `No Pancake Order Source named: ${source[1]}`,
      detail:
        "Pancake takes an Order Source ID, never free text. Either create that source in Pancake or change the agent's Call Name to one that exists, then retry.",
      fixHref: "/settings/integrations/mappings",
      fixLabel: "Order Source & Staff",
    };
  }

  if (/timed out|responded 5\d\d|Could not read/i.test(message)) {
    return {
      key: "unreachable",
      title: "Pancake was unreachable",
      detail:
        "A timeout or a server error from Pancake. Nothing is wrong with these orders — retrying is usually all they need.",
    };
  }

  return { key: `other:${message}`, title: message, detail: "" };
}

export default async function SyncFailedPage({
  searchParams,
}: {
  searchParams: Promise<{ retried?: string; fixed?: string; left?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDbLite();

  if (!can(user.role, "integrations", "view", db.role_permissions)) redirect("/dashboard");
  const canRetry = can(user.role, "integrations", "manage", db.role_permissions);

  const failed = await listOrdersWithFailedSync();
  const agentNameById = new Map(db.profiles.map((p) => [p.id, displayUserName(p)]));

  // Grouped, then worst-first: the biggest pile is the one worth fixing next.
  const groups = new Map<string, { cause: Cause; orders: Order[] }>();
  for (const order of failed) {
    const cause = causeOf(order.pancake_sync_error);
    const group = groups.get(cause.key) || { cause, orders: [] };
    group.orders.push(order);
    groups.set(cause.key, group);
  }
  const ordered = Array.from(groups.values()).sort((a, b) => b.orders.length - a.orders.length);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-page-title text-slate-900">Sync Failed</h1>
          <p className="text-sm text-slate-500">
            Orders Pancake POS would not accept, grouped by the reason. Fix the reason once, then retry the whole group.
          </p>
        </div>
        <div className="flex gap-2">
          <LinkButton href="/settings/integrations" variant="outline" size="sm">
            Integrations
          </LinkButton>
          <LinkButton href="/settings/integrations/logs" variant="outline" size="sm">
            Sync Logs
          </LinkButton>
        </div>
      </div>

      {sp.error && <Alert kind="error">{sp.error}</Alert>}
      {sp.retried && (
        <Alert kind={Number(sp.fixed) === Number(sp.retried) ? "success" : "info"}>
          Retried {sp.retried} order(s): {sp.fixed} went through
          {Number(sp.fixed) < Number(sp.retried) ? `, ${Number(sp.retried) - Number(sp.fixed)} failed again` : ""}.
          {Number(sp.left) > 0 && ` ${sp.left} left in that group — press Retry All again to take the next batch.`}
        </Alert>
      )}

      {failed.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-slate-500">
            Nothing has failed to sync. Every order that reached Packaging is in Pancake POS.
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-slate-500">
          <span className="font-medium text-slate-800">{failed.length}</span> order
          {failed.length === 1 ? "" : "s"} waiting, from{" "}
          <span className="font-medium text-slate-800">{ordered.length}</span> cause
          {ordered.length === 1 ? "" : "s"}.
        </p>
      )}

      {ordered.map(({ cause, orders }) => {
        // Ids only. The action closes over whatever this names, and an array of
        // whole orders is a great deal more than it needs.
        const groupIds = orders.map((o) => o.id);
        const retryGroup = async () => {
          "use server";
          await retryFailedSyncsAction(groupIds);
        };
        return (
          <Card key={cause.key}>
            <CardContent className="p-0">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-4">
                <div className="max-w-2xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-section-title text-slate-900">{cause.title}</h2>
                    <Badge className="bg-red-100 text-red-700">
                      {orders.length} order{orders.length === 1 ? "" : "s"}
                    </Badge>
                    {cause.needsPerson && (
                      <Badge className="bg-amber-100 text-amber-800">Needs a person first</Badge>
                    )}
                  </div>
                  {cause.detail && <p className="mt-1 text-sm text-slate-500">{cause.detail}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {cause.fixHref && (
                    <LinkButton href={cause.fixHref} variant="outline" size="sm">
                      {cause.fixLabel}
                    </LinkButton>
                  )}
                  {canRetry && (
                    <form action={retryGroup}>
                      {/* Says what it will do, not what is in the group. Only a
                          handful fit in one request, and a button promising
                          eleven that sends five is a bug report waiting. */}
                      <Button type="submit" size="sm" variant={cause.needsPerson ? "outline" : "primary"}>
                        {orders.length > RETRY_BATCH ? `Retry next ${RETRY_BATCH}` : `Retry all ${orders.length}`}
                      </Button>
                    </form>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-left text-table">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr className="whitespace-nowrap">
                      <th className="px-3 py-2">Order ID</th>
                      <th className="px-3 py-2">Customer</th>
                      <th className="px-3 py-2">Agent</th>
                      <th className="px-3 py-2">Amount</th>
                      <th className="px-3 py-2">Attempts</th>
                      <th className="px-3 py-2">Last attempt</th>
                      <th className="whitespace-nowrap px-3 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {orders.map((o) => {
                      const orderId = o.id;
                      const retryOne = async () => {
                        "use server";
                        await retryFailedSyncsAction([orderId]);
                      };
                      return (
                        <tr key={o.id} className="whitespace-nowrap">
                          <td className="px-3 py-2">
                            {/* Opens the order itself, where the full sync
                                history and the raw error live. */}
                            <Link
                              href={`/leads?open_id=${o.id}`}
                              className="font-medium text-[var(--brand-primary)] hover:underline"
                            >
                              {o.order_number}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-slate-600">{o.customer_name}</td>
                          <td className="px-3 py-2 text-slate-600">{agentNameById.get(o.agent_id) || "—"}</td>
                          <td className="px-3 py-2 text-slate-600">{formatCurrency(o.total_amount)}</td>
                          <td className="px-3 py-2 text-slate-500">{o.pancake_retry_count}</td>
                          <td className="px-3 py-2 text-slate-500">
                            {o.pancake_last_sync_attempt_at ? formatDateTime(o.pancake_last_sync_attempt_at) : "—"}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right">
                            {/* Retry is a decision, and the row alone is not
                                enough to make it: what the order holds, what it
                                last sent and what Pancake said back are all in
                                the popup. The order id has always linked there;
                                a named button says so, next to the action it is
                                supposed to inform. */}
                            <div className="inline-flex items-center gap-2">
                              <LinkButton href={`/leads?open_id=${o.id}`} variant="outline" size="sm">
                                Details
                              </LinkButton>
                              {canRetry && (
                                <form action={retryOne} className="inline-flex">
                                  <Button type="submit" size="sm" variant="outline">
                                    Retry
                                  </Button>
                                </form>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
