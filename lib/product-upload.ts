import { parseSpreadsheetToRows } from "./call-log-parser";
import { parseProductStatus, PRODUCT_UPLOAD_HEADERS } from "./validation";
import type { Product, ProductStatus, ProductUploadRowError } from "./types";

/** One parsed template row, after validation. */
export interface ParsedProductRow {
  /** 1-based row number as the uploader sees it in their spreadsheet (header = 1). */
  row: number;
  name: string;
  sku: string | null;
  unit: string | null;
  selling_price: number | null;
  stock_quantity: number | null;
  status: ProductStatus;
  date_added: string | null;
  /** What will happen on confirm. */
  outcome: "create" | "update" | "skipped" | "failed";
  reason: string;
}

export interface ProductUploadPreview {
  rows: ParsedProductRow[];
  headerProblem: string | null;
  counts: { total: number; create: number; update: number; skipped: number; failed: number };
}

function cell(row: string[], index: number): string {
  return String(row[index] ?? "").trim();
}

/** Header row match, order-insensitive and case-insensitive, so a re-saved
 * template with shuffled columns still imports. Returns a column index per
 * known header, or null when Product Name is missing entirely. */
function mapHeaders(header: string[]): Record<string, number> | null {
  const normalize = (s: string) => s.trim().toLowerCase().replace(/[\s_]+/g, " ");
  const found: Record<string, number> = {};
  header.forEach((h, i) => {
    const key = normalize(h);
    const match = PRODUCT_UPLOAD_HEADERS.find((expected) => normalize(expected) === key);
    if (match) found[match] = i;
  });
  return "Product Name" in found ? found : null;
}

/** Excel hands back dates as serial numbers or Date objects depending on the
 * cell format; anything unparseable is kept as-is rather than guessed at. */
function parseDateAdded(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber) && asNumber > 20000 && asNumber < 80000) {
    // Excel serial date: days since 1899-12-30.
    const ms = Math.round((asNumber - 25569) * 86400 * 1000);
    return new Date(ms).toISOString();
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Validates an uploaded product list against the documented rules (Section 7)
 * and reports what confirming it would do, without writing anything.
 *
 * Rules enforced: Product Name required; SKU unique (within the file AND against
 * existing products); Selling Price and Stock Quantity numeric and non-negative;
 * Status one of Active / Inactive / Out of Stock, defaulting to Active. A row
 * matching an existing product is `skipped` unless `updateExisting` is set, in
 * which case it becomes `update` (matched by SKU).
 */
export function buildProductUploadPreview(
  buffer: Buffer,
  extension: "xlsx" | "csv",
  existingProducts: Pick<Product, "id" | "name" | "sku">[],
  updateExisting: boolean
): ProductUploadPreview {
  const raw = parseSpreadsheetToRows(buffer, extension).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  if (raw.length === 0) {
    return { rows: [], headerProblem: "The file is empty.", counts: emptyCounts() };
  }

  const cols = mapHeaders(raw[0]);
  if (!cols) {
    return {
      rows: [],
      headerProblem: `Could not find a "Product Name" column. Expected headers: ${PRODUCT_UPLOAD_HEADERS.join(" | ")}.`,
      counts: emptyCounts(),
    };
  }

  const skuToExisting = new Map<string, { id: string; name: string }>();
  for (const p of existingProducts) {
    if (p.sku) skuToExisting.set(p.sku.toLowerCase(), { id: p.id, name: p.name });
  }
  const existingNames = new Set(existingProducts.map((p) => p.name.trim().toLowerCase()));
  const seenSkusInFile = new Set<string>();

  const rows: ParsedProductRow[] = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    const at = (key: string) => (cols[key] === undefined ? "" : cell(r, cols[key]));

    const name = at("Product Name");
    const sku = at("SKU") || null;
    const unit = at("Unit") || null;
    const priceRaw = at("Selling Price");
    const stockRaw = at("Stock Quantity");
    const statusRaw = at("Status");
    const dateAdded = parseDateAdded(at("Date Added"));

    const parsed: ParsedProductRow = {
      row: i + 1,
      name,
      sku,
      unit,
      selling_price: null,
      stock_quantity: null,
      status: "active",
      date_added: dateAdded,
      outcome: "create",
      reason: "",
    };

    const fail = (reason: string) => {
      parsed.outcome = "failed";
      parsed.reason = reason;
      rows.push(parsed);
    };

    if (!name) {
      fail("Product Name is required.");
      continue;
    }

    if (priceRaw) {
      const price = Number(priceRaw.replace(/,/g, ""));
      if (!Number.isFinite(price) || price < 0) {
        fail(`Selling Price "${priceRaw}" must be a number of 0 or more.`);
        continue;
      }
      parsed.selling_price = price;
    }

    if (stockRaw) {
      const stock = Number(stockRaw.replace(/,/g, ""));
      if (!Number.isInteger(stock) || stock < 0) {
        fail(`Stock Quantity "${stockRaw}" must be a whole number of 0 or more.`);
        continue;
      }
      parsed.stock_quantity = stock;
    }

    const status = parseProductStatus(statusRaw);
    if (!status) {
      fail(`Status "${statusRaw}" must be Active, Inactive, or Out of Stock.`);
      continue;
    }
    parsed.status = status;

    if (sku) {
      const key = sku.toLowerCase();
      if (seenSkusInFile.has(key)) {
        fail(`SKU "${sku}" appears more than once in this file.`);
        continue;
      }
      seenSkusInFile.add(key);

      const existing = skuToExisting.get(key);
      if (existing) {
        if (updateExisting) {
          parsed.outcome = "update";
          parsed.reason = `Updates existing product "${existing.name}".`;
        } else {
          parsed.outcome = "skipped";
          parsed.reason = `SKU "${sku}" already exists. Tick "Update Existing Products" to overwrite it.`;
        }
        rows.push(parsed);
        continue;
      }
    } else if (existingNames.has(name.trim().toLowerCase())) {
      // No SKU to match on, so a same-named product can only be flagged, never
      // safely updated — updating by name would be guessing.
      parsed.outcome = "skipped";
      parsed.reason = `A product named "${name}" already exists and this row has no SKU to match on.`;
      rows.push(parsed);
      continue;
    }

    parsed.reason = "";
    rows.push(parsed);
  }

  return { rows, headerProblem: null, counts: countOutcomes(rows) };
}

function emptyCounts() {
  return { total: 0, create: 0, update: 0, skipped: 0, failed: 0 };
}

export function countOutcomes(rows: ParsedProductRow[]) {
  return {
    total: rows.length,
    create: rows.filter((r) => r.outcome === "create").length,
    update: rows.filter((r) => r.outcome === "update").length,
    skipped: rows.filter((r) => r.outcome === "skipped").length,
    failed: rows.filter((r) => r.outcome === "failed").length,
  };
}

/** The rows that did not import, in the shape stored on product_uploads.errors
 * and rendered into the downloadable error report. */
export function toRowErrors(rows: ParsedProductRow[]): ProductUploadRowError[] {
  return rows
    .filter((r) => r.outcome === "failed" || r.outcome === "skipped")
    .map((r) => ({ row: r.row, product_name: r.name, reason: r.reason }));
}

/** The blank template, as CSV so it opens in both Excel and Sheets. */
export function buildProductTemplateCsv(): string {
  const example = ["Alingatong Oil", "ALG-001", "bottle", "499.00", "25", "Active", "2026-07-30"];
  return [PRODUCT_UPLOAD_HEADERS.join(","), example.join(",")].join("\n");
}
