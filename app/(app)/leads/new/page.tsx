import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { LinkButton } from "@/components/ui/Button";
import { LeadForm, type RepeatOrderPrefill } from "@/components/LeadForm";
import { orderById } from "@/lib/orders-lookup";
import { RegularCustomerCallPanel } from "@/components/RegularCustomerCallPanel";
import { RepeatOrderCallPanel } from "@/components/RepeatOrderCallPanel";
import { createLeadAction } from "@/lib/actions/leads";
import { allowedAssigneeIds, canAssignLeads } from "@/lib/order-access";
import { getCurrentUser } from "@/lib/auth";
import { readDbLite } from "@/lib/db";
import { can, isFullAccess } from "@/lib/permissions";
import { displayUserName } from "@/lib/types";
import { creatableStatuses } from "@/lib/validation";
import { timeInBlockReason, TIME_IN_HREF } from "@/lib/time-in-gate";
import { getCustomer } from "@/lib/customers";
import type { RegularCustomerPrefill } from "@/components/LeadForm";
import { resolveDialScheme } from "@/lib/dial";

export default async function NewLeadPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    time_in_required?: string;
    customer?: string;
    /** Copy the customer's details across from an order they already placed. */
    from_order?: string;
  }>;
}) {
  const { error, time_in_required, customer: customerId, from_order: fromOrderId } = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDbLite();
  const dialScheme = resolveDialScheme(user.dial_scheme, db.operations.dial_scheme);

  if (!can(user.role, "orders", "create", db.role_permissions)) {
    return <Alert kind="error">You do not have permission to create leads.</Alert>;
  }

  const allowedIds = new Set(allowedAssigneeIds(user, db));
  const agents = db.profiles
    .filter((p) => p.is_active && !p.is_deleted && allowedIds.has(p.id))
    .map((p) => ({ id: p.id, full_name: displayUserName(p), username: p.username }));
  const canReassign = canAssignLeads(user, db);
  // selling_price pre-fills a line's price, variants drive its variant select,
  // and pancake_variation_id decides whether it shows as a Quick add line.
  const activeProducts = db.products
    .filter((p) => p.status === "active")
    .map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      selling_price: p.selling_price,
      variants: p.variants,
      pancake_variation_id: p.pancake_variation_id,
    }));

  // Section 2: an agent who has not timed in cannot create an order. Shown up
  // front rather than only on submit, so the block is obvious before they type.
  const notTimedIn = timeInBlockReason(db, user);

  // Raising an order from a Regular Customer's record. The customer must be one
  // this user could own the order for, which is the same rule that decides who
  // a new order may be attributed to — an agent cannot reach another agent's
  // customer by guessing an id.
  let regularCustomer: RegularCustomerPrefill | null = null;
  if (customerId) {
    const found = await getCustomer(customerId);
    if (found && found.is_regular_customer && allowedIds.has(found.owner_agent_id)) {
      regularCustomer = {
        id: found.id,
        full_name: found.full_name,
        phone: found.phone_raw,
        purok: found.purok || "",
        landmark: found.landmark || "",
        address: {
          province_id: found.pancake_province_id || "",
          province: found.province || "",
          city_id: found.pancake_district_id || "",
          city: found.city || "",
          barangay_id: found.pancake_commune_id || "",
          barangay: found.barangay || "",
        },
      };
    }
  }

  // A repeat order from somebody who is NOT a regular customer: the details
  // are copied, nothing is tagged, and the new lead is an ordinary one.
  //
  // Scoped to orders this user could have owned, the same rule that decides who
  // a new order may be attributed to -- otherwise an id typed into the address
  // bar would read out another agent's customer's address.
  let repeatOrder: RepeatOrderPrefill | null = null;
  if (fromOrderId && !regularCustomer) {
    // Asked of the database, not of db.orders: readDbLite() leaves that array
    // empty, so looking there always answered "no such order" and quietly
    // produced the blank form this prefill exists to avoid.
    const source = await orderById(fromOrderId);
    if (source && allowedIds.has(source.agent_id) && source.customer_phone.trim()) {
      repeatOrder = {
        fromOrderId: source.id,
        fromOrderNumber: source.order_number,
        full_name: source.customer_name,
        phone: source.customer_phone,
        purok: source.purok || "",
        landmark: source.landmark || "",
        address: {
          province_id: source.pancake_province_id || "",
          province: source.province || "",
          city_id: source.pancake_district_id || "",
          city: source.city || "",
          barangay_id: source.pancake_commune_id || "",
          barangay: source.barangay || "",
        },
      };
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      {/* This page adds a LEAD. Adding a Regular Customer is a separate act
          with its own page at /regular-customers/new. */}
      <h1 className="mb-4 text-page-title text-slate-900">
        {regularCustomer
          ? "New Order — Regular Customer"
          : repeatOrder
            ? "New Order — Repeat Customer"
            : "New Lead"}
      </h1>

      {customerId && !regularCustomer && (
        <Alert kind="error" className="mb-4">
          That regular customer was not found, or is not one of yours.
        </Alert>
      )}

      {(notTimedIn || time_in_required) && (
        <Alert kind="warning" className="mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <span>{notTimedIn || error}</span>
            <LinkButton href={TIME_IN_HREF} variant="secondary" size="sm">
              Go to Time In
            </LinkButton>
          </div>
        </Alert>
      )}

      {/* A repeat order is taken on the phone like any other, so the call is
          started here rather than left unrecorded. Withheld while the agent is
          not timed in — the server refuses the call for the same reason it
          refuses the order, and a button that can only fail is not a control. */}
      {/* Same reason as the regular-customer panel below: the call is taken
          on the phone like any other, and an agent who arrived here mid-call
          would otherwise lose the timer and the only way to end it. */}
      {repeatOrder && !notTimedIn && (
        <RepeatOrderCallPanel
          orderId={repeatOrder.fromOrderId}
          fromOrderNumber={repeatOrder.fromOrderNumber}
          customerName={repeatOrder.full_name}
          phone={repeatOrder.phone}
          dialScheme={dialScheme}
        />
      )}

      {regularCustomer && !notTimedIn && (
        <RegularCustomerCallPanel
          customerId={regularCustomer.id}
          customerName={regularCustomer.full_name}
          phone={regularCustomer.phone}
          dialScheme={dialScheme}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>{regularCustomer || repeatOrder ? "Order details" : "Lead details"}</CardTitle>
        </CardHeader>
        <CardContent>
          {error && !time_in_required && (
            <Alert kind="error" className="mb-4">
              {error}
            </Alert>
          )}
          {notTimedIn ? (
            <p className="py-6 text-center text-sm text-slate-400">
              Time in for today to start creating orders.
            </p>
          ) : (
            <LeadForm
              action={createLeadAction}
              agents={agents}
              activeProducts={activeProducts}
              currentUser={{ id: user.id, full_name: user.full_name, username: user.username }}
              canReassign={canReassign}
              agentStatuses={creatableStatuses(isFullAccess(user.role))}
              regularCustomer={regularCustomer}
              repeatOrder={repeatOrder}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
