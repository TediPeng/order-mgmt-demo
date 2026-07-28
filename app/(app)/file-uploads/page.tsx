import Link from "next/link";
import { redirect } from "next/navigation";
import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export default async function FileUploadsPage() {
  const user = (await getCurrentUser())!;
  const db = await readDb();

  if (!can(user.role, "file_uploads", "view", db.role_permissions)) redirect("/dashboard");

  const byId = new Map(db.profiles.map((p) => [p.id, p.full_name]));

  const callLogEvents = db.call_logs.map((c) => ({
    id: c.id,
    type: "Call Log" as const,
    file_name: c.file_name,
    uploaded_by: c.uploaded_by,
    uploaded_at: c.uploaded_at,
    count: c.record_count,
    href: `/call-logs/${c.id}`,
  }));

  const importEvents = db.activity_log
    .filter((e) => e.action === "LEADS_IMPORTED")
    .map((e) => ({
      id: e.id,
      type: "Lead Import" as const,
      file_name: (e.details?.file_name as string) || "leads.xlsx",
      uploaded_by: e.user_id,
      uploaded_at: e.created_at,
      count: (e.details?.imported as number) ?? 0,
      href: "/leads",
    }));

  const all = [...callLogEvents, ...importEvents].sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));

  return (
    <div>
      <h1 className="mb-4 text-page-title text-slate-900">File Uploads</h1>
      <Card>
        <CardHeader>
          <CardTitle>All uploads across the system</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">File Name</th>
                <th className="px-4 py-3">Uploaded By</th>
                <th className="px-4 py-3">Uploaded At</th>
                <th className="px-4 py-3">Records</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {all.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-3">
                    <Badge className={e.type === "Call Log" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"}>
                      {e.type}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={e.href} className="font-medium text-[var(--brand-primary)] hover:underline">
                      {e.file_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{e.uploaded_by ? byId.get(e.uploaded_by) || "—" : "—"}</td>
                  <td className="px-4 py-3 text-slate-500">{formatDateTime(e.uploaded_at)}</td>
                  <td className="px-4 py-3">{e.count}</td>
                </tr>
              ))}
              {all.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                    No files uploaded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
