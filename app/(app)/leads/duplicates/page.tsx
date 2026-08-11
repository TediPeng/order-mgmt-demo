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
  resolveDuplicateGroupAction,
} from "@/lib/actions/lead-duplicates";

const PAGE_SIZE = 50;

/** Deleting every duplicate is thousands of rows in chunked statements. The
 * default ceiling is generous for a page render and short for a sweep. */
export const maxDuration = 60;

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
  searchParams: Promise<{ page?: string; deleted?: string; error?: string }>;
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
  const [summary, groups] = await Promise.all([
    duplicateSummary(scope),
    duplicateGroupPage(scope, page, PAGE_SIZE),
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

      {summary.groups === 0 && (
        <Card>
          <CardContent className="p-10 text-center text-sm text-slate-400">
            No contact number appears twice. Nothing to clean up.
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
