import { getCurrentUser } from "@/lib/auth";
import { isFullAccess } from "@/lib/permissions";
import { listAccounts } from "@/lib/pancake/store";
import { buildMappingReport, refreshPancakeLookupsAction } from "@/lib/actions/pancake-mappings";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, LinkButton } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";

export default async function PancakeMappingsPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; error?: string; refreshed?: string; sources?: string; staff?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  if (!isFullAccess(user.role)) {
    return <Alert kind="error">Administrator access is required to view Pancake mappings.</Alert>;
  }

  const accounts = (await listAccounts()).filter((a) => a.is_active);
  const report = await buildMappingReport(sp.account);
  const unmatched = report.rows.filter((r) => !r.matchedOrderSource || !r.matchedStaff);

  const boundRefresh = async () => {
    "use server";
    if (report.account) await refreshPancakeLookupsAction(report.account.id);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-page-title text-slate-900">Pancake Order Source &amp; Staff Mapping</h1>
          <p className="text-sm text-slate-500">
            Pancake accepts an ID from its own lists for these two fields, never free text. An unmatched row here is what
            blocks that agent&apos;s next order from forwarding.
          </p>
        </div>
        <div className="flex gap-2">
          <LinkButton href="/settings/integrations" variant="outline">
            Back to Integrations
          </LinkButton>
          {report.account && (
            <form action={boundRefresh}>
              <Button type="submit" variant="secondary">
                Refresh from Pancake
              </Button>
            </form>
          )}
        </div>
      </div>

      {sp.error && <Alert kind="error">{sp.error}</Alert>}
      {sp.refreshed && (
        <Alert kind="success">
          Refreshed — {sp.sources} Order Source(s) and {sp.staff} staff member(s) read from Pancake POS.
        </Alert>
      )}
      {report.orderSourceError && <Alert kind="error">Order Sources: {report.orderSourceError}</Alert>}
      {report.staffError && <Alert kind="error">Staff list: {report.staffError}</Alert>}

      {accounts.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {accounts.map((a) => (
            <LinkButton
              key={a.id}
              href={`/settings/integrations/mappings?account=${a.id}`}
              variant={report.account?.id === a.id ? "secondary" : "outline"}
              size="sm"
            >
              {a.account_name}
            </LinkButton>
          ))}
        </div>
      )}

      {unmatched.length > 0 && (
        <Alert kind="warning">
          {unmatched.length} account{unmatched.length === 1 ? "" : "s"} will fail to forward. Either create the matching
          Order Source / staff member in Pancake POS, or change the Call Name / email in 4S ROMA so they agree.
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            Agents {report.account ? `— ${report.account.account_name}` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Agent</th>
                  <th className="px-4 py-3">Call Name</th>
                  <th className="px-4 py-3">Pancake Order Source</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Pancake Staff</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.rows.map((r) => (
                  <tr key={r.agentId} className={!r.matchedOrderSource || !r.matchedStaff ? "bg-amber-50/40" : undefined}>
                    <td className="px-4 py-3 font-medium text-slate-800">{r.fullName}</td>
                    <td className="px-4 py-3 text-slate-500">{r.callName || <em className="text-amber-700">not set</em>}</td>
                    <td className="px-4 py-3">
                      {r.matchedOrderSource ? (
                        <Badge className="bg-green-100 text-green-700">{r.matchedOrderSource.name}</Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-700">No match</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{r.email}</td>
                    <td className="px-4 py-3">
                      {r.matchedStaff ? (
                        <Badge className="bg-green-100 text-green-700">{r.matchedStaff.name || r.matchedStaff.email}</Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-700">No match</Badge>
                      )}
                    </td>
                  </tr>
                ))}
                {report.rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                      No agent accounts to map.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Pancake Order Sources ({report.orderSources.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm text-slate-600">
              {report.orderSources.map((s) => (
                <li key={s.id} className="flex justify-between gap-3 rounded border border-slate-100 px-2 py-1">
                  <span>{s.name}</span>
                  <code className="text-xs text-slate-400">{s.id}</code>
                </li>
              ))}
              {report.orderSources.length === 0 && <li className="text-slate-400">None returned.</li>}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pancake Staff ({report.staff.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm text-slate-600">
              {report.staff.map((s) => (
                <li key={s.id} className="flex justify-between gap-3 rounded border border-slate-100 px-2 py-1">
                  <span>{s.name || "(unnamed)"}</span>
                  <span className="text-xs text-slate-400">{s.email || "no email"}</span>
                </li>
              ))}
              {report.staff.length === 0 && <li className="text-slate-400">None returned.</li>}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
