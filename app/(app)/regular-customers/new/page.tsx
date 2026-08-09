import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { RegularCustomerForm } from "@/components/RegularCustomerForm";
import { createRegularCustomerAction } from "@/lib/actions/regular-customers";
import { allowedAssigneeIds } from "@/lib/order-access";
import { getCurrentUser } from "@/lib/auth";
import { readDb } from "@/lib/db";
import { can, isFullAccess } from "@/lib/permissions";
import { displayUserName } from "@/lib/types";

/**
 * Add Regular Customer — NOT the lead form.
 *
 * Nothing here creates an order, so nothing here reaches the Leads list. It is
 * gated on regular_customers.create, a grant of its own: an agent may keep
 * their own regulars without that implying anything about creating leads, and
 * the reverse holds too.
 *
 * Deliberately no time-in gate, unlike /leads/new: that rule exists because a
 * lead is call-floor work being credited to a shift. Recording who a repeat
 * customer is, is not.
 */
export default async function NewRegularCustomerPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDb();

  if (!can(user.role, "regular_customers", "create", db.role_permissions)) {
    return <Alert kind="error">You do not have permission to add regular customers.</Alert>;
  }

  // Same assignment rule as Leads: an agent can only own their own.
  const allowedIds = new Set(allowedAssigneeIds(user, db));
  const agents = db.profiles
    .filter((p) => p.is_active && !p.is_deleted && allowedIds.has(p.id))
    .map((p) => ({ id: p.id, full_name: displayUserName(p), username: p.username }));
  const canReassign = isFullAccess(user.role) || user.role === "team_lead";

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-page-title text-slate-900">Add Regular Customer</h1>

      <Card>
        <CardHeader>
          <CardTitle>Customer details</CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert kind="error" className="mb-4">
              {error}
            </Alert>
          )}
          <RegularCustomerForm
            action={createRegularCustomerAction}
            agents={agents}
            currentUser={{ id: user.id, full_name: user.full_name, username: user.username }}
            canReassign={canReassign && agents.length > 1}
          />
        </CardContent>
      </Card>
    </div>
  );
}
