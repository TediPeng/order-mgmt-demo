import Link from "next/link";
import { redirect } from "next/navigation";
import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { StatusBadge } from "@/components/ui/Badge";
import { listStatusMap } from "@/lib/pancake/store";
import { PANCAKE_STATUS_HINTS } from "@/lib/pancake/config";
import { saveStatusMapEntryAction, deleteStatusMapEntryAction } from "@/lib/actions/pancake";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmitButton";
import { LEAD_STATUSES, LEAD_STATUS_LABELS } from "@/lib/validation";
import type { OrderStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function StatusMapPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDb();

  if (!can(user.role, "integrations", "view", db.role_permissions)) redirect("/dashboard");
  const canManage = can(user.role, "integrations", "manage", db.role_permissions);

  const entries = await listStatusMap();
  const hasPlaceholders = entries.some((e) => e.pancake_status.startsWith("TODO_"));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Pancake Status Map</h1>
        <Link href="/settings/integrations" className="text-sm font-medium text-[var(--brand-primary)] hover:underline">
          ← Integration Settings
        </Link>
      </div>

      {sp.saved && <Alert kind="success">Saved.</Alert>}
      {sp.error && <Alert kind="error">{sp.error}</Alert>}
      {hasPlaceholders ? (
        <Alert kind="info">
          Entries prefixed <code>TODO_</code> are placeholders — replace them with the exact status codes from the
          official Pancake POS API documentation. Incoming statuses that are not mapped here never change a lead; they
          are logged as Needs Review instead.
        </Alert>
      ) : (
        <Alert kind="info">
          Pancake POS sends statuses as <strong>integer codes</strong> (e.g. <code>2</code> = Shipped, <code>3</code> =
          Received). The seeded mapping follows the official API spec — adjust it freely; incoming codes that are not
          mapped never change a lead and are logged as Needs Review instead.
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Mappings (Pancake status code → internal lead status)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {entries.map((entry) => (
            <div key={entry.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 p-3">
              {canManage ? (
                <>
                  <form action={saveStatusMapEntryAction} className="flex flex-1 flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={entry.id} />
                    <Input name="pancake_status" defaultValue={entry.pancake_status} className="w-24" />
                    {PANCAKE_STATUS_HINTS[entry.pancake_status] && (
                      <span className="w-40 text-xs text-slate-500">“{PANCAKE_STATUS_HINTS[entry.pancake_status]}”</span>
                    )}
                    <span className="text-slate-400">→</span>
                    <Select name="internal_status" defaultValue={entry.internal_status} className="w-44">
                      {LEAD_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {LEAD_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </Select>
                    <label className="flex items-center gap-1.5 text-sm text-slate-600">
                      <input type="checkbox" name="is_active" defaultChecked={entry.is_active} className="h-4 w-4 rounded border-slate-300" />
                      Active
                    </label>
                    <Button type="submit" variant="secondary" size="sm">
                      Save
                    </Button>
                  </form>
                  <form action={deleteStatusMapEntryAction.bind(null, entry.id)}>
                    <ConfirmSubmitButton
                      className="rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                      confirmMessage={`Delete the mapping for "${entry.pancake_status}"?`}
                    >
                      Delete
                    </ConfirmSubmitButton>
                  </form>
                </>
              ) : (
                <div className="flex items-center gap-3 text-sm">
                  <code className="rounded bg-slate-100 px-2 py-0.5">{entry.pancake_status}</code>
                  <span className="text-slate-400">→</span>
                  <StatusBadge status={entry.internal_status as OrderStatus} />
                  {!entry.is_active && <span className="text-xs text-slate-400">(inactive)</span>}
                </div>
              )}
            </div>
          ))}
          {entries.length === 0 && <p className="py-4 text-center text-sm text-slate-400">No mappings yet.</p>}
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Add mapping</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={saveStatusMapEntryAction} className="flex flex-wrap items-center gap-2">
              <Input name="pancake_status" placeholder="Pancake status code" className="w-52" required />
              <span className="text-slate-400">→</span>
              <Select name="internal_status" defaultValue="confirmed" className="w-44">
                {LEAD_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {LEAD_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-1.5 text-sm text-slate-600">
                <input type="checkbox" name="is_active" defaultChecked className="h-4 w-4 rounded border-slate-300" />
                Active
              </label>
              <Button type="submit">Add</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
