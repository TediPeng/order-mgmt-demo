import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { readDbLite } from "@/lib/db";
import { isFullAccess } from "@/lib/permissions";
import { getCustomer } from "@/lib/customers";
import { orderRowsForCustomer } from "@/lib/orders-lookup";
import { formatDate } from "@/lib/utils";
import { Alert } from "@/components/ui/Alert";
import { Button, LinkButton } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Label, Textarea } from "@/components/ui/Field";
import { permanentlyDeleteRegularCustomerAction } from "@/lib/actions/regular-customers";
import { displayUserName } from "@/lib/types";

/**
 * The confirmation the delete button leads to.
 *
 * Deliberately a page rather than a confirm() on the list: the thing worth
 * reading before deleting a customer is what happens to their orders, and a
 * browser dialog has no room to say it.
 */
export default async function DeleteRegularCustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDbLite();

  if (!isFullAccess(user.role)) {
    return <Alert kind="error">Administrator access is required to delete a customer.</Alert>;
  }

  const customer = await getCustomer(id);
  if (!customer) notFound();

  const owner = db.profiles.find((p) => p.id === customer.owner_agent_id);
  const orders = await orderRowsForCustomer(id);
  const action = permanentlyDeleteRegularCustomerAction.bind(null, id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-page-title text-slate-900">Permanently Delete Customer</h1>
        <p className="text-sm text-slate-500">This is irreversible. Read every step before confirming.</p>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>1. Customer details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Detail label="Full name" value={customer.full_name} />
            <Detail label="Phone number" value={customer.phone_raw} />
            <Detail label="Owner agent" value={owner ? displayUserName(owner) : "—"} />
            <Detail label="Regular since" value={customer.regular_since ? formatDate(customer.regular_since) : "—"} />
            <Detail
              label="Complete address"
              value={[customer.purok, customer.barangay, customer.city, customer.province].filter(Boolean).join(", ") || "—"}
            />
            <Detail label="Total orders" value={String(customer.total_orders ?? orders.length)} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. What this does</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert kind="error">This cannot be undone. There is no recovery once confirmed.</Alert>

          <p className="text-sm text-slate-600">
            The customer record is removed, along with any duplicate-match entries pointing at it.
          </p>

          {orders.length > 0 ? (
            <>
              <p className="text-sm text-slate-600">
                {/* The one thing somebody deleting a customer needs to know, and
                    the one thing a confirm() dialog had no room to say. */}
                Their <strong>{orders.length}</strong> order{orders.length === 1 ? " is" : "s are"} <strong>not</strong>{" "}
                deleted. Business transactions are never deleted here — an order is what was sold, to whom, and by which
                agent, and removing it would change sales figures for a period already reported on. The order
                {orders.length === 1 ? "" : "s"} will be released back to the Leads list as ordinary lead
                {orders.length === 1 ? "" : "s"}, exactly as <em>Return to Leads</em> leaves them.
              </p>
              <Alert kind="warning">
                If you only want them out of Regular Customers, use <em>Return to Leads</em> instead — it does the same
                thing to the orders and keeps the person on file, and it can be undone.
              </Alert>
            </>
          ) : (
            <p className="text-sm text-slate-600">
              This customer has no orders, so nothing is released and nothing else changes.
            </p>
          )}
        </CardContent>
      </Card>

      <form action={action}>
        <Card>
          <CardHeader>
            <CardTitle>3. Confirm</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="confirm_text">Type DELETE to confirm</Label>
              <Input id="confirm_text" name="confirm_text" required autoComplete="off" placeholder="DELETE" />
            </div>

            <div>
              <Label htmlFor="admin_password">Your password</Label>
              <Input id="admin_password" name="admin_password" type="password" required autoComplete="current-password" />
              <p className="mt-1 text-xs text-slate-400">
                Re-authenticates you server-side. It is never stored or written to any log.
              </p>
            </div>

            <div>
              <Label htmlFor="reason">Reason for deletion</Label>
              <Textarea id="reason" name="reason" rows={3} required minLength={5} />
            </div>

            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" name="final_confirm" required className="mt-0.5 h-4 w-4 rounded border-slate-300" />
              <span>I understand this is permanent and cannot be undone.</span>
            </label>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <LinkButton href={`/regular-customers/${id}`} variant="outline">
                Cancel
              </LinkButton>
              <Button type="submit" variant="danger">
                Permanently Delete Customer
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase text-slate-400">{label}</dt>
      <dd className="text-slate-800">{value}</dd>
    </div>
  );
}
