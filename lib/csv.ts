import { formatDateTime } from "./utils";

export function buildBrandedCsv(title: string, header: string[], rows: (string | number)[][]): string {
  const esc = (cell: string | number) => `"${String(cell).replace(/"/g, '""')}"`;
  const lines = [
    [`4S RETENTION — ${title}`],
    [`Generated ${formatDateTime(new Date().toISOString())}`],
    [],
    header,
    ...rows,
  ];
  return lines.map((row) => row.map(esc).join(",")).join("\n");
}
