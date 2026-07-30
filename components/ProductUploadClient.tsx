"use client";

import { useState } from "react";
import { UploadCloud } from "lucide-react";
import { Button, LinkButton } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PRODUCT_STATUS_LABELS } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { previewProductUploadAction, commitProductUploadAction, type PreviewState } from "@/lib/actions/product-upload";

const OUTCOME_BADGE: Record<string, string> = {
  create: "bg-green-100 text-green-700",
  update: "bg-blue-100 text-blue-700",
  skipped: "bg-amber-100 text-amber-800",
  failed: "bg-red-100 text-red-700",
};

const OUTCOME_LABEL: Record<string, string> = {
  create: "New",
  update: "Update",
  skipped: "Skipped",
  failed: "Failed",
};

/**
 * Two-step product list upload: validate and preview first, then confirm.
 *
 * The file is held in component state between the two steps and re-submitted on
 * confirm, because the server re-parses and re-validates from the bytes rather
 * than trusting rows posted back from the browser.
 */
export function ProductUploadClient() {
  const [file, setFile] = useState<File | null>(null);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runPreview(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) {
      setError("Choose an .xlsx or .csv file to upload.");
      return;
    }
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    if (updateExisting) fd.set("update_existing", "on");
    const result = await previewProductUploadAction(null, fd);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setPreview(null);
      return;
    }
    setPreview(result.preview);
  }

  const counts = preview?.counts;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Upload product list</CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert kind="error" className="mb-4">
              {error}
            </Alert>
          )}
          <form onSubmit={runPreview} className="space-y-4">
            <div>
              <input
                type="file"
                accept=".xlsx,.csv"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setPreview(null);
                  setError(null);
                }}
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
              />
              <p className="mt-1 text-xs text-slate-400">
                .xlsx or .csv, up to 10 MB. Columns: Product Name | SKU | Unit | Selling Price | Stock Quantity | Status |
                Date Added.
              </p>
            </div>

            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={updateExisting}
                onChange={(e) => {
                  setUpdateExisting(e.target.checked);
                  setPreview(null);
                }}
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
              />
              <span>
                Update Existing Products
                <span className="block text-xs text-slate-400">
                  Rows whose SKU already exists overwrite that product instead of being skipped.
                </span>
              </span>
            </label>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || !file}>
                <UploadCloud className="h-4 w-4" /> {busy ? "Checking…" : "Preview Upload"}
              </Button>
              <LinkButton href="/api/products/template" variant="outline">
                Download Product Template
              </LinkButton>
              <LinkButton href="/products/upload/history" variant="outline">
                View Upload History
              </LinkButton>
            </div>
          </form>
        </CardContent>
      </Card>

      {preview && counts && (
        <Card>
          <CardHeader>
            <CardTitle>Preview — {preview.fileName}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Summary label="New" value={counts.create} tone="text-green-700" />
              <Summary label="Updates" value={counts.update} tone="text-blue-700" />
              <Summary label="Skipped" value={counts.skipped} tone="text-amber-700" />
              <Summary label="Failed" value={counts.failed} tone="text-red-700" />
            </div>

            {counts.create + counts.update === 0 && (
              <Alert kind="warning">
                Nothing in this file would be imported. Fix the rows below, or tick Update Existing Products if you meant
                to overwrite.
              </Alert>
            )}

            <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">Outcome</th>
                    <th className="px-3 py-2">Product Name</th>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Unit</th>
                    <th className="px-3 py-2 text-right">Price</th>
                    <th className="px-3 py-2 text-right">Stock</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.rows.map((r) => (
                    <tr key={r.row} className={r.outcome === "failed" ? "bg-red-50/50" : undefined}>
                      <td className="px-3 py-2 text-slate-400">{r.row}</td>
                      <td className="px-3 py-2">
                        <Badge className={OUTCOME_BADGE[r.outcome]}>{OUTCOME_LABEL[r.outcome]}</Badge>
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-800">{r.name || "—"}</td>
                      <td className="px-3 py-2 text-slate-500">{r.sku || "—"}</td>
                      <td className="px-3 py-2 text-slate-500">{r.unit || "—"}</td>
                      <td className="px-3 py-2 text-right text-slate-500">
                        {r.selling_price === null ? "—" : formatCurrency(r.selling_price)}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500">{r.stock_quantity ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-500">{PRODUCT_STATUS_LABELS[r.status]}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{r.reason || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <form
              action={commitProductUploadAction}
              onSubmit={(e) => {
                // The file input cannot be populated programmatically, so the
                // held File is attached via DataTransfer just before submit.
                const input = e.currentTarget.querySelector<HTMLInputElement>('input[name="file"]');
                if (input && file) {
                  const dt = new DataTransfer();
                  dt.items.add(file);
                  input.files = dt.files;
                }
              }}
              className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3"
            >
              <input type="file" name="file" className="hidden" />
              {preview.updateExisting && <input type="hidden" name="update_existing" value="on" />}
              <Button type="button" variant="outline" onClick={() => setPreview(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={counts.create + counts.update === 0}>
                Confirm Import ({counts.create + counts.update})
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Summary({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-xs uppercase text-slate-400">{label}</p>
      <p className={`text-xl font-semibold ${tone}`}>{value}</p>
    </div>
  );
}
