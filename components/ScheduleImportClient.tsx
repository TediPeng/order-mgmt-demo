"use client";

import { useState, useTransition } from "react";
import * as XLSX from "xlsx";
import { Button, LinkButton } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { importSchedulesAction } from "@/lib/actions/schedule-import";
import {
  parseDateHeader,
  parseShiftCell,
  SCHEDULE_IMPORT_AGENT_HEADER,
  SCHEDULE_IMPORT_NAME_HEADER,
} from "@/lib/schedule-import";
import type { ScheduleImportRow, ScheduleImportSummary, WorkDayTimes } from "@/lib/schedule-import";

/**
 * Reads a filled-in roster and previews it before anything is written.
 *
 * The preview is the point: a roster covers a whole team for a whole week, so
 * "23 shifts, 5 rest days, 1 unreadable cell" is worth seeing before the file
 * is applied. The server re-parses every cell regardless — this is a courtesy,
 * not a gate.
 */

const CATEGORY_LABELS: Record<string, string> = {
  invalid: "Unreadable cells",
  unrecognized_agent: "Unrecognized agents",
  skipped_suspended: "Skipped — suspension",
};

interface Preview {
  rows: ScheduleImportRow[];
  dates: string[];
  duty: number;
  rest: number;
  problems: { row: number; agent: string; message: string }[];
}

export function ScheduleImportClient({
  templateHref,
  workDay,
}: {
  templateHref: string;
  /** The company work day the statuses resolve against — the same values the
   * server uses, passed in so the preview cannot disagree with the import. */
  workDay: WorkDayTimes;
}) {
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [summary, setSummary] = useState<ScheduleImportSummary | null>(null);
  const [pending, startTransition] = useTransition();

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setPreview(null);
    setSummary(null);
    setFileError(null);
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setFileError("Invalid file type. Please upload the .xlsx roster template.");
      return;
    }
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        // The template's second sheet is the instructions; the roster is the
        // one named Schedule, falling back to the first sheet.
        const ws = wb.Sheets["Schedule"] || wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: false });
        if (aoa.length === 0) {
          setFileError("That file has no rows.");
          return;
        }

        const header = (aoa[0] as unknown[]).map((h) => String(h ?? "").trim());
        if (header[0] !== SCHEDULE_IMPORT_AGENT_HEADER || header[1] !== SCHEDULE_IMPORT_NAME_HEADER) {
          setFileError(
            `The first two columns must be "${SCHEDULE_IMPORT_AGENT_HEADER}" and "${SCHEDULE_IMPORT_NAME_HEADER}". Download the template and fill that in instead.`
          );
          return;
        }

        // Date columns are read from the header, so the file may cover any span.
        const dateCols: { index: number; date: string }[] = [];
        header.forEach((h, i) => {
          if (i < 2) return;
          const date = parseDateHeader(h);
          if (date) dateCols.push({ index: i, date });
        });
        if (dateCols.length === 0) {
          setFileError("No date columns found. Each date header must start with YYYY-MM-DD.");
          return;
        }

        const rows: ScheduleImportRow[] = [];
        const problems: Preview["problems"] = [];
        let duty = 0;
        let rest = 0;

        aoa.slice(1).forEach((r, idx) => {
          const arr = r as unknown[];
          const agent = String(arr[0] ?? "").trim();
          if (!agent) return; // blank spacer line
          const rowNumber = idx + 2;
          const cells = dateCols.map((c) => ({ date: c.date, raw: String(arr[c.index] ?? "").trim() }));

          for (const cell of cells) {
            const shift = parseShiftCell(cell.raw, workDay);
            if (shift.kind === "duty") duty++;
            else if (shift.kind === "rest") rest++;
            else if (shift.kind === "invalid") {
              problems.push({ row: rowNumber, agent, message: `${cell.date}: ${shift.error}` });
            }
          }

          rows.push({ row: rowNumber, agent, cells });
        });

        if (rows.length === 0) {
          setFileError("No agent rows found — the Agent column is empty all the way down.");
          return;
        }

        setPreview({ rows, dates: dateCols.map((c) => c.date), duty, rest, problems });
      } catch {
        setFileError("Could not read this file. Please make sure it is a valid .xlsx file.");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function handleConfirm() {
    if (!preview) return;
    startTransition(async () => {
      setSummary(await importSchedulesAction(preview.rows, fileName || "schedule.xlsx"));
    });
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
          Upload the roster template with the shifts filled in. Blank cells are left alone.
        </p>
      </div>

      {preview && !summary && (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="font-medium text-slate-700">{preview.rows.length} agents</span>
            <span className="text-slate-500">
              {preview.dates.length} day{preview.dates.length === 1 ? "" : "s"} ({preview.dates[0]} →{" "}
              {preview.dates[preview.dates.length - 1]})
            </span>
            <span className="font-medium text-green-700">{preview.duty} shifts</span>
            <span className="font-medium text-slate-600">{preview.rest} rest days</span>
            {preview.problems.length > 0 && (
              <span className="font-medium text-red-700">{preview.problems.length} unreadable cells</span>
            )}
          </div>

          {preview.problems.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto text-sm text-red-700">
              {preview.problems.map((p, i) => (
                <li key={i}>
                  Row {p.row} ({p.agent}) — {p.message}
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between border-t border-slate-100 pt-3">
            <p className="text-xs text-slate-400">
              Existing schedules on these dates are replaced. Suspension dates are skipped.
            </p>
            <Button variant="primary" disabled={pending} onClick={handleConfirm}>
              {pending ? "Importing…" : `Apply roster (${preview.duty + preview.rest} days)`}
            </Button>
          </div>
        </div>
      )}

      {summary && (
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="font-medium text-green-700">{summary.assigned} shifts assigned</span>
            <span className="font-medium text-slate-600">{summary.restDays} rest days</span>
            <span className="font-medium text-amber-700">{summary.skippedSuspended} skipped (suspension)</span>
            <span className="font-medium text-red-700">{summary.unrecognizedAgents} unrecognized agents</span>
            <span className="font-medium text-red-700">{summary.invalid} unreadable</span>
          </div>

          {(["unrecognized_agent", "skipped_suspended", "invalid"] as const).map((cat) => {
            const rows = summary.results.filter((r) => r.category === cat);
            if (rows.length === 0) return null;
            return (
              <div key={cat}>
                <p className="mb-1 text-xs font-semibold uppercase text-slate-400">{CATEGORY_LABELS[cat]}</p>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-sm text-slate-600">
                  {rows.map((r, i) => (
                    <li key={i}>
                      Row {r.row} ({r.agent}){r.date ? ` · ${r.date}` : ""} — {r.reason}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}

          <div className="flex justify-between border-t border-slate-100 pt-3">
            <LinkButton href={templateHref} variant="outline">
              Download template again
            </LinkButton>
            <LinkButton href="/schedule">Go to Schedule</LinkButton>
          </div>
        </div>
      )}
    </div>
  );
}
