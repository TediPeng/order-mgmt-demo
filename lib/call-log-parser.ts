import * as XLSX from "xlsx";
import Papa from "papaparse";

export function parseSpreadsheetToRows(buffer: Buffer, extension: "xlsx" | "csv"): string[][] {
  if (extension === "xlsx") {
    const wb = XLSX.read(buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
    return aoa.map((row) => (row as unknown[]).map((c) => String(c ?? "")));
  }
  const text = buffer.toString("utf-8");
  const result = Papa.parse<string[]>(text, { skipEmptyLines: true });
  return (result.data as unknown[][]).map((row) => row.map((c) => String(c ?? "")));
}
