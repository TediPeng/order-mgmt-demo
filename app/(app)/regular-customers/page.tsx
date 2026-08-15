import { Copy as CopyIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { readDbLite } from "@/lib/db";
import { ordersForCustomers } from "@/lib/orders-lookup";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { listCustomers, ordersForCustomer, listOpenDuplicates, scanDuplicateCustomers } from "@/lib/customers";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmitButton";
import { Input } from "@/components/ui/Field";
import { Button, LinkButton } from "@/components/ui/Button";
import { BackToCallButton } from "@/components/BackToCallButton";
import { untagRegularCustomerAction } from "@/lib/actions/regular-customers";

export default async function RegularCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ tagged?: string; untagged?: string; created?: string; deleted?: string; error?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDbLite();

  if (!can(user.role, "regular_customers", "view", db.role_permissions)) redirect("/dashboard");
  const canManage = can(user.role, "regular_customers", "manage", db.role_permissions);
  // Adding a regular customer is its own grant — it is not adding a lead, and
  // an agent holds it by default so they can build their own list.
  const canCreate = can(user.role, "regular_customers", "create", db.role_permissions);
  // Raising an order for a regular customer is still creating an order, so it
  // takes orders.create — the Regular Customers grant covers the customer, not
  // the sale.
  const canOrder = can(user.role, "orders", "create", db.role_permissions);

  // Scope mirrors the leads rules: agents see their own, team leads their
  // team's, management everyone's.
  let ownerAgentIds: string[] | undefined;
  if (!isFullAccess(user.role)) {
    ownerAgentIds =
      user.role === "team_lead"
        ? [user.id, ...db.profiles.filter((p) => p.team_lead_id === user.id).map((p) => p.id)]
        : [user.id];
  }

  const query = (sp.q || "").trim();
  const customers = await listCustomers({ ownerAgentIds, q: query });
  const nameById = new Map(db.profiles.map((p) => [p.id, p.full_name]));

  // The duplicate queue is a Management/Team Lead concern only — an agent is
  // never shown that a match exists.
  const canSeeDuplicates = isFullAccess(user.role) || user.role === "team_lead";
  // Two different questions, and the card shows the one that matters: the scan
  // is what is true now, the queue is what somebody has yet to decide about.
  const [openDuplicates, duplicateGroups] = canSeeDuplicates
    ? await Promise.all([listOpenDuplicates(), scanDuplicateCustomers()])
    : [[], []];

  // The orders behind the customers on this page, in one query. This used to
  // hand ordersForCustomer() every order in the system, once per customer.
  const customerOrders = await ordersForCustomers(customers);
  const rows = await Promise.all(
    customers.map(async (c) => {
      const orders = await ordersForCustomer(c, customerOrders);
      const latest = orders[0] || null;
      const previous = orders[1] || null;
      return { customer: c, orders, latest, previous };
    })
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-page-title text-slate-900">Regular Customers</h1>
          <p className="mt-1 text-sm text-slate-500">
            Your own repeat customers. They are kept out of the Leads list — adding one here does not create a lead.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* A card of its own, always shown to those who may see it — a
              duplicates control that appears only when there ARE duplicates
              cannot be used to check that there are none. Amber when there is
              something to look at, plain when there is not. */}
          {canSeeDuplicates && (
            <Link
              href="/regular-customers/duplicates"
              className={cn(
                "rounded-lg border px-3 py-2 transition-colors",
                duplicateGroups.length > 0
                  ? "border-amber-300 bg-amber-50 hover:bg-amber-100"
                  : "border-slate-200 bg-white hover:border-slate-300"
              )}
            >
              <span className="flex items-center gap-1.5">
                <CopyIcon
                  className={cn("h-3.5 w-3.5", duplicateGroups.length > 0 ? "text-amber-700" : "text-slate-400")}
                  aria-hidden
                />
                <span
                  className={cn(
                    "text-xs font-medium",
                    duplicateGroups.length > 0 ? "text-amber-800" : "text-slate-500"
                  )}
                >
                  Duplicates
                </span>
              </span>
              <span
                className={cn(
                  "text-lg font-semibold",
                  duplicateGroups.length > 0 ? "text-amber-900" : "text-slate-900"
                )}
              >
                {duplicateGroups.length}
              </span>
              {openDuplicates.length > 0 && (
                <span className="ml-2 text-xs text-amber-700">+{openDuplicates.length} to review</span>
              )}
            </Link>
          )}
          {/* The way back. This page is reached from the Leads screen — from the
              count in its header, or from a customer who was just tagged — and
              until now the only route back was the sidebar. */}
          <LinkButton href="/leads" variant="outline" size="sm">
            ← Back to Leads
          </LinkButton>
          {/* Only while a call is actually running. One call is open at a time,
              and the popup that ends it lives in the leads table, so an agent
              who came here mid-call had to remember which lead it was on. */}
          <BackToCallButton />
          {canCreate && <LinkButton href="/regular-customers/new">Add Regular Customer</LinkButton>}
        </div>
      </div>

      {sp.created && <Alert kind="success" className="mb-4">Regular customer added. No lead was created.</Alert>}
      {sp.tagged && <Alert kind="success" className="mb-4">Customer moved to Regular Customers. Their leads no longer appear in the active list.</Alert>}
      {sp.untagged && <Alert kind="success" className="mb-4">Customer returned to the active Leads list.</Alert>}
      {sp.deleted && (
        <Alert kind="success" className="mb-4">
          {sp.deleted} was permanently deleted. Any orders they had are back in the Leads list.
        </Alert>
      )}
      {sp.error && <Alert kind="error" className="mb-4">{sp.error}</Alert>}

      {/* One box, matched against the name, the number and the address. A
          number is searched by its digits, so the stored form — 0927…, +63927…
          or 927… — does not have to be guessed. */}
      <form className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          name="q"
          defaultValue={query}
          placeholder="Search name, phone number or address"
          className="w-full sm:w-96"
        />
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
        {query && (
          <LinkButton href="/regular-customers" variant="outline" size="sm">
            Clear
          </LinkButton>
        )}
        {query && (
          <span className="text-sm text-slate-500">
            {customers.length} match{customers.length === 1 ? "" : "es"} for &ldquo;{query}&rdquo;
          </span>
        )}
      </form>

      <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[1500px] text-left text-table">
          <thead className="sticky top-0 z-20 bg-slate-50 shadow-sm text-table font-medium uppercase tracking-wide text-slate-500">
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
              <th className="px-4 py-3">Actions</th>
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
                {/* Their orders are out of the Leads list by design, so this
                    page has to be the way back to them. */}
                <td className="px-4 py-3 text-slate-600">
                  {previous ? (
                    <Link href={`/leads/${previous.id}`} className="block hover:underline">
                      <div>{previous.order_date ? formatDate(previous.order_date) : "—"}</div>
                      <div className="text-xs text-slate-400">
                        {previous.product_name || "—"} · {formatCurrency(previous.total_amount)}
                      </div>
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {latest ? (
                    <Link href={`/leads/${latest.id}`} className="block hover:underline">
                      <div>{latest.order_date ? formatDate(latest.order_date) : "—"}</div>
                      <div className="text-xs text-slate-400">
                        {latest.product_name || "—"} · {formatCurrency(latest.total_amount)}
                      </div>
                    </Link>
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
                {(
                  <td className="whitespace-nowrap px-4 py-3">
                    {/* One line, not three. These were wrapping because the
                        column is narrower than the three controls, which made
                        the Actions rows three times the height of every other
                        row and left the table looking ragged. The table already
                        scrolls sideways, so the width costs nothing. */}
                    <div className="flex flex-nowrap items-center gap-2">
                      {/* Their record and every order on it. The table shows
                          two orders and a count; this is where the rest of it
                          lives, and it is reachable even for a customer who
                          has no orders at all. */}
                      <LinkButton href={`/regular-customers/${customer.id}`} variant="outline" size="sm">
                        Details
                      </LinkButton>
                      {/* Starts the order form with this customer's details
                          already filled in — no retyping, and the order is
                          recorded against their record. */}
                      {canOrder && (
                        <LinkButton href={`/leads/new?customer=${customer.id}`} size="sm">
                          New Order
                        </LinkButton>
                      )}
                      {canManage && (
                        <form action={untagRegularCustomerAction.bind(null, customer.id)}>
                          {/* Styled like Details beside it. It carried no
                              classes at all, so it rendered as bare text next
                              to two proper buttons — the one control here that
                              changes something looked the least like a control. */}
                          <ConfirmSubmitButton
                            confirmTitle="Return to Leads?"
                            confirmMessage={`Return ${customer.full_name} to the active Leads list?`}
                            confirmLabel="Return to Leads"
                          >
                            Return to Leads
                          </ConfirmSubmitButton>
                        </form>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-slate-400">
                  {query ? (
                    <>No regular customer matches &ldquo;{query}&rdquo;.</>
                  ) : (
                    <>
                      No regular customers yet.{" "}
                      {canCreate
                        ? "Use Add Regular Customer, or tag one from a lead's details popup."
                        : "They are added from a lead's details popup."}
                    </>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
