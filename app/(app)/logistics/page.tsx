import Link from "next/link";
import { redirect } from "next/navigation";
import { readDbLite } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { PageHeader } from "@/components/ui/PageHeader";
import { listConnections, latestRunByConnection, connectionHealth } from "@/lib/logistics/store";
import { LogisticsHealthBadge, relativeTime } from "@/components/LogisticsHealth";

export const dynamic = "force-dynamic";

/**
 * The Logistics overview.
 *
 * For now it is the sync-health half of the dashboard the spec describes: the
 * On Delivery totals arrive with the synchronization engine. Health leads
 * rather than trails on purpose — SPEC §31: zero orders on delivery must never
 * be read as "nothing is out" when it may mean "the sync is broken", so the
 * state of every connection is established before any count is shown.
 */
export default async function LogisticsOverviewPage() {
  const user = (await getCurrentUser())!;
  const db = await readDbLite();

  if (!can(user.role, "logistics", "view", db.role_permissions)) redirect("/dashboard");
  const canManage = can(user.role, "logistics", "manage", db.role_permissions);

  const [connections, runs] = await Promise.all([listConnections(), latestRunByConnection()]);
  const enabled = connections.filter((c) => c.is_enabled);
  const healthy = enabled.filter((c) => connectionHealth(c, runs[c.id]) === "connected").length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Logistics"
        description="Every parcel on delivery, across every connected Pancake POS account."
        actions={
          canManage ? (
            <Link
              href="/logistics/connections"
              className="text-control font-medium text-[var(--brand-primary)] hover:underline"
            >
              Pancake Connections
            </Link>
          ) : undefined
        }
      />

      {connections.length === 0 ? (
        <Alert kind="info">
          No Pancake POS shops are connected yet, so there is nothing to consolidate.{" "}
          {canManage ? (
            <Link href="/logistics/connections" className="font-medium underline">
              Add a connection
            </Link>
          ) : (
            "Ask an administrator to add one."
          )}
        </Alert>
      ) : (
        <Alert kind="info">
          Order synchronization is not switched on yet, so no parcels are being counted. The connections below are ready
          for it.
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            Sync health{" "}
            <span className="ml-1 text-control font-normal text-slate-500">
              {healthy} of {enabled.length} enabled connection{enabled.length === 1 ? "" : "s"} healthy
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {connections.length === 0 ? (
            <p className="px-5 py-8 text-center text-control text-slate-500">Nothing to report yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-control">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Connection</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Last sync attempt</th>
                    <th className="px-4 py-2.5 font-medium">Last successful sync</th>
                    <th className="px-4 py-2.5 font-medium">Last error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {connections.map((c) => (
                    <tr key={c.id}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{c.connection_name}</div>
                        {c.account_label && <div className="text-xs text-slate-500">{c.account_label}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <LogisticsHealthBadge health={connectionHealth(c, runs[c.id])} />
                      </td>
                      <td className="px-4 py-3 text-slate-600">{relativeTime(c.last_sync_at)}</td>
                      <td className="px-4 py-3 text-slate-600">{relativeTime(c.last_successful_sync_at)}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {c.last_error_message ? (
                          <span className="block max-w-md truncate text-red-700" title={c.last_error_message}>
                            {c.last_error_message}
                          </span>
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
    </div>
  );
}
