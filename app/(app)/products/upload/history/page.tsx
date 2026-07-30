import { getCurrentUser } from "@/lib/auth";
import { readDb } from "@/lib/db";
import { can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/utils";
import { displayUserName } from "@/lib/types";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { listProductUploads } from "@/lib/actions/product-upload";

export default async function ProductUploadHistoryPage() {
  const user = (await getCurrentUser())!;
  const db = await readDb();

  if (!can(user.role, "products", "view", db.role_permissions)) {
    return <Alert kind="error">You do not have permission to view product uploads.</Alert>;
  }

  const uploads = await listProductUploads();
  const nameById = new Map(db.profiles.map((p) => [p.id, displayUserName(p)]));

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-page-title text-slate-900">Product Upload History</h1>
          <p className="text-sm text-slate-500">Every product list upload, who ran it, and what it changed.</p>
        </div>
        <LinkButton href="/products/upload" variant="outline">
          New Upload
        </LinkButton>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">File</th>
              <th className="px-4 py-3">Uploaded By</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3 text-right">Rows</th>
              <th className="px-4 py-3 text-right">Imported</th>
              <th className="px-4 py-3 text-right">Updated</th>
              <th className="px-4 py-3 text-right">Skipped</th>
              <th className="px-4 py-3 text-right">Failed</th>
              <th className="px-4 py-3 text-right">Errors</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {uploads.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <span className="font-medium text-slate-800">{u.file_name}</span>
                  {u.update_existing && (
                    <Badge className="ml-2 bg-blue-100 text-blue-700">Update existing</Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {u.uploaded_by ? nameById.get(u.uploaded_by) || "Unknown User" : "—"}
                </td>
                <td className="px-4 py-3 text-slate-500">{formatDateTime(u.uploaded_at)}</td>
                <td className="px-4 py-3 text-right text-slate-500">{u.total_rows}</td>
                <td className="px-4 py-3 text-right text-green-700">{u.imported}</td>
                <td className="px-4 py-3 text-right text-blue-700">{u.updated}</td>
                <td className="px-4 py-3 text-right text-amber-700">{u.skipped}</td>
                <td className="px-4 py-3 text-right text-red-700">{u.failed}</td>
                <td className="px-4 py-3 text-right">
                  {u.errors && u.errors.length > 0 ? (
                    <a
                      href={`/api/products/uploads/${u.id}/errors`}
                      className="text-xs font-medium text-[var(--brand-primary)] hover:underline"
                    >
                      Download report
                    </a>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
              </tr>
            ))}
            {uploads.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                  No product uploads yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
