import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { readDbLite } from "@/lib/db";
import { queryAuditLog, auditFacets } from "@/lib/audit-log";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { formatDateTime } from "@/lib/utils";
import { Input, Select } from "@/components/ui/Field";
import { Button, LinkButton } from "@/components/ui/Button";

const PAGE_SIZE = 30;

function summarizeValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") {
    const json = JSON.stringify(v);
    return json.length > 120 ? json.slice(0, 120) + "…" : json;
  }
  return String(v);
}

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string; module?: string; action?: string; from?: string; to?: string; page?: string; entity_id?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDbLite();

  if (!can(user.role, "audit_logs", "view", db.role_permissions)) {
    redirect("/dashboard");
  }
  const canExport = can(user.role, "audit_logs", "export", db.role_permissions);

  // Filtered, sorted and paged by Postgres — only this page's 30 rows are
  // fetched, rather than the whole trail being pulled in and sliced.
  const page = Math.max(1, parseInt(sp.page || "1", 10) || 1);
  const filters = { user: sp.user, module: sp.module, action: sp.action, entity_id: sp.entity_id, from: sp.from, to: sp.to };
  const [{ entries: pageEntries, total }, { actions, modules }] = await Promise.all([
    queryAuditLog(filters, page, PAGE_SIZE),
    auditFacets(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const byId = new Map(db.profiles.map((p) => [p.id, p.full_name]));

  const qs = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { user: sp.user, module: sp.module, action: sp.action, from: sp.from, to: sp.to, ...overrides };
    Object.entries(merged).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    return `?${params.toString()}`;
  };
  const exportQs = new URLSearchParams();
  if (sp.user) exportQs.set("user", sp.user);
  if (sp.module) exportQs.set("module", sp.module);
  if (sp.action) exportQs.set("action", sp.action);
  if (sp.from) exportQs.set("from", sp.from);
  if (sp.to) exportQs.set("to", sp.to);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-page-title text-slate-900">Audit Logs</h1>
          {!isFullAccess(user.role) && <span className="text-xs text-slate-400">Read-only</span>}
        </div>
        {sp.entity_id && (
          <a href="/audit-logs" className="text-xs font-medium text-[var(--brand-primary)] hover:underline">
            Showing history for one record — clear filter
          </a>
        )}
        {canExport && (
          <a href={`/api/audit-logs/export?${exportQs.toString()}`}>
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          </a>
        )}
      </div>

      <form className="mb-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-6">
        <Select name="user" defaultValue={sp.user || ""}>
          <option value="">All users</option>
          {db.profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </Select>
        <Select name="module" defaultValue={sp.module || ""}>
          <option value="">All modules</option>
          {modules.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
        <Select name="action" defaultValue={sp.action || ""}>
          <option value="">All actions</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
        <Input type="date" name="from" defaultValue={sp.from} />
        <Input type="date" name="to" defaultValue={sp.to} />
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Module</th>
              <th className="px-4 py-3">Previous</th>
              <th className="px-4 py-3">Updated</th>
              <th className="px-4 py-3">IP</th>
              <th className="px-4 py-3">Device</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pageEntries.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatDateTime(e.created_at)}</td>
                <td className="px-4 py-3">{e.user_id ? byId.get(e.user_id) || "Unknown" : "System"}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{e.user_email || "—"}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                    {e.action}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500">{e.module || "—"}</td>
                <td className="max-w-[160px] truncate px-4 py-3 text-xs text-slate-400" title={JSON.stringify(e.previous_value)}>
                  {summarizeValue(e.previous_value)}
                </td>
                <td className="max-w-[160px] truncate px-4 py-3 text-xs text-slate-400" title={JSON.stringify(e.updated_value)}>
                  {summarizeValue(e.updated_value)}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">{e.ip_address || "—"}</td>
                <td className="max-w-[180px] truncate px-4 py-3 text-xs text-slate-400" title={e.device_info || ""}>
                  {e.device_info || "—"}
                </td>
              </tr>
            ))}
            {pageEntries.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                  No activity found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <span>
            Page {page} of {totalPages} ({total} entries)
          </span>
          <div className="flex gap-2">
            <LinkButton href={qs({ page: String(Math.max(1, page - 1)) })} variant="outline" size="sm">
              Previous
            </LinkButton>
            <LinkButton href={qs({ page: String(Math.min(totalPages, page + 1)) })} variant="outline" size="sm">
              Next
            </LinkButton>
          </div>
        </div>
      )}
    </div>
  );
}
