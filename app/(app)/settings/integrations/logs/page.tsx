import Link from "next/link";
import { redirect } from "next/navigation";
import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { formatDateTime } from "@/lib/utils";
import { listAccounts, listSyncLogs, type SyncLogFilters } from "@/lib/pancake/store";
import type { PancakeSyncSource } from "@/lib/types";

export const dynamic = "force-dynamic";

const SOURCES: PancakeSyncSource[] = ["webhook", "api_polling", "manual_sync", "internal_user", "auto_retry", "ready_to_ship_event"];

export default async function SyncLogsPage({
  searchParams,
}: {
  searchParams: Promise<{
    order?: string;
    account?: string;
    result?: string;
    source?: string;
    date_from?: string;
    date_to?: string;
  }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDb();

  if (!can(user.role, "integrations", "view", db.role_permissions)) redirect("/dashboard");

  const accounts = await listAccounts();
  const accountNameById = new Map(accounts.map((a) => [a.id, a.account_name]));
  const orderById = new Map(db.orders.map((o) => [o.id, o]));

  // "Order" filter accepts an order number; resolve it to the id the logs use.
  const filters: SyncLogFilters = {
    pancake_account_id: sp.account || undefined,
    result: sp.result === "success" || sp.result === "failed" ? sp.result : undefined,
    source: SOURCES.includes(sp.source as PancakeSyncSource) ? (sp.source as PancakeSyncSource) : undefined,
    date_from: sp.date_from || undefined,
    date_to: sp.date_to || undefined,
  };
  if (sp.order) {
    const match = db.orders.find(
      (o) => o.order_number.toLowerCase() === sp.order!.toLowerCase() || o.id === sp.order
    );
    filters.order_id = match?.id || "00000000-0000-0000-0000-000000000000"; // no match -> empty result set
  }
  const logs = await listSyncLogs(filters);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-page-title text-slate-900">Pancake Sync Logs</h1>
        <Link href="/settings/integrations" className="text-sm font-medium text-[var(--brand-primary)] hover:underline">
          ← Integration Settings
        </Link>
      </div>

      <form className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-6">
        <Input name="order" placeholder="Order Number" defaultValue={sp.order} />
        <Select name="account" defaultValue={sp.account || ""}>
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.account_name}
            </option>
          ))}
        </Select>
        <Select name="result" defaultValue={sp.result || ""}>
          <option value="">All results</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
        </Select>
        <Select name="source" defaultValue={sp.source || ""}>
          <option value="">All sources</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {s.replaceAll("_", " ")}
            </option>
          ))}
        </Select>
        <Input type="date" name="date_from" defaultValue={sp.date_from} />
        <div className="flex gap-2">
          <Input type="date" name="date_to" defaultValue={sp.date_to} />
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Status Change</th>
              <th className="px-4 py-3">HTTP</th>
              <th className="px-4 py-3">Result</th>
              <th className="px-4 py-3">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {logs.map((log) => {
              const order = log.order_id ? orderById.get(log.order_id) : null;
              return (
                <tr key={log.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(log.request_at)}</td>
                  <td className="px-4 py-3">
                    {order ? (
                      <Link href={`/leads?open=${encodeURIComponent(order.order_number)}`} className="font-medium text-[var(--brand-primary)] hover:underline">
                        {order.order_number}
                      </Link>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {log.pancake_account_id ? accountNameById.get(log.pancake_account_id) || "?" : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{log.action.replaceAll("_", " ")}</td>
                  <td className="px-4 py-3 text-slate-600">{log.source ? log.source.replaceAll("_", " ") : "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                    {log.old_status || log.new_status ? `${log.old_status || "—"} → ${log.new_status || "—"}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{log.http_status ?? "—"}</td>
                  <td className="px-4 py-3">
                    {log.result ? (
                      <span
                        className={
                          log.result === "success"
                            ? "inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700"
                            : "inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
                        }
                      >
                        {log.result}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="max-w-md px-4 py-3 text-xs text-slate-500">{log.error_message || "—"}</td>
                </tr>
              );
            })}
            {logs.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                  No sync log entries match the filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">Showing up to 200 most recent entries. Payload summaries are stored redacted — no tokens, keys, or secrets.</p>
    </div>
  );
}
