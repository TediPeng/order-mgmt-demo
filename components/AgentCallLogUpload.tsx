"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Download, ImagePlus, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Field";
import { importAgentCallLogAction, uploadCallLogImageAction, type AgentUploadSummary, type RawCallRow } from "@/lib/actions/agent-call-logs";

const HEADERS = ["CALL NAME", "PHONE NUMBER", "CALL DATE"];

function findHeaderIndex(row: unknown[], name: string): number {
  return row.findIndex((c) => String(c ?? "").trim().toUpperCase() === name);
}

/** Agent call-log upload. Only the four controls the spec allows: choose a
 * file, upload it, download the template, and attach a screenshot. The agent
 * is never asked who the calls belong to — the server attributes every row to
 * them, so the question would be meaningless and the answer untrusted. */
export function AgentCallLogUpload({ imageError, imageUploaded }: { imageError?: string; imageUploaded?: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<AgentUploadSummary | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleUpload() {
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array", cellDates: true, raw: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, raw: true });
      if (grid.length === 0) {
        setError("That file is empty.");
        return;
      }

      const headerRow = grid[0];
      const idx = HEADERS.map((h) => findHeaderIndex(headerRow, h));
      const missing = HEADERS.filter((_, i) => idx[i] === -1);
      if (missing.length > 0) {
        setError(`The file is missing required column(s): ${missing.join(", ")}. Download the template to see the expected format.`);
        return;
      }

      const rows: RawCallRow[] = [];
      for (let i = 1; i < grid.length; i++) {
        const r = grid[i] || [];
        const cell = (n: number) => {
          const v = r[idx[n]];
          return v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").trim();
        };
        if (!cell(0) && !cell(1) && !cell(2)) continue; // skip blank lines
        rows.push({ row: i + 1, call_name: cell(0), phone: cell(1), call_date: cell(2) });
      }
      if (rows.length === 0) {
        setError("That file has no data rows.");
        return;
      }

      const result = await importAgentCallLogAction(rows, file.name);
      setSummary(result);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setError(`Could not read that file: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function downloadErrorReport() {
    if (!summary) return;
    const rows = [["Row", "Reason", "Value"], ...summary.errors.map((e) => [String(e.row), e.reason, e.value])];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "call-log-errors.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Upload Call Log</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && <Alert kind="error">{error}</Alert>}

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
            />
            <Button type="button" onClick={handleUpload} disabled={busy || !file}>
              <Upload className="h-4 w-4" /> {busy ? "Uploading…" : "Upload"}
            </Button>
            <a href="/api/agent-call-logs/template">
              <Button type="button" variant="outline">
                <Download className="h-4 w-4" /> Download Template
              </Button>
            </a>
          </div>
          <p className="text-xs text-slate-400">Columns: {HEADERS.join(" | ")}. Every row is recorded against your account.</p>

          {summary && (
            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {[
                  ["Total rows", summary.total],
                  ["Imported", summary.imported],
                  ["Duplicates", summary.duplicates],
                  ["Invalid", summary.invalid],
                  ["Failed", summary.failed],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <p className="text-xs uppercase text-slate-400">{label}</p>
                    <p className="text-lg font-semibold text-slate-900">{value}</p>
                  </div>
                ))}
              </div>
              {summary.dateOrderAssumed && (
                <Alert kind="info">
                  Dates in this file were read as{" "}
                  <strong>{summary.dateOrder === "dmy" ? "DD/MM/YYYY" : "MM/DD/YYYY"}</strong>. No row could settle it
                  either way, so the more common format was assumed — check a few dates landed on the right day.
                </Alert>
              )}
              {summary.errors.length > 0 && (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-500">{summary.errors.length} row(s) were rejected and not counted.</p>
                  <Button type="button" size="sm" variant="outline" onClick={downloadErrorReport}>
                    <Download className="h-4 w-4" /> Error report
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Upload Call Log Image</CardTitle>
        </CardHeader>
        <CardContent>
          {imageError && <Alert kind="error" className="mb-3">{imageError}</Alert>}
          {imageUploaded && <Alert kind="success" className="mb-3">Image uploaded.</Alert>}
          <form action={uploadCallLogImageAction} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="image">Screenshot (JPG, PNG or WEBP, max 10 MB)</Label>
                <input
                  id="image"
                  name="image"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  required
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    setPreview(f ? URL.createObjectURL(f) : null);
                  }}
                  className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                />
              </div>
              <div>
                <Label htmlFor="related_call_date">Related call date</Label>
                <Input id="related_call_date" name="related_call_date" type="date" />
              </div>
            </div>
            {preview && (
              // Preview before committing, so the wrong screenshot is caught
              // here rather than after it is stored.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Selected screenshot preview" className="max-h-56 rounded-lg border border-slate-200" />
            )}
            <Button type="submit">
              <ImagePlus className="h-4 w-4" /> Upload Image
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
