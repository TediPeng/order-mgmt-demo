"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDownUp, Download, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmitButton";
import { formatDate, formatDateTime } from "@/lib/utils";
import { deleteCallLogUploadAction } from "@/lib/actions/agent-call-logs";

interface RecordRow {
  id: string;
  call_name: string | null;
  phone_raw: string | null;
  phone_normalized: string | null;
  call_date: string;
}

interface UploadInfo {
  id: string;
  file_name: string;
  uploaded_at: string;
  imported_rows: number | null;
  total_rows: number | null;
  duplicate_rows: number | null;
  rejected_rows: number;
  has_original_file: boolean;
  agent_name: string;
  agent_call_name: string | null;
}

const PAGE_SIZE = 50;

/** Read-only preview of an upload's stored rows.
 *
 * Shows the records the system actually kept — the same ones the imported
 * count is derived from — so the table can never disagree with the figure it
 * sits under. Rows the file contained but the importer rejected were never
 * stored and so cannot appear here; the header states how many there were and
 * points at the original file, rather than pretending the preview is the file.
 *
 * Searching, sorting and paging are all done by the server, so a large upload
 * never arrives whole just to render one page of it. */
export function CallLogPreviewModal({
  uploadId,
  canDelete,
  onClose,
}: {
  uploadId: string;
  canDelete: boolean;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [upload, setUpload] = useState<UploadInfo | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sort });
      if (query) params.set("q", query);
      const res = await fetch(`/api/agent-call-logs/${uploadId}/records?${params}`);
      const json = await res.json();
      if (!json.ok) {
        setError(json.error || "Unable to preview this file.");
        setRows([]);
        return;
      }
      setRows(json.rows);
      setTotal(json.total);
      setUpload(json.upload);
    } catch {
      setError("Unable to preview this file. Please download the original file or upload a valid Excel or CSV file.");
    } finally {
      setLoading(false);
    }
  }, [uploadId, page, sort, query]);

  useEffect(() => {
    load();
  }, [load]);

  // Escape closes, matching every other dialog in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setQuery(search.trim());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Call log file preview"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-section-title text-slate-900">{upload?.file_name || "Loading…"}</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {upload ? (
                <>
                  {upload.agent_call_name ? `${upload.agent_call_name} · ` : ""}
                  {upload.agent_name} · {formatDateTime(upload.uploaded_at)}
                </>
              ) : (
                " "
              )}
            </p>
            {upload && (
              <p className="mt-1 text-xs text-slate-500">
                <strong className="text-slate-700">{upload.imported_rows ?? 0}</strong> call records recorded
                {upload.duplicate_rows ? ` · ${upload.duplicate_rows} duplicate` : ""}
                {upload.rejected_rows ? ` · ${upload.rejected_rows} rejected at import` : ""}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
          <form onSubmit={submitSearch} className="flex items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search Call Name or phone number"
              className="w-64"
            />
            <Button type="submit" size="sm" variant="secondary">
              <Search className="h-4 w-4" /> Search
            </Button>
          </form>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>
              {total} record{total === 1 ? "" : "s"}
              {query ? " matching" : ""}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setPage(1);
                setSort((s) => (s === "asc" ? "desc" : "asc"));
              }}
            >
              <ArrowDownUp className="h-4 w-4" /> Call date {sort === "asc" ? "oldest first" : "newest first"}
            </Button>
          </div>
        </div>

        <div className="min-h-[200px] flex-1 overflow-auto px-5 py-3">
          {error && <Alert kind="error">{error}</Alert>}

          {loading && (
            <div className="space-y-2" aria-live="polite" aria-busy="true">
              <span className="sr-only">Loading records…</span>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton h-9 w-full" />
              ))}
            </div>
          )}

          {!loading && !error && (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[640px] text-left text-table">
                <thead className="sticky top-0 bg-slate-50 text-table font-medium uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Agent Name</th>
                    <th className="px-3 py-2">Call Name</th>
                    <th className="px-3 py-2">Phone Number</th>
                    <th className="px-3 py-2">Call Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => {
                    // A stored row can still be incomplete: only phone and date
                    // are required at import, so a blank Call Name is worth
                    // flagging without being an error.
                    const incomplete = !r.call_name?.trim();
                    return (
                      <tr key={r.id} className={incomplete ? "bg-amber-50" : "odd:bg-slate-50/40"}>
                        <td className="px-3 py-2 text-slate-700">{upload?.agent_name || "—"}</td>
                        <td className="px-3 py-2 text-slate-700">
                          {r.call_name?.trim() || <span className="text-amber-700">No Call Name</span>}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{r.phone_raw || r.phone_normalized || "—"}</td>
                        <td className="px-3 py-2 text-slate-600">{formatDate(r.call_date)}</td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-10 text-center text-slate-400">
                        {query ? "No records match that search." : "This upload recorded no rows."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-5 py-3">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <span>
              Page {page} of {totalPages}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {upload?.has_original_file ? (
              <a href={`/api/agent-call-logs/${uploadId}/file`}>
                <Button type="button" size="sm" variant="outline">
                  <Download className="h-4 w-4" /> Download original
                </Button>
              </a>
            ) : (
              <span className="text-xs text-slate-400">Original file not kept for this upload</span>
            )}
            {canDelete && (
              <form action={deleteCallLogUploadAction.bind(null, uploadId)}>
                <ConfirmSubmitButton confirmMessage="Delete this upload and every call record it created? This cannot be undone.">
                  <Trash2 className="h-4 w-4" /> Delete upload
                </ConfirmSubmitButton>
              </form>
            )}
            <Button type="button" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
