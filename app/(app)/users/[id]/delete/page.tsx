import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { readDb } from "@/lib/db";
import { isFullAccess } from "@/lib/permissions";
import { formatDateTime } from "@/lib/utils";
import { Alert } from "@/components/ui/Alert";
import { Button, LinkButton } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Label, Textarea } from "@/components/ui/Field";
import { permanentlyDeleteAccountAction } from "@/lib/actions/account-deletion";
import { countLinkedRecords, totalLinked, LINKED_RECORD_LABELS } from "@/lib/account-deletion";

export default async function DeleteAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDb();

  if (!isFullAccess(user.role)) {
    return <Alert kind="error">Administrator access is required to delete an account.</Alert>;
  }

  const target = db.profiles.find((p) => p.id === id);
  if (!target) notFound();
  if (target.is_deleted) {
    return <Alert kind="info">This account has already been deleted.</Alert>;
  }

  const counts = await countLinkedRecords(db, id);
  const linked = totalLinked(counts);
  const teamLead = target.team_lead_id ? db.profiles.find((p) => p.id === target.team_lead_id) : null;
  const roleName = db.roles.find((r) => r.key === target.role)?.name || target.role;
  const action = permanentlyDeleteAccountAction.bind(null, id);

  const isSelf = id === user.id;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-page-title text-slate-900">Permanently Delete Account</h1>
        <p className="text-sm text-slate-500">This is irreversible. Read every step before confirming.</p>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {isSelf && <Alert kind="error">You cannot delete your own account.</Alert>}

      {/* Step 1 — the account being deleted. */}
      <Card>
        <CardHeader>
          <CardTitle>1. Account details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Detail label="Full name" value={target.full_name} />
            <Detail label="Username" value={target.username} />
            <Detail label="Email" value={target.email} />
            <Detail label="Call name" value={target.call_name || "—"} />
            <Detail label="Role" value={roleName} />
            <Detail label="Team Lead" value={teamLead?.full_name || "—"} />
            <Detail label="Contact number" value={target.contact_number || "—"} />
            <Detail label="Status" value={target.is_active ? "Active" : "Inactive"} />
            <Detail label="Date created" value={formatDateTime(target.created_at)} />
            <Detail label="Last login" value={target.last_login_at ? formatDateTime(target.last_login_at) : "Never"} />
          </dl>
        </CardContent>
      </Card>

      {/* Step 2 — the warning, and what will actually happen to the data. */}
      <Card>
        <CardHeader>
          <CardTitle>2. What this does</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert kind="error">This cannot be undone. There is no recovery once confirmed.</Alert>
          {linked > 0 ? (
            <>
              <p className="text-sm text-slate-600">
                This account is referenced by {linked} record{linked === 1 ? "" : "s"}. Business transactions are never
                deleted, so the account will be <strong>anonymized</strong>: the profile is kept as a tombstone with its
                personal data cleared, and every historical record shows it as &ldquo;Deleted User&rdquo;.
              </p>
              <ul className="grid grid-cols-1 gap-1 text-sm text-slate-600 sm:grid-cols-2">
                {Object.entries(counts)
                  .filter(([, n]) => n > 0)
                  .map(([key, n]) => (
                    <li key={key} className="flex justify-between rounded border border-slate-100 px-2 py-1">
                      <span>{LINKED_RECORD_LABELS[key as keyof typeof LINKED_RECORD_LABELS] || key}</span>
                      <span className="font-medium text-slate-800">{n}</span>
                    </li>
                  ))}
              </ul>
              <Alert kind="warning">
                Consider deactivating this account instead — it preserves the login history and can be reversed.
              </Alert>
            </>
          ) : (
            <p className="text-sm text-slate-600">
              No records reference this account, so the profile row will be removed outright.
            </p>
          )}
        </CardContent>
      </Card>

      <form action={action}>
        <Card>
          <CardHeader>
            <CardTitle>3–6. Confirm</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {linked > 0 && (
              <div>
                <Label htmlFor="handling">Related-record handling</Label>
                <label className="flex items-start gap-2 rounded-md border border-slate-200 p-3 text-sm">
                  <input
                    id="handling"
                    type="radio"
                    name="handling"
                    value="anonymized"
                    className="mt-0.5 h-4 w-4"
                    required
                  />
                  <span>
                    Anonymize and keep records
                    <span className="block text-xs text-slate-400">
                      The only permitted option while linked records exist.
                    </span>
                  </span>
                </label>
              </div>
            )}

            <div>
              <Label htmlFor="confirm_text">Type DELETE to confirm</Label>
              <Input id="confirm_text" name="confirm_text" required autoComplete="off" placeholder="DELETE" />
            </div>

            <div>
              <Label htmlFor="admin_password">Your password</Label>
              <Input
                id="admin_password"
                name="admin_password"
                type="password"
                required
                autoComplete="current-password"
              />
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
              <span>
                I understand this is permanent and cannot be undone.
              </span>
            </label>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <LinkButton href="/users" variant="outline">
                Cancel
              </LinkButton>
              <Button type="submit" variant="danger" disabled={isSelf}>
                Permanently Delete Account
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
