import Link from "next/link";
import { redirect } from "next/navigation";
import { readDbLite } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { PageHeader } from "@/components/ui/PageHeader";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmitButton";
import { maskStoredSecret } from "@/lib/pancake/crypto";
import { DEFAULT_API_BASE_URL } from "@/lib/pancake/config";
import { logisticsMockMode } from "@/lib/logistics/config";
import { listConnections, latestRunByConnection, connectionHealth } from "@/lib/logistics/store";
import { LogisticsHealthBadge, relativeTime } from "@/components/LogisticsHealth";
import {
  createLogisticsConnectionAction,
  updateLogisticsConnectionAction,
  setLogisticsConnectionEnabledAction,
  archiveLogisticsConnectionAction,
  testLogisticsConnectionAction,
} from "@/lib/actions/logistics";
import type { LogisticsConnection } from "@/lib/types";

export const dynamic = "force-dynamic";
// A connection test waits on Pancake, which can sit for the full request
// timeout before answering.
export const maxDuration = 60;

export default async function LogisticsConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string;
    error?: string;
    tested?: string;
    note?: string;
    orders?: string;
    edit?: string;
  }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDbLite();

  if (!can(user.role, "logistics", "view", db.role_permissions)) redirect("/dashboard");
  const canManage = can(user.role, "logistics", "manage", db.role_permissions);

  const [connections, runs] = await Promise.all([listConnections(), latestRunByConnection()]);
  const editing = sp.edit ? connections.find((c) => c.id === sp.edit) : undefined;
  const encryptionConfigured = Boolean(process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length >= 16);

  const fields = (defaults?: LogisticsConnection) => (
    <>
      <div>
        <Label>Connection name</Label>
        <Input name="connection_name" defaultValue={defaults?.connection_name || ""} placeholder="e.g. Miracle Herbs POS" required />
      </div>
      <div>
        <Label>Pancake POS Shop ID</Label>
        <Input name="shop_id" defaultValue={defaults?.shop_id || ""} placeholder="e.g. 4821" required />
        <p className="mt-1 text-xs text-slate-400">
          The number in the Pancake POS URL. Not a Facebook page ID — that is the usual cause of a &ldquo;shop not
          found&rdquo; test failure.
        </p>
      </div>
      <div>
        <Label>Page / brand label (optional)</Label>
        <Input name="account_label" defaultValue={defaults?.account_label || ""} placeholder="e.g. Miracle Herbs PH" />
      </div>
      <div>
        <Label>API endpoint</Label>
        <Input name="api_endpoint" defaultValue={defaults?.api_endpoint || DEFAULT_API_BASE_URL} />
      </div>
      <div>
        <Label>
          API key {defaults ? `(stored: ${maskStoredSecret(defaults.api_key_encrypted) || "not set"} — leave blank to keep)` : ""}
        </Label>
        <Input
          name="api_key"
          type="password"
          autoComplete="off"
          placeholder={defaults ? "Re-enter to change" : "Paste the shop's API key"}
          required={!defaults}
        />
        <p className="mt-1 text-xs text-slate-400">
          Created inside that shop at Setting → Advance → Third-party connection → Webhook/API. Encrypted the moment it
          is saved; it is never sent back to a browser.
        </p>
      </div>
      <div>
        <Label>
          Webhook secret{" "}
          {defaults ? `(stored: ${maskStoredSecret(defaults.webhook_secret_encrypted) || "not set"} — leave blank to keep)` : "(optional)"}
        </Label>
        <Input name="webhook_secret" type="password" autoComplete="off" placeholder={defaults ? "Re-enter to change" : ""} />
      </div>
      <div>
        <Label>First sync reaches back (days)</Label>
        <Input name="initial_sync_days" type="number" min={1} max={365} defaultValue={defaults?.initial_sync_days ?? 30} />
        <p className="mt-1 text-xs text-slate-400">
          The first sync imports only orders in a logistics status inside this window. Delivered and cancelled history
          is left in Pancake.
        </p>
      </div>
      <div className="flex items-end pb-2">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="is_enabled"
            defaultChecked={defaults ? defaults.is_enabled : true}
            className="h-4 w-4 rounded border-slate-300"
          />
          Enabled (include in every sync)
        </label>
      </div>
    </>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Pancake Connections"
        description="The Pancake POS shops this module reads from. Logistics never writes to Pancake."
        actions={
          <Link href="/logistics" className="text-control font-medium text-[var(--brand-primary)] hover:underline">
            Logistics overview
          </Link>
        }
      />

      {sp.saved && (
        <Alert kind="success">
          Saved.
          {sp.note === "archived"
            ? ` The connection was archived; ${Number(sp.orders || 0).toLocaleString()} synced orders were kept.`
            : ""}
        </Alert>
      )}
      {sp.tested && <Alert kind="success">{sp.tested}</Alert>}
      {sp.error && <Alert kind="error">{sp.error}</Alert>}

      {!encryptionConfigured && (
        <Alert kind="error">
          ENCRYPTION_KEY is not set, so API keys cannot be stored encrypted. Set it before adding a connection.
        </Alert>
      )}

      {logisticsMockMode() !== "off" && (
        <Alert kind="warning">
          LOGISTICS_MOCK_MODE is {logisticsMockMode()}. Connection tests are simulated — nothing here proves a real
          credential works.
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Connections</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {connections.length === 0 ? (
            <p className="px-5 py-8 text-center text-control text-slate-500">
              No Pancake shops are connected yet. Add one below to start consolidating its parcels.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-control">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Connection</th>
                    <th className="px-4 py-2.5 font-medium">Shop</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Last sync</th>
                    <th className="px-4 py-2.5 font-medium">Last success</th>
                    <th className="px-4 py-2.5 font-medium">Last error</th>
                    <th className="px-4 py-2.5 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {connections.map((c) => (
                    <tr key={c.id} className="align-top">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{c.connection_name}</div>
                        {c.account_label && <div className="text-xs text-slate-500">{c.account_label}</div>}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-600">{c.shop_id}</td>
                      <td className="px-4 py-3">
                        <LogisticsHealthBadge health={connectionHealth(c, runs[c.id])} />
                      </td>
                      <td className="px-4 py-3 text-slate-600">{relativeTime(c.last_sync_at)}</td>
                      <td className="px-4 py-3 text-slate-600">{relativeTime(c.last_successful_sync_at)}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {c.last_error_message ? (
                          <span className="block max-w-xs truncate text-red-700" title={c.last_error_message}>
                            {c.last_error_message}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {canManage ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <form action={testLogisticsConnectionAction.bind(null, c.id)}>
                              <Button type="submit" variant="outline" size="sm">
                                Test
                              </Button>
                            </form>
                            <form action={setLogisticsConnectionEnabledAction.bind(null, c.id, !c.is_enabled)}>
                              <Button type="submit" variant="outline" size="sm">
                                {c.is_enabled ? "Disable" : "Enable"}
                              </Button>
                            </form>
                            <Link
                              href={`/logistics/connections?edit=${c.id}`}
                              className="text-control font-medium text-[var(--brand-primary)] hover:underline"
                            >
                              Edit
                            </Link>
                            <form action={archiveLogisticsConnectionAction.bind(null, c.id)}>
                              <ConfirmSubmitButton
                                confirmTitle="Archive this connection?"
                                confirmMessage={`${c.connection_name} will stop syncing and disappear from this module. Every order and status history it has already produced is kept.`}
                                confirmLabel="Archive"
                              >
                                Archive
                              </ConfirmSubmitButton>
                            </form>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>{editing ? `Edit ${editing.connection_name}` : "Add a connection"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              action={editing ? updateLogisticsConnectionAction.bind(null, editing.id) : createLogisticsConnectionAction}
              className="grid gap-4 sm:grid-cols-2"
            >
              {fields(editing)}
              <div className="flex items-center gap-3 sm:col-span-2">
                <Button type="submit">{editing ? "Save changes" : "Add connection"}</Button>
                {editing && (
                  <Link href="/logistics/connections" className="text-control text-slate-500 hover:underline">
                    Cancel
                  </Link>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
