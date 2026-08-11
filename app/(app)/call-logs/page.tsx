import Link from "next/link";
import { Download, Upload } from "lucide-react";
import { readDbLite } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { uploadCallLogAction, deleteCallLogAction } from "@/lib/actions/call-logs";
import { AgentCallLogUpload } from "@/components/AgentCallLogUpload";
import { AgentCallLogReview } from "@/components/AgentCallLogReview";
import { listAgentCallLogUploads, listCallLogImages } from "@/lib/agent-call-logs";
import { isFullAccess } from "@/lib/permissions";

/** Applies the agent filter on top of the viewer's own scope.
 *
 * The filter may only ever narrow. An undefined scope means Management, who
 * has no limit, so the choice stands alone; otherwise the chosen agent must
 * already be inside the viewer's scope, and a choice outside it yields nothing
 * rather than quietly ignoring the filter and showing more than was asked for. */
function narrowToAgent(scope: string[] | undefined, agentId: string): string[] | undefined {
  if (!agentId) return scope;
  if (!scope) return [agentId];
  return scope.includes(agentId) ? [agentId] : [];
}

export default async function CallLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; uploaded?: string; deleted?: string; q?: string; from?: string; to?: string; image_uploaded?: string; agent?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDbLite();
  const isAgent = user.role === "agent";
  const canView = can(user.role, "call_logs", "view", db.role_permissions);
  const canUpload = can(user.role, "call_logs", "upload", db.role_permissions);
  const canDelete = can(user.role, "call_logs", "delete", db.role_permissions);
  /** Agents as this screen labels them: Call Name is what appears in a call-log
   * file, so it is what someone scanning uploads is looking for. Anyone without
   * one still appears under their full name rather than dropping off the list. */
  const agentOptions = db.profiles
    .filter((p) => p.is_active && p.role === "agent")
    .map((p) => ({ id: p.id, label: p.call_name?.trim() || `${p.full_name} (no Call Name)` }))
    .sort((a, b) => a.label.localeCompare(b.label));

  let logs = [...db.call_logs].sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
  const byId = new Map(db.profiles.map((p) => [p.id, p.full_name]));

  if (sp.q) {
    const q = sp.q.toLowerCase();
    logs = logs.filter(
      (l) => l.file_name.toLowerCase().includes(q)
    );
  }
  if (sp.agent) logs = logs.filter((l) => l.uploaded_by === sp.agent);
  if (sp.from) logs = logs.filter((l) => l.uploaded_at.slice(0, 10) >= sp.from!);
  if (sp.to) logs = logs.filter((l) => l.uploaded_at.slice(0, 10) <= sp.to!);

  // Agents get only the four controls the spec allows; the richer
  // Management view (filters, per-file listing, deletes) stays for everyone else.
  if (isAgent) {
    return (
      <div>
        <h1 className="mb-4 text-page-title text-slate-900">Call Logs</h1>
        <AgentCallLogUpload imageError={sp.error} imageUploaded={Boolean(sp.image_uploaded)} />
      </div>
    );
  }

  // What agents uploaded. Scoped the same way leads are: a team lead sees their
  // team, Management sees everyone.
  const reviewAgentIds = isFullAccess(user.role)
    ? undefined
    : [user.id, ...db.profiles.filter((p) => p.team_lead_id === user.id).map((p) => p.id)];
  const selectedAgent = sp.agent || "";
  const reviewIds = narrowToAgent(reviewAgentIds, selectedAgent);
  const agentUploads = await listAgentCallLogUploads(reviewIds);
  const callLogImages = await listCallLogImages(reviewIds);
  const agentById = Object.fromEntries(
    db.profiles.map((p) => [p.id, { name: p.full_name, call_name: p.call_name, avatar_url: p.avatar_url }])
  );

  return (
    <div>
      <h1 className="mb-4 text-page-title text-slate-900">Call Logs</h1>

      {sp.error && (
        <Alert kind="error" className="mb-4">
          {sp.error}
        </Alert>
      )}
      {sp.uploaded && (
        <Alert kind="success" className="mb-4">
          Call log uploaded successfully.
        </Alert>
      )}
      {sp.deleted && (
        <Alert kind="success" className="mb-4">
          Call log deleted.
        </Alert>
      )}

      {canUpload && (
        <Card className="mb-6">
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Upload a call log file</CardTitle>
            {/* Named so the one already in someone's Downloads folder is not
                mistaken for this one. */}
            <a href="/api/call-logs/template" className="text-xs font-medium text-[var(--brand-primary)] hover:underline">
              Download template (Call Date + Phone Number)
            </a>
          </CardHeader>
          <CardContent>
            <form action={uploadCallLogAction} className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <input
                  type="file"
                  name="file"
                  accept=".xlsx,.csv"
                  required
                  className="block flex-1 text-sm text-slate-600 file:mr-4 file:rounded-md file:border-0 file:bg-[var(--brand-primary)] file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:opacity-90"
                />
                <Button type="submit">
                  <Upload className="h-4 w-4" /> Upload
                </Button>
              </div>
            </form>
            <p className="mt-2 text-xs text-slate-400">
              Accepts .xlsx or .csv, max 10 MB. Two columns only:{" "}
              <span className="font-medium text-slate-500">Call Date</span> and{" "}
              <span className="font-medium text-slate-500">Phone Number</span>. Every row is filed under{" "}
              <span className="font-medium text-slate-500">your</span> account — upload your own file rather than
              somebody else&apos;s. Files in the older layout are refused, so download the template above and use that.
            </p>
          </CardContent>
        </Card>
      )}

      {canView ? (
        <>
          <form className="mb-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-4">
            <Input name="q" placeholder="Search file name" defaultValue={sp.q} />
            <Select name="agent" defaultValue={sp.agent || ""}>
              <option value="">All agents</option>
              {agentOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </Select>
            <Input type="date" name="from" defaultValue={sp.from} />
            <div className="flex gap-2">
              <Input type="date" name="to" defaultValue={sp.to} />
              <Button type="submit" variant="secondary">
                Filter
              </Button>
            </div>
          </form>

          <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="sticky top-0 z-20 bg-slate-50 shadow-sm text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">File Name</th>
                  <th className="px-4 py-3">Uploaded By</th>
                  <th className="px-4 py-3">Uploaded At</th>
                  <th className="px-4 py-3">Records</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((l) => {
                  const boundDelete = async () => {
                    "use server";
                    await deleteCallLogAction(l.id);
                  };
                  return (
                    <tr key={l.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link href={`/call-logs/${l.id}`} className="font-medium text-[var(--brand-primary)] hover:underline">
                          {l.file_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{byId.get(l.uploaded_by) || "—"}</td>
                      <td className="px-4 py-3 text-slate-500">{formatDateTime(l.uploaded_at)}</td>
                      <td className="px-4 py-3">{l.record_count}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <a
                            href={`/api/call-logs/${l.id}/download`}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <Download className="h-3.5 w-3.5" /> Download
                          </a>
                          {canDelete && (
                            <ConfirmButton
                              action={boundDelete}
                              label="Delete"
                              size="sm"
                              confirmTitle="Delete this call log?"
                              confirmBody={`This permanently removes "${l.file_name}" and its ${l.record_count} parsed records.`}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                      No call log files uploaded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <Alert kind="info">You don&apos;t have permission to view uploaded call logs.</Alert>
      )}
      <AgentCallLogReview uploads={agentUploads} images={callLogImages} agentById={agentById} canDelete={isFullAccess(user.role)} />
    </div>
  );
}
