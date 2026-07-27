"use client";

import { useState, useTransition } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { LEAD_IMPORT_HEADERS, LEAD_IMPORT_FORBIDDEN_HEADERS } from "@/lib/validation";
import { importLeadsAction, type LeadImportSummary } from "@/lib/actions/leads";

interface RawRow {
  row: number;
  data: Record<string, unknown>;
}

const FIELD_KEYS = [
  "agent_name",
  "customer_name",
  "customer_phone",
  "purok",
  "barangay",
  "city",
  "province",
  "landmark",
  "previous_order_date",
  "previous_order_product",
  "previous_order_amount",
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  duplicate: "Duplicate rows",
  invalid: "Invalid rows",
  missing_info: "Missing required info",
  unrecognized_agent: "Unrecognized agent usernames",
};

function csvEscape(cell: string | number): string {
  return `"${String(cell).replace(/"/g, '""')}"`;
}

export function LeadImportClient() {
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rawRows, setRawRows] = useState<RawRow[] | null>(null);
  const [summary, setSummary] = useState<LeadImportSummary | null>(null);
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
        const wb = XLSX.read(data, { type: "array", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });

        if (aoa.length === 0) {
          setFileError("The uploaded file contains no records.");
          return;
        }

        const headerRow = (aoa[0] as unknown[]).map((h) => String(h).trim());
        const headersMatch =
          headerRow.length >= LEAD_IMPORT_HEADERS.length && LEAD_IMPORT_HEADERS.every((h, i) => headerRow[i] === h);
        const hasForbiddenHeader = headerRow.some((h) => LEAD_IMPORT_FORBIDDEN_HEADERS.includes(h));

        if (!headersMatch || hasForbiddenHeader) {
          setFileError("The file format is incorrect. Please download and use the latest Leads template.");
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
            let val: unknown = rowArr[i] ?? "";
            if (key === "previous_order_date" && val instanceof Date) {
              val = val.toISOString().slice(0, 10);
            }
            if (key === "previous_order_amount") {
              val = val === "" ? null : Number(val);
            }
            raw[key] = val;
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

  function handleConfirm() {
    if (!rawRows) return;
    startTransition(async () => {
      const result = await importLeadsAction(rawRows, fileName || "import.xlsx");
      setSummary(result);
    });
  }

  function downloadErrorReport() {
    if (!summary) return;
    const rejected = summary.results.filter((r) => r.category !== "imported");
    const header = ["Row", "Category", "Reason", ...FIELD_KEYS];
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
    a.download = `leads-import-errors-${Date.now()}.csv`;
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
        <p className="mt-2 text-xs text-slate-400">Only .xlsx files created from the official Leads template are accepted.</p>
      </div>

      {rawRows && !summary && (
        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3">
          <span className="text-sm text-slate-600">{rawRows.length} row(s) parsed from {fileName}.</span>
          <Button variant="primary" disabled={pending} onClick={handleConfirm}>
            {pending ? "Importing…" : `Confirm Import (${rawRows.length} rows)`}
          </Button>
        </div>
      )}

      {summary && (
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="font-medium text-green-700">{summary.imported} imported</span>
            <span className="font-medium text-amber-700">{summary.duplicates} duplicates</span>
            <span className="font-medium text-red-700">{summary.invalid} invalid</span>
            <span className="font-medium text-red-700">{summary.missingInfo} missing required info</span>
            <span className="font-medium text-red-700">{summary.unrecognizedAgents} unrecognized agent usernames</span>
            <span className="text-slate-400">{summary.total} total rows</span>
          </div>

          {(["duplicate", "invalid", "missing_info", "unrecognized_agent"] as const).map((cat) => {
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
            <Button variant="outline" onClick={downloadErrorReport} disabled={summary.results.every((r) => r.category === "imported")}>
              Download error report (CSV)
            </Button>
            <a href="/leads">
              <Button variant="primary">Go to Leads</Button>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
