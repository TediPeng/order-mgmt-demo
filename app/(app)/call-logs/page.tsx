import Link from "next/link";
import { Download, Upload } from "lucide-react";
import { readDb } from "@/lib/db";
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

export default async function CallLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; uploaded?: string; deleted?: string; q?: string; from?: string; to?: string; image_uploaded?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDb();
  const isAgent = user.role === "agent";
  const canView = can(user.role, "call_logs", "view", db.role_permissions);
  const canUpload = can(user.role, "call_logs", "upload", db.role_permissions);
  const canDelete = can(user.role, "call_logs", "delete", db.role_permissions);
  const agents = db.profiles.filter((p) => p.is_active);

  let logs = [...db.call_logs].sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
  const byId = new Map(db.profiles.map((p) => [p.id, p.full_name]));

  if (sp.q) {
    const q = sp.q.toLowerCase();
    logs = logs.filter(
      (l) => l.file_name.toLowerCase().includes(q) || (byId.get(l.uploaded_by) || "").toLowerCase().includes(q)
    );
  }
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
  const agentUploads = await listAgentCallLogUploads(reviewAgentIds);
  const callLogImages = await listCallLogImages(reviewAgentIds);
  const agentById = Object.fromEntries(
    db.profiles.map((p) => [p.id, { name: p.full_name, avatar_url: p.avatar_url }])
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
            <a href="/api/call-logs/template" className="text-xs font-medium text-[var(--brand-primary)] hover:underline">
              Download template
            </a>
          </CardHeader>
          <CardContent>
            <form action={uploadCallLogAction} className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[220px]">
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Fallback agent (rows with no Agent Name column)
                  </label>
                  <Select name="fallback_agent_id" defaultValue="" className="text-sm">
                    <option value="">— None —</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.full_name}
                      </option>
                    ))}
                  </Select>
                </div>
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
              Accepts .xlsx or .csv, max 10 MB. Columns: Caller Name, Phone Number, Call Date, Duration (seconds),
              Call Type, Notes, Agent Name. If Agent Name is blank for a row, the fallback agent above is used.
            </p>
          </CardContent>
        </Card>
      )}

      {canView ? (
        <>
          <form className="mb-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <Input name="q" placeholder="Search file name / uploader" defaultValue={sp.q} />
            </div>
            <Input type="date" name="from" defaultValue={sp.from} />
            <div className="flex gap-2">
              <Input type="date" name="to" defaultValue={sp.to} />
              <Button type="submit" variant="secondary">
                Filter
              </Button>
            </div>
          </form>

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
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
      <AgentCallLogReview uploads={agentUploads} images={callLogImages} agentById={agentById} />
    </div>
  );
}
