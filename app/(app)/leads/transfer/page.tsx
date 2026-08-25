import { redirect } from "next/navigation";
import { readDbLite } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { canAssignLeads } from "@/lib/order-access";
import { displayCallName, displayUserName } from "@/lib/types";
import { PRE_SALE_STATUSES } from "@/lib/validation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { LinkButton } from "@/components/ui/Button";
import { LeadTransferClient } from "@/components/LeadTransferClient";

export const maxDuration = 300;

/**
 * Handing a caller's queue to somebody else.
 *
 * Reassigning one lead has always been possible from its own edit form, and
 * always full-access only. What was missing was doing it at the scale it
 * actually happens: an agent resigns, goes on leave, or is carrying four
 * thousand leads while somebody else has none. Doing that one popup at a time
 * is not a workflow, so it was not being done.
 */
export default async function TransferLeadsPage() {
  const user = (await getCurrentUser())!;
  const db = await readDbLite();

  if (!can(user.role, "orders", "view", db.role_permissions)) redirect("/dashboard");
  if (!canAssignLeads(user, db)) {
    return (
      <Alert kind="error">
        You do not have permission to transfer leads. It is the <strong>Assign</strong> grant on Leads, in Roles &amp;
        Permissions.
      </Alert>
    );
  }

  // Callers, not everyone with a login: a lead sitting on an Administrator's
  // name is a lead nobody is ringing.
  const agents = db.profiles
    .filter((p) => p.role === "agent" && p.is_active && !p.is_deleted && !p.is_test_account)
    .sort((a, b) => displayUserName(a).localeCompare(displayUserName(b)))
    .map((p) => ({
      id: p.id,
      name: displayUserName(p),
      callName: displayCallName(p) === displayUserName(p) ? null : displayCallName(p),
    }));

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-page-title text-slate-900">Transfer Leads</h1>
        <LinkButton href="/leads" variant="outline" size="sm">
          ← Back to Leads
        </LinkButton>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Move a queue to another caller</CardTitle>
        </CardHeader>
        <CardContent>
          {agents.length < 2 ? (
            <Alert kind="warning">There need to be at least two active agent accounts to transfer between.</Alert>
          ) : (
            <LeadTransferClient
              agents={agents}
              statuses={[...PRE_SALE_STATUSES]}
              // The queue people mean when they say "transfer their leads":
              // never called, and mid-conversation. Cancel and Reject Offer are
              // deliberately not ticked — they are closed, and moving them
              // makes the new agent's backlog look bigger than their work.
              defaultStatuses={["new", "ringing", "cbr", "call_back"]}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
