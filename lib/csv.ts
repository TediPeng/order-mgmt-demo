import { formatDateTime } from "./utils";
import { APP_NAME } from "./version";

export function buildBrandedCsv(title: string, header: string[], rows: (string | number)[][]): string {
  const esc = (cell: string | number) => `"${String(cell).replace(/"/g, '""')}"`;
  const lines = [
    [`${APP_NAME} — ${title}`],
    [`Generated ${formatDateTime(new Date().toISOString())}`],
    [],
    header,
    ...rows,
  ];
  return lines.map((row) => row.map(esc).join(",")).join("\n");
}
