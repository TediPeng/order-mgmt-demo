import Link from "next/link";
import { redirect } from "next/navigation";
import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { listOpenDuplicates } from "@/lib/customers";
import { formatDateTime } from "@/lib/utils";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { reviewDuplicateAction } from "@/lib/actions/regular-customers";

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
  const db = await readDb();

  const allowed =
    (isFullAccess(user.role) || user.role === "team_lead") &&
    can(user.role, "regular_customers", "view", db.role_permissions);
  if (!allowed) redirect("/forbidden?from=regular-customers-duplicates");

  const canDecide = isFullAccess(user.role) || can(user.role, "regular_customers", "manage", db.role_permissions);
  const matches = await listOpenDuplicates();
  const nameById = new Map(db.profiles.map((p) => [p.id, p.full_name]));

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
