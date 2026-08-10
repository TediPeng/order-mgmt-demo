"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { writeDb, uuid, nowIso } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUserLite, requirePermission } from "./guards";
import { MAX_PRODUCT_UPLOAD_BYTES } from "@/lib/validation";
import {
  buildProductUploadPreview,
  countOutcomes,
  toRowErrors,
  type ParsedProductRow,
} from "@/lib/product-upload";
import type { Product, ProductUpload } from "@/lib/types";

const PATH = "/products/upload";

function fail(message: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(message)}`);
}

function extensionOf(fileName: string): "xlsx" | "csv" | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".csv")) return "csv";
  return null;
}

async function readUpload(formData: FormData): Promise<{ file: File; buffer: Buffer; extension: "xlsx" | "csv" }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) fail("Choose an .xlsx or .csv file to upload.");
  const extension = extensionOf(file.name);
  if (!extension) fail("Only .xlsx and .csv files are supported.");
  if (file.size > MAX_PRODUCT_UPLOAD_BYTES) {
    fail(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB.`);
  }
  return { file, buffer: Buffer.from(await file.arrayBuffer()), extension };
}

export interface PreviewState {
  fileName: string;
  updateExisting: boolean;
  rows: ParsedProductRow[];
  counts: ReturnType<typeof countOutcomes>;
}

/**
 * Parses and validates the file, returning what confirming it WOULD do. Nothing
 * is written here — the preview is the whole point, so an Administrator can see
 * the create/update/skip/fail split before committing.
 */
export async function previewProductUploadAction(_prev: unknown, formData: FormData): Promise<
  { ok: true; preview: PreviewState } | { ok: false; error: string }
> {
  const { user, db } = await requireUserLite();
  requirePermission(user, "products", "create", db, "/products");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an .xlsx or .csv file to upload." };
  }
  const extension = extensionOf(file.name);
  if (!extension) return { ok: false, error: "Only .xlsx and .csv files are supported." };
  if (file.size > MAX_PRODUCT_UPLOAD_BYTES) {
    return { ok: false, error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB.` };
  }

  const updateExisting = formData.get("update_existing") === "on";
  let preview;
  try {
    preview = buildProductUploadPreview(
      Buffer.from(await file.arrayBuffer()),
      extension,
      db.products.map((p) => ({ id: p.id, name: p.name, sku: p.sku })),
      updateExisting
    );
  } catch (e) {
    return { ok: false, error: `Could not read that file: ${(e as Error).message}` };
  }
  if (preview.headerProblem) return { ok: false, error: preview.headerProblem };
  if (preview.rows.length === 0) return { ok: false, error: "The file has no data rows." };

  return {
    ok: true,
    preview: { fileName: file.name, updateExisting, rows: preview.rows, counts: preview.counts },
  };
}

/**
 * Re-parses the same file and applies it. Deliberately re-validates from the
 * bytes rather than trusting a preview posted back from the browser: the client
 * must not be able to hand us rows that never passed validation, and the product
 * table may have changed since the preview was generated.
 */
export async function commitProductUploadAction(formData: FormData) {
  const { user, db } = await requireUserLite();
  requirePermission(user, "products", "create", db, "/products");

  const { file, buffer, extension } = await readUpload(formData);
  const updateExisting = formData.get("update_existing") === "on";

  const preview = buildProductUploadPreview(
    buffer,
    extension,
    db.products.map((p) => ({ id: p.id, name: p.name, sku: p.sku })),
    updateExisting
  );
  if (preview.headerProblem) fail(preview.headerProblem);

  const now = nowIso();
  let imported = 0;
  let updated = 0;

  for (const row of preview.rows) {
    if (row.outcome === "create") {
      const product: Product = {
        id: uuid(),
        name: row.name,
        code: row.sku,
        sku: row.sku,
        unit: row.unit,
        selling_price: row.selling_price,
        stock_quantity: row.stock_quantity,
        pancake_variation_id: null,
        variants: null,
        status: row.status,
        created_by: user.id,
        // A Date Added supplied by the file wins, so a migrated catalog keeps
        // its real history instead of everything landing on the upload date.
        created_at: row.date_added || now,
        updated_by: null,
        updated_at: null,
      };
      db.products.push(product);
      imported++;
      continue;
    }
    if (row.outcome === "update" && row.sku) {
      const target = db.products.find((p) => p.sku?.toLowerCase() === row.sku!.toLowerCase());
      if (!target) continue;
      target.name = row.name;
      target.unit = row.unit;
      target.selling_price = row.selling_price;
      target.stock_quantity = row.stock_quantity;
      target.status = row.status;
      target.updated_by = user.id;
      target.updated_at = now;
      updated++;
    }
  }

  const counts = countOutcomes(preview.rows);
  const errors = toRowErrors(preview.rows);

  const record: ProductUpload = {
    id: uuid(),
    file_name: file.name,
    uploaded_by: user.id,
    total_rows: counts.total,
    imported,
    updated,
    skipped: counts.skipped,
    failed: counts.failed,
    update_existing: updateExisting,
    errors: errors.length > 0 ? errors : null,
    uploaded_at: now,
  };

  const info = await getRequestInfo();
  logActivity(
    db,
    user.id,
    "PRODUCT_UPLOAD",
    "product_upload",
    record.id,
    { file_name: record.file_name, imported, updated, skipped: counts.skipped, failed: counts.failed },
    { module: "products", updated_value: record, ...info }
  );

  await writeDb(db);

  // Written after the products land, so a failed product write never leaves a
  // history row claiming an import that did not happen.
  const { error } = await supabaseAdmin.from("product_uploads").insert(record);
  if (error) fail(`Products imported, but the upload history could not be recorded: ${error.message}`);

  revalidatePath("/products");
  revalidatePath(PATH);
  redirect(
    `/products?uploaded=1&imported=${imported}&updated=${updated}&skipped=${counts.skipped}&failed=${counts.failed}&upload_id=${record.id}`
  );
}

export async function listProductUploads(): Promise<ProductUpload[]> {
  const { data, error } = await supabaseAdmin
    .from("product_uploads")
    .select("*")
    .order("uploaded_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`product_uploads read failed: ${error.message}`);
  return (data || []) as ProductUpload[];
}

export async function getProductUpload(id: string): Promise<ProductUpload | null> {
  const { data, error } = await supabaseAdmin.from("product_uploads").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`product_uploads read failed: ${error.message}`);
  return (data as ProductUpload) || null;
}
