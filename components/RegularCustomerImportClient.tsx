"use client";

import { useState, useTransition } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { REGULAR_CUSTOMER_IMPORT_HEADERS, REGULAR_CUSTOMER_IMPORT_FORBIDDEN_HEADERS } from "@/lib/validation";
import { importRegularCustomersAction, type RegularCustomerImportSummary } from "@/lib/actions/regular-customers";

interface RawRow {
  row: number;
  data: Record<string, unknown>;
}

/** Matched to the template's columns by position, so this list and
 * REGULAR_CUSTOMER_IMPORT_HEADERS must stay in step. */
const FIELD_KEYS = ["full_name", "phone", "purok", "barangay", "city", "province", "landmark"] as const;

/** Rows per request. Each row does real work — a customer insert, the adoption
 * of any leads on that number, a duplicate scan — so the batch is smaller than
 * the lead import's, where a row is mostly one insert. */
const BATCH_SIZE = 200;

const CATEGORY_LABELS: Record<string, string> = {
  duplicate: "Already your regular customers",
  missing_info: "Missing required info",
  invalid: "Invalid rows",
};

function csvEscape(cell: string | number): string {
  return `"${String(cell).replace(/"/g, '""')}"`;
}

export function RegularCustomerImportClient() {
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rawRows, setRawRows] = useState<RawRow[] | null>(null);
  const [summary, setSummary] = useState<RegularCustomerImportSummary | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [pending, startTransition] = useTransition();

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setRawRows(null);
    setSummary(null);
    setFileError(null);
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setFileError("Invalid file type. Please upload an .xlsx file using the provided template.");
      return;
    }
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });

        if (aoa.length === 0) {
          setFileError("The uploaded file contains no records.");
          return;
        }

        const headerRow = (aoa[0] as unknown[]).map((h) => String(h).trim());
        const headersMatch =
          headerRow.length >= REGULAR_CUSTOMER_IMPORT_HEADERS.length &&
          REGULAR_CUSTOMER_IMPORT_HEADERS.every((h, i) => headerRow[i] === h);
        const forbidden = headerRow.filter((h) => REGULAR_CUSTOMER_IMPORT_FORBIDDEN_HEADERS.includes(h));

        if (forbidden.length > 0) {
          // Named, rather than the generic "wrong format": Agent and Status are
          // the two people most often expect to be here, and being told the
          // system decides them is the whole answer.
          setFileError(
            `This file has ${forbidden.join(", ")} column${forbidden.length === 1 ? "" : "s"}, which the import does not take. ` +
              "The customers become yours and start active — the system fills those in. Please use the latest template."
          );
          return;
        }
        if (!headersMatch) {
          setFileError(
            `The file format is incorrect. The first ${REGULAR_CUSTOMER_IMPORT_HEADERS.length} columns must be: ${REGULAR_CUSTOMER_IMPORT_HEADERS.join(", ")}.`
          );
          return;
        }

        const dataRows = aoa.slice(1).filter((r) => (r as unknown[]).some((c) => String(c).trim() !== ""));
        if (dataRows.length === 0) {
          setFileError("The uploaded file contains no records.");
          return;
        }

        const parsed: RawRow[] = dataRows.map((r, idx) => {
          const rowArr = r as unknown[];
          const raw: Record<string, unknown> = {};
          FIELD_KEYS.forEach((key, i) => {
            // Everything is text. A number typed as 9171234567 arrives from
            // Excel as a number and would otherwise lose its leading zero on
            // the way in — normalizePhone works on the digits either way, but
            // the raw form is what the agent sees on the customer's row.
            raw[key] = String(rowArr[i] ?? "").trim();
          });
          return { row: idx + 2, data: raw };
        });

        setRawRows(parsed);
      } catch {
        setFileError("Could not read this file. Please make sure it is a valid .xlsx file.");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  /**
   * Sends the file a batch at a time.
   *
   * One request carrying every row is what a serverless function's time limit
   * kills, and it takes the whole import with it. A failed batch is retried and
   * then skipped rather than ending the run: the rows already written stay, and
   * re-uploading the same file skips them as duplicates.
   */
  function handleConfirm() {
    if (!rawRows) return;
    setFileError(null);
    setProgress({ done: 0, total: rawRows.length });

    startTransition(async () => {
      const batches: RawRow[][] = [];
      for (let i = 0; i < rawRows.length; i += BATCH_SIZE) batches.push(rawRows.slice(i, i + BATCH_SIZE));

      const merged: RegularCustomerImportSummary = {
        total: 0,
        imported: 0,
        duplicates: 0,
        missingInfo: 0,
        invalid: 0,
        ordersMoved: 0,
        results: [],
      };

      let failedRows = 0;
      let failedBatches = 0;

      for (let i = 0; i < batches.length; i++) {
        let part: RegularCustomerImportSummary | null = null;
        for (let attempt = 0; attempt < 3 && !part; attempt++) {
          try {
            part = await importRegularCustomersAction(batches[i], fileName || "import.xlsx");
          } catch {
            // Backing off rather than retrying instantly: an immediate repeat
            // of a request that just timed out is the same request.
            if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          }
        }

        if (!part) {
          failedBatches += 1;
          failedRows += batches[i].length;
          continue;
        }

        merged.total += part.total;
        merged.imported += part.imported;
        merged.duplicates += part.duplicates;
        merged.missingInfo += part.missingInfo;
        merged.invalid += part.invalid;
        merged.ordersMoved += part.ordersMoved;
        merged.results.push(...part.results);
        setProgress({ done: merged.total + failedRows, total: rawRows.length });
      }

      if (failedRows > 0) {
        setFileError(
          `${failedRows} of ${rawRows.length} rows could not be sent (${failedBatches} batch${failedBatches === 1 ? "" : "es"} failed after three tries). ` +
            "Everything else was saved. Upload the same file again to pick up the rest: customers already added are skipped."
        );
      }

      setProgress(null);
      if (merged.total > 0) setSummary(merged);
    });
  }

  function downloadErrorReport() {
    if (!summary) return;
    const rejected = summary.results.filter((r) => r.category !== "imported");
    const header = ["Row", "Category", "Reason", ...REGULAR_CUSTOMER_IMPORT_HEADERS];
    const lines = [
      header,
      ...rejected.map((r) => [
        r.row,
        CATEGORY_LABELS[r.category] || r.category,
        r.reason,
        ...FIELD_KEYS.map((k) => String(r.data[k] ?? "")),
      ]),
    ];
    const csv = lines.map((row) => row.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `regular-customers-import-errors-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {fileError && <Alert kind="error">{fileError}</Alert>}

      <div className="rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center">
        <input
          id="file"
          type="file"
          accept=".xlsx"
          onChange={handleFile}
          className="block w-full cursor-pointer text-sm text-slate-600 file:mr-4 file:rounded-md file:border-0 file:bg-[var(--brand-primary)] file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:opacity-90"
        />
        <p className="mt-2 text-xs text-slate-400">
          Only .xlsx files created from the official Regular Customers template are accepted.
        </p>
      </div>

      {rawRows && !summary && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-slate-600">
              {rawRows.length} row(s) parsed from {fileName}.
              {rawRows.length > BATCH_SIZE && ` Sent in ${Math.ceil(rawRows.length / BATCH_SIZE)} batches.`}
            </span>
            <Button variant="primary" disabled={pending} onClick={handleConfirm}>
              {pending ? "Importing…" : `Confirm Import (${rawRows.length} rows)`}
            </Button>
          </div>
          {progress && (
            <>
              {/* A file of this size takes long enough that a spinner alone
                  looks indistinguishable from a hang. */}
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full bg-[var(--brand-primary)] transition-[width] duration-300"
                  style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-slate-500">
                {progress.done} of {progress.total} rows processed — keep this page open.
              </p>
            </>
          )}
        </div>
      )}

      {summary && (
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="font-medium text-green-700">{summary.imported} added</span>
            <span className="font-medium text-amber-700">{summary.duplicates} already yours</span>
            <span className="font-medium text-red-700">{summary.missingInfo} missing required info</span>
            <span className="font-medium text-red-700">{summary.invalid} invalid</span>
            <span className="text-slate-400">{summary.total} total rows</span>
          </div>

          {summary.ordersMoved > 0 && (
            <Alert kind="info">
              {summary.ordersMoved} lead{summary.ordersMoved === 1 ? "" : "s"} you already held on these numbers moved
              onto the customer records and left the active Leads list. They are still reachable from each customer&apos;s
              Previous and Latest Order.
            </Alert>
          )}

          {(["duplicate", "missing_info", "invalid"] as const).map((cat) => {
            const rows = summary.results.filter((r) => r.category === cat);
            if (rows.length === 0) return null;
            return (
              <div key={cat}>
                <p className="mb-1 text-xs font-semibold uppercase text-slate-400">{CATEGORY_LABELS[cat]}</p>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-sm text-red-700">
                  {rows.map((r) => (
                    <li key={r.row}>
                      Row {r.row}: {r.reason}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}

          <div className="flex justify-between border-t border-slate-100 pt-3">
            <Button
              variant="outline"
              onClick={downloadErrorReport}
              disabled={summary.results.every((r) => r.category === "imported")}
            >
              Download error report (CSV)
            </Button>
            <a href="/regular-customers">
              <Button variant="primary">Go to Regular Customers</Button>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
