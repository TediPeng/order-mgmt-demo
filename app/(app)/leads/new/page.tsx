import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { LinkButton } from "@/components/ui/Button";
import { LeadForm } from "@/components/LeadForm";
import { createLeadAction } from "@/lib/actions/leads";
import { allowedAssigneeIds } from "@/lib/order-access";
import { getCurrentUser } from "@/lib/auth";
import { readDb } from "@/lib/db";
import { can, isFullAccess } from "@/lib/permissions";
import { displayUserName } from "@/lib/types";
import { creatableStatuses } from "@/lib/validation";
import { timeInBlockReason, TIME_IN_HREF } from "@/lib/time-in-gate";

export default async function NewLeadPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; time_in_required?: string }>;
}) {
  const { error, time_in_required } = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDb();

  if (!can(user.role, "orders", "create", db.role_permissions)) {
    return <Alert kind="error">You do not have permission to create leads.</Alert>;
  }

  const allowedIds = new Set(allowedAssigneeIds(user, db));
  const agents = db.profiles
    .filter((p) => p.is_active && !p.is_deleted && allowedIds.has(p.id))
    .map((p) => ({ id: p.id, full_name: displayUserName(p), username: p.username }));
  const canReassign = isFullAccess(user.role);
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

  return (
    <div className="mx-auto max-w-2xl">
      {/* This page adds a LEAD. Adding a Regular Customer is a separate act
          with its own page at /regular-customers/new. */}
      <h1 className="mb-4 text-page-title text-slate-900">New Lead</h1>

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

      <Card>
        <CardHeader>
          <CardTitle>Lead details</CardTitle>
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
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
