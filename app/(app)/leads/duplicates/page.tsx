import Link from "next/link";
import { redirect } from "next/navigation";
import { readDbLite } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { leadScopeFor } from "@/lib/leads-query";
import { duplicateGroupPage, duplicateSummary } from "@/lib/duplicates-query";
import { displayUserName } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
import { Alert } from "@/components/ui/Alert";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { Button, LinkButton } from "@/components/ui/Button";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmitButton";
import {
  deleteAllDuplicatesAction,
  deleteDuplicateOrderAction,
  deleteRegularCustomerLeadsAction,
  resolveDuplicateGroupAction,
} from "@/lib/actions/lead-duplicates";
import { regularCustomerLeads } from "@/lib/regular-customer-leads";

const PAGE_SIZE = 50;

/** Deleting every duplicate is thousands of rows in chunked statements, and the
 * page this redirects back to is itself two window-function passes over the
 * whole orders table — about four seconds each at 76,000 rows.
 *
 * Sixty seconds covered the sweep but not the sweep AND the render that follows
 * it: a 12,282-row delete on 2026-08-17 landed in full and then died on the way
 * back, showing "a server-side exception has occurred" over a deletion that had
 * actually succeeded. 300 is the Pro ceiling and this is one of the few pages
 * that can genuinely need it. */
export const maxDuration = 300;

/**
 * Duplicate Leads — the same contact number entered more than once.
 *
 * Grouped by phone rather than by name because the phone is what identifies a
 * person across two rows typed by different people: "JOSE B MARADDAG" and
 * "Jose Maraddag" are one customer, and only the number says so.
 *
 * Every group keeps its earliest lead — the one an agent has had longest, and
 * the one any call history hangs off — and offers the rest for permanent
 * deletion. Deletion here is final: there is no trash, and the audit entry
 * holds the only remaining copy of the row.
 *
 * The grouping happens in the database (lib/duplicates-query.ts). It used to
 * happen here, over every order in the system — 57,000 rows fetched to render
 * fifty numbers.
 */
export default async function DuplicateLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; deleted?: string; rc_deleted?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDbLite();

  if (!can(user.role, "orders", "view", db.role_permissions)) redirect("/dashboard");
  // Permanent deletion is the orders.delete grant — Administrator only by
  // default. Everyone who can see Leads can still SEE the duplicates, because
  // knowing two agents hold the same number is useful even without the power
  // to resolve it.
  const canDelete = can(user.role, "orders", "delete", db.role_permissions);

  const scope = leadScopeFor(user, db);
  const page = Math.max(1, Number(sp.page) || 1);
  const [summary, groups, rcReport] = await Promise.all([
    duplicateSummary(scope),
    duplicateGroupPage(scope, page, PAGE_SIZE),
    regularCustomerLeads(scope),
  ]);
  const nameById = new Map(db.profiles.map((p) => [p.id, displayUserName(p)]));
  const pageCount = Math.max(1, Math.ceil(summary.groups / PAGE_SIZE));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-page-title text-slate-900">Duplicate Leads</h1>
          <p className="mt-1 text-sm text-slate-500">
            Leads sharing a contact number. The earliest of each is kept; the rest can be deleted permanently.
          </p>
        </div>
        <LinkButton href="/leads" variant="outline" size="sm">
          Back to Leads
        </LinkButton>
      </div>

      {sp.deleted && (
        <Alert kind="success" className="mb-4">
          {sp.deleted} duplicate lead{sp.deleted === "1" ? "" : "s"} permanently deleted.
        </Alert>
      )}
      {sp.rc_deleted && (
        <Alert kind="success" className="mb-4">
          {sp.rc_deleted} lead{sp.rc_deleted === "1" ? "" : "s"} on a regular customer&apos;s number removed. The
          customer record{sp.rc_deleted === "1" ? " was" : "s were"} kept.
        </Alert>
      )}
      {sp.error && (
        <Alert kind="error" className="mb-4">
          {sp.error}
        </Alert>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase text-slate-400">Numbers affected</p>
            <p className="text-page-title text-slate-900">{summary.groups}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase text-slate-400">Extra leads</p>
            <p className="text-page-title text-slate-900">{summary.duplicateRows}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase text-slate-400">Deletable here</p>
            <p className="text-page-title text-red-700">{summary.removableRows}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase text-slate-400">Protected</p>
            <p className="text-page-title text-slate-500">{summary.protectedRows}</p>
          </CardContent>
        </Card>
      </div>

      {summary.protectedRows > 0 && (
        <Alert kind="info" className="mb-4">
          {summary.protectedRows} duplicate{summary.protectedRows === 1 ? " is" : "s are"} protected from deletion here:
          an order already sent to Pancake POS, or one that reached Packaging, is a sale in another system&apos;s hands
          — those are reconciled by a person, not swept up. So is a lead whose number is kept by a different agent:
          removing it would hand that customer to someone else rather than tidy a list, and a newly imported batch is
          always the newest row, so it would always be the one to go.
        </Alert>
      )}

      {canDelete && summary.removableRows > 0 && (
        <Card className="mb-4 border-red-200">
          <CardContent className="flex flex-wrap items-end justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-medium text-slate-800">Delete every duplicate at once</p>
              <p className="mt-1 text-xs text-slate-500">
                Keeps the earliest lead for each number and permanently deletes the other {summary.removableRows}.
                There is no undo — type <span className="font-medium text-slate-700">{summary.removableRows}</span> to
                confirm.
              </p>
              {/* The audit entry keeps whole rows, but only the first fifty of
                  a sweep, and this one is in the thousands. Past that fiftieth
                  row the file is the only copy there will ever be, so it is
                  offered here rather than somewhere it would be found after
                  the fact. */}
              <p className="mt-1 text-xs text-slate-500">
                <a href="/api/leads/duplicates/export" className="font-medium text-[var(--brand-primary)] hover:underline">
                  Download the list first
                </a>{" "}
                — every duplicate, which is kept and which goes. Only the first 50 deletions are recoverable from the
                audit log.
              </p>
            </div>
            <form action={deleteAllDuplicatesAction} className="flex items-center gap-2">
              <Input name="confirm_count" inputMode="numeric" placeholder={String(summary.removableRows)} className="w-28" />
              <Button type="submit" variant="danger">
                Delete {summary.removableRows}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* A different collision from the groups below, and invisible to them: a
          regular customer's own orders are flagged out of Leads, so the lead
          and the customer never appear in the same list to be compared. The
          customer record is the one that survives — it holds the history, the
          ownership and the sharing. */}
      {rcReport.rows.length > 0 && (
        <Card className="mb-4 border-amber-200">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-800">
                  {rcReport.rows.length} lead{rcReport.rows.length === 1 ? " is" : "s are"} on a number that is already
                  a regular customer
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  The customer record is kept — only the lead goes. {rcReport.removableIds.length} can be removed,
                  including leads with a call outcome on them
                  {rcReport.protectedCount > 0 && (
                    <>
                      ; {rcReport.protectedCount} {rcReport.protectedCount === 1 ? "is" : "are"} protected — an order
                      that reached Packaging or Pancake POS is a sale in another system&apos;s hands
                    </>
                  )}
                  .
                </p>
              </div>
              {canDelete && rcReport.removableIds.length > 0 && (
                <form action={deleteRegularCustomerLeadsAction} className="flex items-center gap-2">
                  <Input
                    name="confirm_count"
                    inputMode="numeric"
                    placeholder={String(rcReport.removableIds.length)}
                    className="w-28"
                  />
                  <Button type="submit" variant="danger">
                    Remove {rcReport.removableIds.length}
                  </Button>
                </form>
              )}
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-400">
                    <th className="py-2 pr-3">Lead</th>
                    <th className="py-2 pr-3">On the lead</th>
                    <th className="py-2 pr-3">Regular customer</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {rcReport.rows.slice(0, 50).map((r) => (
                    <tr key={r.order.id} className="border-b border-slate-50">
                      <td className="py-2 pr-3 font-mono text-xs text-slate-500">{r.order.order_number}</td>
                      <td className="py-2 pr-3">
                        <span className="text-slate-800">{r.order.customer_name}</span>
                        <span className="block text-xs text-slate-400">{r.order.customer_phone}</span>
                      </td>
                      <td className="py-2 pr-3">
                        <span className="text-slate-800">{r.customerName}</span>
                        <span className="block text-xs text-slate-400">
                          {r.customerOwnerId ? nameById.get(r.customerOwnerId) || "another agent" : "unassigned"}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <StatusBadge status={r.order.status} />
                      </td>
                      <td className="py-2 text-xs">
                        {r.protectedReason ? (
                          <span className="text-slate-500">Kept — {r.protectedReason}</span>
                        ) : (
                          <span className="font-medium text-red-700">Lead will be deleted</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rcReport.rows.length > 50 && (
                <p className="mt-2 text-xs text-slate-400">
                  Showing the 50 oldest of {rcReport.rows.length}. The button acts on all of them.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {summary.groups === 0 && rcReport.rows.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center text-sm text-slate-400">
            No contact number appears twice, and no lead sits on a regular customer&apos;s number. Nothing to clean up.
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {groups.map((group) => {
          const removable = group.orders.filter((o) => !o.is_keeper && !o.protected_reason);
          const keeper = group.orders.find((o) => o.is_keeper);
          return (
            <Card key={group.phone_key}>
              <CardContent className="p-0">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-800">{group.phone_display}</span>
                    <Badge className="bg-amber-100 text-amber-800">{group.group_size} leads</Badge>
                    <span className="text-xs text-slate-400">{keeper?.customer_name}</span>
                  </div>
                  {canDelete && removable.length > 0 && (
                    <form action={resolveDuplicateGroupAction.bind(null, group.phone_key)}>
                      <ConfirmSubmitButton
                        confirmMessage={`Permanently delete ${removable.length} duplicate lead${
                          removable.length === 1 ? "" : "s"
                        } for ${group.phone_display}? The earliest one is kept. This cannot be undone.`}
                      >
                        Keep earliest, delete {removable.length}
                      </ConfirmSubmitButton>
                    </form>
                  )}
                </div>

                <table className="w-full text-left text-table">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Order ID</th>
                      <th className="px-4 py-2">Customer Name</th>
                      <th className="px-4 py-2">Address</th>
                      <th className="px-4 py-2">Agent</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2">Created</th>
                      <th className="px-4 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {group.orders.map((order) => (
                      <tr key={order.id} className={order.is_keeper ? "bg-green-50/50" : undefined}>
                        <td className="px-4 py-2">
                          <Link href={`/leads/${order.id}`} className="font-medium text-[var(--brand-primary)] hover:underline">
                            {order.order_number}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-slate-700">{order.customer_name}</td>
                        <td className="px-4 py-2 text-slate-500">
                          {[order.purok, order.barangay, order.city, order.province].filter(Boolean).join(", ") || "—"}
                        </td>
                        <td className="px-4 py-2 text-slate-500">{nameById.get(order.agent_id) || "—"}</td>
                        <td className="px-4 py-2">
                          <StatusBadge status={order.status} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-slate-500">{formatDateTime(order.created_at)}</td>
                        <td className="px-4 py-2 text-right">
                          {order.is_keeper ? (
                            <Badge className="bg-green-100 text-green-700">Keeping</Badge>
                          ) : order.protected_reason ? (
                            <span className="text-xs text-slate-400">{order.protected_reason}</span>
                          ) : canDelete ? (
                            <form action={deleteDuplicateOrderAction.bind(null, order.id)} className="inline-flex">
                              <ConfirmSubmitButton
                                confirmMessage={`Permanently delete ${order.order_number}? This cannot be undone.`}
                              >
                                Delete
                              </ConfirmSubmitButton>
                            </form>
                          ) : (
                            <span className="text-xs text-slate-400">Duplicate</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {pageCount > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <span>
            Page {page} of {pageCount} · {summary.groups} numbers
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <LinkButton href={`/leads/duplicates?page=${page - 1}`} variant="outline" size="sm">
                Previous
              </LinkButton>
            )}
            {page < pageCount && (
              <LinkButton href={`/leads/duplicates?page=${page + 1}`} variant="outline" size="sm">
                Next
              </LinkButton>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
