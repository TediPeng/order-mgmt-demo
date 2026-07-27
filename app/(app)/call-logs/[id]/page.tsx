import { notFound, redirect } from "next/navigation";
import { Download, ArrowLeft } from "lucide-react";
import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/utils";
import { Input } from "@/components/ui/Field";
import { Button, LinkButton } from "@/components/ui/Button";

export default async function CallLogDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { id } = await params;
  const { q } = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDb();

  if (!can(user.role, "call_logs", "view", db.role_permissions)) {
    redirect("/call-logs");
  }

  const callLog = db.call_logs.find((c) => c.id === id);
  if (!callLog) notFound();

  const uploader = db.profiles.find((p) => p.id === callLog.uploaded_by);
  const byId = new Map(db.profiles.map((p) => [p.id, p.full_name]));
  let records = db.call_log_records.filter((r) => r.call_log_id === id);

  if (q) {
    const qq = q.toLowerCase();
    records = records.filter(
      (r) => r.caller_name.toLowerCase().includes(qq) || r.phone_number.toLowerCase().includes(qq)
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <LinkButton href="/call-logs" variant="ghost" size="sm" className="mb-2 -ml-2">
            <ArrowLeft className="h-4 w-4" /> Back to Call Logs
          </LinkButton>
          <h1 className="text-xl font-semibold text-slate-900">{callLog.file_name}</h1>
          <p className="text-sm text-slate-500">
            Uploaded by {uploader?.full_name || "—"} on {formatDateTime(callLog.uploaded_at)} · {callLog.record_count}{" "}
            records
          </p>
        </div>
        <a href={`/api/call-logs/${callLog.id}/download`}>
          <Button variant="outline">
            <Download className="h-4 w-4" /> Download original
          </Button>
        </a>
      </div>

      <form className="mb-4 flex max-w-sm gap-2">
        <Input name="q" placeholder="Search caller name or phone number" defaultValue={q} />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Caller Name</th>
              <th className="px-4 py-3">Phone Number</th>
              <th className="px-4 py-3">Call Date</th>
              <th className="px-4 py-3">Duration (s)</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Agent</th>
              <th className="px-4 py-3">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {records.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3">{r.caller_name || "—"}</td>
                <td className="px-4 py-3">{r.phone_number || "—"}</td>
                <td className="px-4 py-3">{r.call_date || "—"}</td>
                <td className="px-4 py-3">{r.duration_seconds}</td>
                <td className="px-4 py-3 capitalize">{r.call_type || "—"}</td>
                <td className="px-4 py-3">{r.agent_id ? byId.get(r.agent_id) || "—" : "—"}</td>
                <td className="px-4 py-3 text-slate-500">{r.notes || "—"}</td>
              </tr>
            ))}
            {records.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                  No records match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
