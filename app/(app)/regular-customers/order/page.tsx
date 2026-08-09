import Link from "next/link";
import { redirect } from "next/navigation";
import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { listCustomers, ordersForCustomer } from "@/lib/customers";
import { formatCurrency, formatDate, normalizePhone } from "@/lib/utils";
import { Alert } from "@/components/ui/Alert";
import { Card, CardContent } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { Button, LinkButton } from "@/components/ui/Button";
import { timeInBlockReason, TIME_IN_HREF } from "@/lib/time-in-gate";

/**
 * Create Order from Regular Customer — the phone-number picker.
 *
 * Agents work from the number the customer is calling on, so the search is the
 * phone number first: type any part of it and the matching regular customers
 * appear with their numbers visible. Choosing one hands off to
 * /leads/new?customer=<id>, which fills the order form from that customer's
 * saved details.
 *
 * The list is scoped exactly as Regular Customers is — an agent searches their
 * own customers only, so this cannot become a way to look up another agent's
 * numbers.
 */
export default async function CreateOrderFromRegularCustomerPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDb();

  if (!can(user.role, "regular_customers", "view", db.role_permissions)) redirect("/dashboard");
  if (!can(user.role, "orders", "create", db.role_permissions)) {
    return <Alert kind="error">You do not have permission to create orders.</Alert>;
  }

  let ownerAgentIds: string[] | undefined;
  if (!isFullAccess(user.role)) {
    ownerAgentIds =
      user.role === "team_lead"
        ? [user.id, ...db.profiles.filter((p) => p.team_lead_id === user.id).map((p) => p.id)]
        : [user.id];
  }

  const customers = await listCustomers({ ownerAgentIds });

  // Phone first: digits are compared against the stored normalized number, so
  // 0917…, +63917… and 917… all find the same customer. A query with letters
  // in it is treated as a name search instead, since that is plainly what was
  // meant.
  const term = (q || "").trim();
  const digits = term.replace(/\D/g, "");
  const nameTerm = term.toLowerCase();
  const matches = !term
    ? customers
    : customers.filter((c) => {
        if (digits) return c.phone_normalized.includes(normalizePhone(digits)) || c.phone_raw.replace(/\D/g, "").includes(digits);
        return c.full_name.toLowerCase().includes(nameTerm);
      });

  const rows = await Promise.all(
    matches.map(async (c) => {
      const orders = await ordersForCustomer(c, db.orders);
      return { customer: c, orders, latest: orders[0] || null };
    })
  );

  // An agent who has not timed in cannot create an order — said here rather
  // than only after they have picked someone.
  const notTimedIn = timeInBlockReason(db, user);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-page-title text-slate-900">Create Order from Regular Customer</h1>
          <p className="mt-1 text-sm text-slate-500">
            Search by phone number, then order using that customer&apos;s saved details.
          </p>
        </div>
        <LinkButton href="/regular-customers" variant="outline" size="sm">
          All Regular Customers
        </LinkButton>
      </div>

      {notTimedIn && (
        <Alert kind="warning" className="mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <span>{notTimedIn}</span>
            <LinkButton href={TIME_IN_HREF} variant="secondary" size="sm">
              Go to Time In
            </LinkButton>
          </div>
        </Alert>
      )}

      {/* GET, so a search is a plain URL the agent can go back to. */}
      <form className="mb-4 flex gap-2">
        <Input
          name="q"
          defaultValue={term}
          inputMode="tel"
          placeholder="Search phone number (or customer name)"
          aria-label="Search phone number"
        />
        <Button type="submit">Search</Button>
      </form>

      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-slate-100">
            {rows.map(({ customer, orders, latest }) => (
              <li key={customer.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  {/* The number leads the row: it is what the agent is
                      searching on and what confirms they picked the right
                      person before ordering. */}
                  <p className="font-medium text-slate-800">{customer.phone_raw}</p>
                  <p className="text-sm text-slate-600">{customer.full_name}</p>
                  <p className="text-xs text-slate-400">
                    {[customer.purok, customer.barangay, customer.city, customer.province].filter(Boolean).join(", ") || "No address saved"}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {orders.length} order{orders.length === 1 ? "" : "s"}
                    {latest
                      ? ` · last ${latest.order_date ? formatDate(latest.order_date) : "—"} · ${latest.product_name || "—"} · ${formatCurrency(latest.total_amount)}`
                      : ""}
                  </p>
                </div>
                <LinkButton href={`/leads/new?customer=${customer.id}`}>Create Order</LinkButton>
              </li>
            ))}
            {rows.length === 0 && (
              <li className="px-4 py-10 text-center text-sm text-slate-400">
                {term ? (
                  <>
                    No regular customer matches <span className="font-medium text-slate-500">{term}</span>.{" "}
                    <Link href="/regular-customers/new" className="text-[var(--brand-primary)] hover:underline">
                      Add them as a regular customer
                    </Link>{" "}
                    first.
                  </>
                ) : (
                  <>
                    No regular customers yet.{" "}
                    <Link href="/regular-customers/new" className="text-[var(--brand-primary)] hover:underline">
                      Add one
                    </Link>
                    .
                  </>
                )}
              </li>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
