import Link from "next/link";
import { redirect } from "next/navigation";
import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Label, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmitButton";
import { listAccounts } from "@/lib/pancake/store";
import { maskStoredSecret } from "@/lib/pancake/crypto";
import { mockMode } from "@/lib/pancake/config";
import {
  createPancakeAccountAction,
  updatePancakeAccountAction,
  deletePancakeAccountAction,
  testPancakeConnectionAction,
} from "@/lib/actions/pancake";

export const dynamic = "force-dynamic";

export default async function IntegrationsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; tested?: string; note?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDb();

  if (!can(user.role, "integrations", "view", db.role_permissions)) redirect("/dashboard");
  const canManage = can(user.role, "integrations", "manage", db.role_permissions);

  const accounts = await listAccounts();
  const hasActiveDefault = accounts.some((a) => a.is_active && a.is_default);
  const encryptionConfigured = Boolean(process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length >= 16);
  // Shown verbatim so it can be pasted straight into Pancake's Webhook URL field.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const webhookUrl = `${appUrl || "https://<your-domain>"}/api/webhooks/pancake`;

  const agents = db.profiles.filter((p) => p.is_active);
  const teamLeads = db.profiles.filter((p) => p.is_active && p.role === "team_lead");
  const nameById = new Map(db.profiles.map((p) => [p.id, p.full_name]));

  const accountFields = (defaults?: (typeof accounts)[number]) => (
    <>
      <div>
        <Label>Account name</Label>
        <Input name="account_name" defaultValue={defaults?.account_name} required={!defaults} />
      </div>
      <div>
        <Label>Shop / Page ID</Label>
        <Input name="shop_or_page_id" defaultValue={defaults?.shop_or_page_id} required={!defaults} />
      </div>
      <div className="sm:col-span-2">
        <Label>API endpoint</Label>
        <Input
          name="api_endpoint"
          placeholder="https://pos.pages.fm/api/v1"
          defaultValue={defaults?.api_endpoint || "https://pos.pages.fm/api/v1"}
          required={!defaults}
        />
      </div>
      <div>
        <Label>API key {defaults ? `(stored: ${maskStoredSecret(defaults.api_key_encrypted) || "—"} — leave blank to keep)` : ""}</Label>
        <Input name="api_key" type="password" autoComplete="off" placeholder={defaults ? "Re-enter to change" : ""} required={!defaults} />
      </div>
      <div>
        <Label>
          Webhook secret {defaults ? `(stored: ${maskStoredSecret(defaults.webhook_secret_encrypted) || "not set"} — leave blank to keep)` : "(optional)"}
        </Label>
        <Input name="webhook_secret" type="password" autoComplete="off" placeholder={defaults ? "Re-enter to change" : ""} />
      </div>
      <div>
        <Label>Assigned agent (routing priority 1)</Label>
        <Select name="assigned_agent_id" defaultValue={defaults?.assigned_agent_id || ""}>
          <option value="">— none —</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.full_name} ({a.username})
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label>Assigned team lead (priority 2)</Label>
        <Select name="assigned_team_lead_id" defaultValue={defaults?.assigned_team_lead_id || ""}>
          <option value="">— none —</option>
          {teamLeads.map((a) => (
            <option key={a.id} value={a.id}>
              {a.full_name} ({a.username})
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label>Order source tag (priority 3)</Label>
        <Input name="assigned_order_source" defaultValue={defaults?.assigned_order_source || ""} placeholder="e.g. facebook-page-a" />
      </div>
      <div className="flex items-end gap-4 pb-2">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="is_default" defaultChecked={defaults?.is_default} className="h-4 w-4 rounded border-slate-300" />
          Default account (fallback)
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="is_active" defaultChecked={defaults ? defaults.is_active : true} className="h-4 w-4 rounded border-slate-300" />
          Active
        </label>
      </div>
    </>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Pancake POS Integration</h1>
        <div className="flex gap-3 text-sm">
          <Link href="/settings/integrations/status-map" className="font-medium text-[var(--brand-primary)] hover:underline">
            Status Map
          </Link>
          <Link href="/settings/integrations/logs" className="font-medium text-[var(--brand-primary)] hover:underline">
            Sync Logs
          </Link>
        </div>
      </div>

      {sp.saved && <Alert kind="success">Saved.{sp.note === "deactivated" ? " (Account was in use, so it was deactivated instead of deleted.)" : ""}</Alert>}
      {sp.error && <Alert kind="error">{sp.error}</Alert>}
      {sp.tested && <Alert kind="success">{sp.tested}</Alert>}

      {mockMode() !== "off" && (
        <Alert kind="info">
          MOCK_MODE is on (<code>PANCAKE_MOCK_MODE={mockMode()}</code>) — all Pancake API calls are simulated
          {mockMode() === "fail" ? " as failures (for testing the retry flow)" : " as successes"}.
        </Alert>
      )}
      {!encryptionConfigured && (
        <Alert kind="error">
          The <code>ENCRYPTION_KEY</code> environment variable is not set — accounts cannot be saved until it is configured
          (used to encrypt API keys and webhook secrets at rest).
        </Alert>
      )}
      {!hasActiveDefault && accounts.length > 0 && (
        <Alert kind="error">
          No active <strong>default</strong> account is set. Orders that don&apos;t match an agent/team/order-source
          assignment will land in Needs Review until one is marked as default.
        </Alert>
      )}

      {accounts.map((account) => (
        <Card key={account.id}>
          <CardHeader className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              {account.account_name}
              {account.is_default && <Badge className="bg-green-100 text-green-700">Default</Badge>}
              {!account.is_active && <Badge className="bg-slate-200 text-slate-600">Inactive</Badge>}
            </CardTitle>
            {canManage && (
              <div className="flex gap-2">
                <form action={testPancakeConnectionAction.bind(null, account.id)}>
                  <Button type="submit" variant="outline" size="sm">
                    Test Connection
                  </Button>
                </form>
                <form action={deletePancakeAccountAction.bind(null, account.id)}>
                  <ConfirmSubmitButton
                    className="inline-flex items-center justify-center gap-1.5 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
                    confirmMessage={`Delete Pancake account "${account.account_name}"?`}
                  >
                    Delete
                  </ConfirmSubmitButton>
                </form>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {canManage ? (
              <form action={updatePancakeAccountAction.bind(null, account.id)} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {accountFields(account)}
                <div className="sm:col-span-2">
                  <Button type="submit">Save Changes</Button>
                </div>
              </form>
            ) : (
              <div className="grid grid-cols-2 gap-3 text-sm text-slate-700">
                <p>Shop/Page: {account.shop_or_page_id}</p>
                <p>Endpoint: {account.api_endpoint}</p>
                <p>API key: {maskStoredSecret(account.api_key_encrypted) || "—"}</p>
                <p>Agent: {account.assigned_agent_id ? nameById.get(account.assigned_agent_id) || "?" : "—"}</p>
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Add Pancake POS Account</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createPancakeAccountAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {accountFields()}
              <div className="sm:col-span-2">
                <Button type="submit">Add Account</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2 text-xs text-slate-400">
        <p>
          Order routing: assigned Agent → agent&apos;s Team Lead → lead&apos;s Order Source tag → the Default account.
          Credentials are encrypted at rest (AES-256-GCM with <code>ENCRYPTION_KEY</code>), shown masked, and never sent to
          the browser or written to logs.
        </p>
        <p>
          <strong>Pancake setup</strong> — everything lives on one screen in Pancake:{" "}
          <em>Setting → Advance → Third-party connection → Webhook/API</em>. In the <code>API KEY</code> box click{" "}
          <code>Create</code> and paste the key above.
        </p>
        <p>
          <strong>Real-time updates (optional):</strong> put any random string in Webhook secret above, then on that same
          Pancake screen set <strong>Webhook URL</strong> to <code>{webhookUrl}</code>, tick the{" "}
          <strong>orders</strong> webhook type, add a <strong>Request Header</strong> of{" "}
          <code>X-API-KEY</code> = your webhook secret, and enable the webhook. Leave the Webhook secret blank and
          statuses are polled automatically instead — same result, just not instant.
        </p>
      </div>
    </div>
  );
}
