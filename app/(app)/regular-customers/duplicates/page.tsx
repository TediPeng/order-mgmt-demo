import Link from "next/link";
import { Trash2, Undo2 } from "lucide-react";
import { redirect } from "next/navigation";
import { readDbLite } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { listOpenDuplicates, scanDuplicateCustomers, sharesForCustomers } from "@/lib/customers";
import { formatDateTime } from "@/lib/utils";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { reviewDuplicateAction, untagRegularCustomerAction } from "@/lib/actions/regular-customers";

const MATCH_LABELS: Record<string, string> = {
  phone: "Same phone number",
  name_address: "Same name and address",
  name_barangay_city: "Same name, barangay and city",
  other: "Close match",
};

const CONFIDENCE_STYLES: Record<string, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-slate-200 text-slate-600",
};

/** Management review queue for possible duplicate customers.
 *
 * Deliberately unreachable for Agents — not merely hidden. The whole point of
 * cross-agent detection is that it spans records an agent may not see, so
 * showing them a match would leak exactly what their own scoping prevents. */
export default async function DuplicatesPage({
  searchParams,
}: {
  searchParams: Promise<{ reviewed?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDbLite();

  const allowed =
    (isFullAccess(user.role) || user.role === "team_lead") &&
    can(user.role, "regular_customers", "view", db.role_permissions);
  if (!allowed) redirect("/forbidden?from=regular-customers-duplicates");

  const canDecide = isFullAccess(user.role) || can(user.role, "regular_customers", "manage", db.role_permissions);
  const [matches, scanned] = await Promise.all([listOpenDuplicates(), scanDuplicateCustomers()]);
  const nameById = new Map(db.profiles.map((p) => [p.id, p.full_name]));

  /**
   * Who each of these records is shared with.
   *
   * A shared customer is not a duplicate: the owner handed it over on purpose,
   * and the second agent works it with permission. This page could not tell the
   * two apart — it showed a name, a number and an agent, which is exactly what
   * a genuine duplicate looks like too — so the deliberate arrangement and the
   * accident were being reviewed as if they were the same thing.
   *
   * Asked once for every record on the page rather than per card.
   */
  const sharedWith = await sharesForCustomers([
    ...scanned.flatMap((g) => g.customers.map((c) => c.id)),
    ...matches.flatMap((m) => [m.customer?.id, m.matched?.id].filter(Boolean) as string[]),
  ]);
  const shareNote = (id: string | undefined) => {
    const targets = id ? sharedWith.get(id) : undefined;
    if (!targets || targets.length === 0) return null;
    return targets.map((t) => nameById.get(t) || "another agent").join(", ");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-page-title text-slate-900">Possible Duplicate Customers</h1>
        <Link href="/regular-customers" className="text-sm font-medium text-[var(--brand-primary)] hover:underline">
          ← Regular Customers
        </Link>
      </div>

      {sp.reviewed && <Alert kind="success">Decision recorded.</Alert>}
      {sp.error && <Alert kind="error">{sp.error}</Alert>}

      <Alert kind="info">
        Nothing is ever merged automatically. These are findings for you to judge — confirming a duplicate records the
        decision and the reasoning trail; it does not combine the records.
      </Alert>

      {/* Standing scan. The queue below it is what detection recorded when each
          customer was created; this is what is true right now, so a record
          edited into a collision afterwards still turns up. */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-section-title text-slate-900">Detected now</h2>
          <p className="text-xs text-slate-400">
            Every regular customer sharing a number, or a name and address, with another — checked as this page loaded.
          </p>
        </div>

        {scanned.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-slate-400">
              No regular customer shares a number or an address with another.
            </CardContent>
          </Card>
        ) : (
          scanned.map((group) => (
            <Card key={`${group.match_type}:${group.group_key}`}>
              <CardHeader className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>
                  {group.match_type === "phone" ? "Same phone number" : "Same name and address"}
                </CardTitle>
                <Badge className="bg-amber-100 text-amber-800">{group.group_size} customers</Badge>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2">
                  {group.customers.map((c) => (
                    <div key={c.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                      <Link
                        href={`/regular-customers/${c.id}`}
                        className="font-medium text-[var(--brand-primary)] hover:underline"
                      >
                        {c.full_name}
                      </Link>
                      <p className="text-slate-600">{c.phone_raw || "—"}</p>
                      <p className="text-slate-500">{c.address || "—"}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        Agent: {nameById.get(c.owner_agent_id) || "—"} · {c.total_orders} order
                        {c.total_orders === 1 ? "" : "s"} · since{" "}
                        {c.regular_since ? formatDateTime(c.regular_since) : "—"}
                      </p>
                      {shareNote(c.id) && (
                        <p className="mt-1.5 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-800">
                          Shared with {shareNote(c.id)} — deliberate, not a duplicate.
                        </p>
                      )}
                      {/* This page is where a duplicate is looked at side by
                          side, so it is where the decision to remove one gets
                          made. The link goes to the same confirmation page as
                          the customer's own record — nothing is deleted from
                          here, and the orders behind whichever copy goes are
                          released rather than destroyed, which is the part
                          worth reading before choosing a side.

                          Administrator only, matching the button on the
                          customer page: deciding a duplicate is a Team Lead
                          action, deleting a record is not. */}
                      {/* Two ways to settle a duplicate, and the gentler one
                          comes first because it is nearly always the right one.
                          Returning the record to Leads takes the claim off this
                          agent without destroying anything: the customer, their
                          calls and any share survive, and the number is free
                          for whoever should have it. Deleting cascades the call
                          sessions away, which is rarely what a duplicate
                          deserves. */}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {canDecide && (
                          <form action={untagRegularCustomerAction.bind(null, c.id)}>
                            <button
                              type="submit"
                              className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              title={`Takes ${c.full_name} off this agent and back into Leads. Nothing is deleted.`}
                            >
                              <Undo2 className="h-3 w-3" aria-hidden /> Remove from this agent
                            </button>
                          </form>
                        )}
                        {isFullAccess(user.role) && (
                          <Link
                            href={`/regular-customers/${c.id}/delete`}
                            className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-3 w-3" aria-hidden /> Delete this one
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </section>

      <div className="flex flex-wrap items-baseline justify-between gap-2 pt-2">
        <h2 className="text-section-title text-slate-900">Recorded for review</h2>
        <p className="text-xs text-slate-400">Found when a customer was created or tagged, and still undecided.</p>
      </div>

      {matches.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-400">No open duplicate matches.</CardContent>
        </Card>
      )}

      {matches.map((m) => (
        <Card key={m.id}>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{MATCH_LABELS[m.match_type || "other"] || "Close match"}</CardTitle>
            <Badge className={CONFIDENCE_STYLES[m.confidence || "low"]}>{m.confidence} confidence</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {[m.customer, m.matched].map((c, i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <p className="font-medium text-slate-800">{c?.full_name || "(record removed)"}</p>
                  <p className="text-slate-600">{c?.phone_raw || "—"}</p>
                  <p className="text-slate-500">
                    {[c?.purok, c?.barangay, c?.city, c?.province].filter(Boolean).join(", ") || "—"}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Agent: {c?.owner_agent_id ? nameById.get(c.owner_agent_id) || "—" : "—"}
                  </p>
                  {shareNote(c?.id) && (
                    <p className="mt-1.5 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-800">
                      Shared with {shareNote(c?.id)} — deliberate, not a duplicate.
                    </p>
                  )}
                  {/* Same offer on this half of the page. `c` can be null here —
                      a recorded match outlives the record it names — and there
                      is nothing to delete when it is. */}
                  {c && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {canDecide && (
                        <form action={untagRegularCustomerAction.bind(null, c.id)}>
                          <button
                            type="submit"
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            title={`Takes ${c.full_name} off this agent and back into Leads. Nothing is deleted.`}
                          >
                            <Undo2 className="h-3 w-3" aria-hidden /> Remove from this agent
                          </button>
                        </form>
                      )}
                      {isFullAccess(user.role) && (
                        <Link
                          href={`/regular-customers/${c.id}/delete`}
                          className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden /> Delete this one
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400">Detected {formatDateTime(m.created_at)}</p>

            {canDecide && (
              <div className="flex flex-wrap gap-2">
                <form action={reviewDuplicateAction.bind(null, m.id, "confirmed_duplicate")}>
                  <Button type="submit" size="sm" variant="secondary">
                    Confirm duplicate
                  </Button>
                </form>
                <form action={reviewDuplicateAction.bind(null, m.id, "not_duplicate")}>
                  <Button type="submit" size="sm" variant="outline">
                    Not a duplicate
                  </Button>
                </form>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
