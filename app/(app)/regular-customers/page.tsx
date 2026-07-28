import Link from "next/link";
import { redirect } from "next/navigation";
import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { listCustomers, ordersForCustomer, listOpenDuplicates } from "@/lib/customers";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmitButton";
import { untagRegularCustomerAction } from "@/lib/actions/regular-customers";

export default async function RegularCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ tagged?: string; untagged?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDb();

  if (!can(user.role, "regular_customers", "view", db.role_permissions)) redirect("/dashboard");
  const canManage = can(user.role, "regular_customers", "manage", db.role_permissions);

  // Scope mirrors the leads rules: agents see their own, team leads their
  // team's, management everyone's.
  let ownerAgentIds: string[] | undefined;
  if (!isFullAccess(user.role)) {
    ownerAgentIds =
      user.role === "team_lead"
        ? [user.id, ...db.profiles.filter((p) => p.team_lead_id === user.id).map((p) => p.id)]
        : [user.id];
  }

  const customers = await listCustomers({ ownerAgentIds });
  const nameById = new Map(db.profiles.map((p) => [p.id, p.full_name]));

  // The duplicate queue is a Management/Team Lead concern only — an agent is
  // never shown that a match exists.
  const canSeeDuplicates = isFullAccess(user.role) || user.role === "team_lead";
  const openDuplicates = canSeeDuplicates ? await listOpenDuplicates() : [];

  const rows = await Promise.all(
    customers.map(async (c) => {
      const orders = await ordersForCustomer(c, db.orders);
      const latest = orders[0] || null;
      const previous = orders[1] || null;
      return { customer: c, orders, latest, previous };
    })
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-page-title text-slate-900">Regular Customers</h1>
        {canSeeDuplicates && openDuplicates.length > 0 && (
          <Link
            href="/regular-customers/duplicates"
            className="rounded-md bg-amber-100 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-200"
          >
            {openDuplicates.length} possible duplicate{openDuplicates.length === 1 ? "" : "s"} to review
          </Link>
        )}
      </div>

      {sp.tagged && <Alert kind="success" className="mb-4">Customer moved to Regular Customers. Their leads no longer appear in the active list.</Alert>}
      {sp.untagged && <Alert kind="success" className="mb-4">Customer returned to the active Leads list.</Alert>}
      {sp.error && <Alert kind="error" className="mb-4">{sp.error}</Alert>}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[1500px] text-left text-table">
          <thead className="sticky top-0 bg-slate-50 text-table font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Customer Name</th>
              <th className="px-4 py-3">Phone Number</th>
              <th className="px-4 py-3">Complete Address</th>
              <th className="px-4 py-3">Assigned Agent</th>
              <th className="px-4 py-3">Previous Order</th>
              <th className="px-4 py-3">Latest Order</th>
              <th className="px-4 py-3">Total Orders</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Regular Since</th>
              {canManage && <th className="px-4 py-3">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(({ customer, orders, latest, previous }) => (
              <tr key={customer.id} className="odd:bg-slate-50/40 hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">{customer.full_name}</td>
                <td className="px-4 py-3 text-slate-600">{customer.phone_raw}</td>
                <td className="px-4 py-3 text-slate-600">
                  {[customer.purok, customer.barangay, customer.city, customer.province].filter(Boolean).join(", ") || "—"}
                </td>
                <td className="px-4 py-3 text-slate-600">{nameById.get(customer.owner_agent_id) || "—"}</td>
                <td className="px-4 py-3 text-slate-600">
                  {previous ? (
                    <>
                      <div>{previous.order_date ? formatDate(previous.order_date) : "—"}</div>
                      <div className="text-xs text-slate-400">
                        {previous.product_name || "—"} · {formatCurrency(previous.total_amount)}
                      </div>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {latest ? (
                    <>
                      <div>{latest.order_date ? formatDate(latest.order_date) : "—"}</div>
                      <div className="text-xs text-slate-400">
                        {latest.product_name || "—"} · {formatCurrency(latest.total_amount)}
                      </div>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">{orders.length}</td>
                <td className="px-4 py-3">
                  <Badge className={customer.customer_status === "active" ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}>
                    {customer.customer_status}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-slate-600">{customer.regular_since ? formatDate(customer.regular_since) : "—"}</td>
                {canManage && (
                  <td className="px-4 py-3">
                    <form action={untagRegularCustomerAction.bind(null, customer.id)}>
                      <ConfirmSubmitButton confirmMessage="Return this customer to the active Leads list?">
                        Return to Leads
                      </ConfirmSubmitButton>
                    </form>
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={canManage ? 10 : 9} className="px-4 py-10 text-center text-slate-400">
                  No regular customers yet. Tag one from a lead&apos;s details popup.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
