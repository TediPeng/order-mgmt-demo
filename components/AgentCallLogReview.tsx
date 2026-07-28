"use client";

import { useState } from "react";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CallLogPreviewModal } from "@/components/CallLogPreviewModal";
import { CallLogImageModal } from "@/components/CallLogImageModal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { formatDateTime, formatDate } from "@/lib/utils";
import type { AgentCallLogUpload, CallLogImage } from "@/lib/agent-call-logs";

interface AgentInfo {
  name: string;
  /** The label a call-log file carries; shown beside the name so the row reads
   * the way the filter above it is phrased. */
  call_name: string | null;
  avatar_url: string | null;
}

function bytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Management/Team Lead view of what agents uploaded.
 *
 * Separate from the older Management call-log import above it: these are the
 * agents' own compliance uploads, and the counts shown are the ones the
 * importer recorded, so a file that half-failed is visible as such rather than
 * looking like a clean upload. */
export function AgentCallLogReview({
  uploads,
  images,
  agentById,
  canDelete = false,
}: {
  uploads: AgentCallLogUpload[];
  images: CallLogImage[];
  agentById: Record<string, AgentInfo>;
  /** Deleting an upload removes its call records too, so Management only. */
  canDelete?: boolean;
}) {
  const [previewUploadId, setPreviewUploadId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<CallLogImage | null>(null);

  const label = (id: string) => {
    const a = agentById[id];
    return a?.call_name || a?.name || "Unknown";
  };

  return (
    <div className="mt-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Agent call-log uploads</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-table">
              <thead className="bg-slate-50 text-table font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Agent</th>
                  <th className="px-4 py-3">File</th>
                  <th className="px-4 py-3">Uploaded</th>
                  <th className="px-4 py-3 num">Rows</th>
                  <th className="px-4 py-3 num">Imported</th>
                  <th className="px-4 py-3 num">Duplicates</th>
                  <th className="px-4 py-3 num">Rejected</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {uploads.map((u) => {
                  const agent = agentById[u.agent_id];
                  const rejected = (u.invalid_rows ?? 0) + (u.failed_rows ?? 0);
                  return (
                    <tr key={u.id} className="odd:bg-slate-50/40 hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2">
                          <Avatar name={agent?.name || "—"} src={agent?.avatar_url} size="sm" />
                          <span className="text-slate-700">
                            {agent?.call_name || agent?.name || "Unknown"}
                            {agent?.call_name && <span className="ml-1 text-slate-400">· {agent.name}</span>}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{u.file_name}</td>
                      <td className="px-4 py-3 text-slate-600">{formatDateTime(u.uploaded_at)}</td>
                      <td className="px-4 py-3 num text-slate-600">{u.total_rows ?? "—"}</td>
                      <td className="px-4 py-3 num font-medium text-slate-800">{u.imported_rows ?? "—"}</td>
                      <td className="px-4 py-3 num text-slate-600">{u.duplicate_rows ?? "—"}</td>
                      <td className={`px-4 py-3 num ${rejected > 0 ? "font-medium text-red-700" : "text-slate-600"}`}>
                        {rejected}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button type="button" size="sm" variant="outline" onClick={() => setPreviewUploadId(u.id)}>
                          <Eye className="h-4 w-4" /> View file
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {uploads.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                      No agent has uploaded a call log yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Call-log screenshots</CardTitle>
        </CardHeader>
        <CardContent>
          {images.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">No screenshots uploaded yet.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {images.map((img) => {
                const agent = agentById[img.agent_id];
                return (
                  <li key={img.id} className="overflow-hidden rounded-lg border border-slate-200">
                    <button type="button" onClick={() => setPreviewImage(img)} className="block w-full text-left">
                      {/* Served through an access-checked route, not a public URL. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/call-log-images/${img.id}`}
                        alt={`Call log screenshot uploaded by ${agent?.name || "an agent"}`}
                        className="h-40 w-full bg-slate-50 object-cover"
                      />
                    </button>
                    <div className="space-y-1 px-3 py-2 text-xs">
                      <p className="flex items-center gap-2 text-slate-700">
                        <Avatar name={agent?.name || "—"} src={agent?.avatar_url} size="sm" />
                        {agent?.call_name || agent?.name || "Unknown"}
                      </p>
                      <p className="truncate text-slate-500" title={img.original_filename}>
                        {img.original_filename}
                      </p>
                      <p className="text-slate-400">
                        {img.related_call_date ? `Calls of ${formatDate(img.related_call_date)}` : "No call date given"} ·{" "}
                        {bytes(img.file_size_bytes)}
                      </p>
                      <p className="text-slate-400">Uploaded {formatDateTime(img.uploaded_at)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {previewUploadId && (
        <CallLogPreviewModal uploadId={previewUploadId} canDelete={canDelete} onClose={() => setPreviewUploadId(null)} />
      )}
      {previewImage && (
        <CallLogImageModal
          image={previewImage}
          agentLabel={label(previewImage.agent_id)}
          onClose={() => setPreviewImage(null)}
        />
      )}
    </div>
  );
}
