import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { readDbLite } from "@/lib/db";
import { ordersForCustomers } from "@/lib/orders-lookup";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { getCustomer, ordersForCustomer } from "@/lib/customers";
import { displayUserName } from "@/lib/types";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmitButton";
import { LinkButton } from "@/components/ui/Button";
import { untagRegularCustomerAction } from "@/lib/actions/regular-customers";

/**
 * One regular customer, and every order on their record.
 *
 * The list shows the latest two orders and a count; a customer with more than
 * that had nowhere to be looked at, and one with no orders at all — which is
 * what Add Regular Customer produces — had no page of their own either. Their
 * orders are deliberately kept out of the Leads list, so this is the way to
 * them.
 */
export default async function RegularCustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = (await getCurrentUser())!;
  const db = await readDbLite();

  if (!can(user.role, "regular_customers", "view", db.role_permissions)) redirect("/dashboard");

  const customer = await getCustomer(id);
  if (!customer || !customer.is_regular_customer) notFound();

  // Scope mirrors the list: an agent sees their own, a team lead their team's.
  if (!isFullAccess(user.role)) {
    const allowed =
      user.role === "team_lead"
        ? [user.id, ...db.profiles.filter((p) => p.team_lead_id === user.id).map((p) => p.id)]
        : [user.id];
    if (!allowed.includes(customer.owner_agent_id)) redirect("/regular-customers");
  }

  const canManage = can(user.role, "regular_customers", "manage", db.role_permissions);
  const canOrder = can(user.role, "orders", "create", db.role_permissions);

  const orders = await ordersForCustomer(customer, await ordersForCustomers([customer]));
  const owner = db.profiles.find((p) => p.id === customer.owner_agent_id);
  const original = customer.original_agent_id
    ? db.profiles.find((p) => p.id === customer.original_agent_id)
    : null;

  const address =
    [customer.purok, customer.barangay, customer.city, customer.province].filter(Boolean).join(", ") || "—";
  const spend = orders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-page-title text-slate-900">{customer.full_name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            Regular customer of {owner ? displayUserName(owner) : "—"}
            {customer.regular_since ? ` since ${formatDate(customer.regular_since)}` : ""}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LinkButton href="/regular-customers" variant="outline" size="sm">
            Back to Regular Customers
          </LinkButton>
          {canOrder && <LinkButton href={`/leads/new?customer=${customer.id}`} size="sm">New Order</LinkButton>}
          {canManage && (
            <form action={untagRegularCustomerAction.bind(null, customer.id)}>
              <ConfirmSubmitButton confirmMessage="Return this customer to the active Leads list?">
                Return to Leads
              </ConfirmSubmitButton>
            </form>
          )}
          {/* Administrator only, and a link rather than a form: the thing worth
              reading before deleting a customer is what happens to their orders,
              and that does not fit in a confirm() dialog. The reversible action
              is offered first, on purpose. */}
          {isFullAccess(user.role) && (
            <LinkButton href={`/regular-customers/${customer.id}/delete`} variant="danger" size="sm">
              Delete Permanently
            </LinkButton>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Customer</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Field label="Phone number" value={customer.phone_raw} />
              <Field label="Stored as" value={customer.phone_normalized} />
              <Field label="Complete address" value={address} />
              <Field label="Landmark" value={customer.landmark || "—"} />
              <Field label="Assigned agent" value={owner ? displayUserName(owner) : "—"} />
              <Field label="Originally from" value={original ? displayUserName(original) : "—"} />
              <Field label="Regular since" value={customer.regular_since ? formatDate(customer.regular_since) : "—"} />
              <Field label="Added" value={formatDateTime(customer.created_at)} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs uppercase text-slate-400">Status</dt>
                <dd className="mt-1">
                  <Badge
                    className={
                      customer.customer_status === "active"
                        ? "bg-green-100 text-green-700"
                        : "bg-slate-200 text-slate-600"
                    }
                  >
                    {customer.customer_status}
                  </Badge>
                </dd>
              </div>
              <Field label="Orders on record" value={String(orders.length)} />
              <Field label="Total value" value={formatCurrency(spend)} />
              <Field
                label="Latest order"
                value={orders[0] ? (orders[0].order_date ? formatDate(orders[0].order_date) : "Not yet packaged") : "—"}
              />
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Order history</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-table">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2">Order ID</th>
                  <th className="px-4 py-2">Order Date</th>
                  <th className="px-4 py-2">Product</th>
                  <th className="px-4 py-2">Qty</th>
                  <th className="px-4 py-2">Total</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map((order) => (
                  <tr key={order.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <Link
                        href={`/leads/${order.id}`}
                        className="font-medium text-[var(--brand-primary)] hover:underline"
                      >
                        {order.order_number}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                      {order.order_date ? formatDate(order.order_date) : "—"}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{order.product_name || "—"}</td>
                    <td className="px-4 py-2 text-slate-600">{order.quantity}</td>
                    <td className="px-4 py-2 text-slate-600">{formatCurrency(order.total_amount)}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={order.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-500">{formatDateTime(order.created_at)}</td>
                  </tr>
                ))}
                {orders.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">
                      No orders on this record yet. Use New Order to raise one — it will be recorded here rather than
                      in the Leads list.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-slate-800">{value}</dd>
    </div>
  );
}
