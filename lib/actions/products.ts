"use server";

import { redirect } from "next/navigation";
import { writeDb, uuid, nowIso } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { requireUser, requirePermission } from "./guards";
import { productFormSchema } from "@/lib/validation";
import type { Product, ProductStatus } from "@/lib/types";
import { describeParseFailure } from "@/lib/zod-error";

function productFormFields(formData: FormData) {
  return {
    name: formData.get("name"),
    code: formData.get("code"),
    sku: formData.get("sku"),
    unit: formData.get("unit"),
    selling_price: formData.get("selling_price"),
    stock_quantity: formData.get("stock_quantity"),
    status: formData.get("status") || undefined,
    pancake_variation_id: formData.get("pancake_variation_id"),
  };
}

export async function createProductAction(formData: FormData) {
  const { user, db } = await requireUser();
  requirePermission(user, "products", "create", db, "/products/new");

  const parsed = productFormSchema.safeParse(productFormFields(formData));
  if (!parsed.success) {
    const msg = describeParseFailure(parsed.error);
    redirect(`/products/new?error=${encodeURIComponent(msg)}`);
  }
  const data = parsed.data;
  const code = data.code.trim() || null;
  if (code && db.products.some((p) => p.code?.toLowerCase() === code.toLowerCase())) {
    redirect(`/products/new?error=${encodeURIComponent("A product with that code already exists.")}`);
  }
  const sku = data.sku.trim() || null;
  if (sku && db.products.some((p) => p.sku?.toLowerCase() === sku.toLowerCase())) {
    redirect(`/products/new?error=${encodeURIComponent("A product with that SKU already exists.")}`);
  }

  const now = nowIso();
  const product: Product = {
    id: uuid(),
    name: data.name,
    code,
    sku,
    unit: data.unit.trim() || null,
    selling_price: data.selling_price,
    stock_quantity: data.stock_quantity,
    pancake_variation_id: data.pancake_variation_id.trim() || null,
    variants: null,
    status: data.status,
    created_by: user.id,
    created_at: now,
    updated_by: null,
    updated_at: null,
  };
  db.products.push(product);
  const info = await getRequestInfo();
  logActivity(db, user.id, "PRODUCT_CREATED", "product", product.id, { name: product.name, code: product.code }, {
    module: "products",
    updated_value: product,
    ...info,
  });
  await writeDb(db);
  redirect(`/products/${product.id}?created=1`);
}

export async function updateProductAction(productId: string, formData: FormData) {
  const { user, db } = await requireUser();
  requirePermission(user, "products", "edit", db, `/products/${productId}`);

  const product = db.products.find((p) => p.id === productId);
  if (!product) redirect("/products");

  const parsed = productFormSchema.safeParse({
    ...productFormFields(formData),
    status: formData.get("status") || product!.status,
  });
  if (!parsed.success) {
    const msg = describeParseFailure(parsed.error);
    redirect(`/products/${productId}?error=${encodeURIComponent(msg)}`);
  }
  const data = parsed.data;
  const code = data.code.trim() || null;
  if (code && db.products.some((p) => p.id !== productId && p.code?.toLowerCase() === code.toLowerCase())) {
    redirect(`/products/${productId}?error=${encodeURIComponent("A product with that code already exists.")}`);
  }
  const sku = data.sku.trim() || null;
  if (sku && db.products.some((p) => p.id !== productId && p.sku?.toLowerCase() === sku.toLowerCase())) {
    redirect(`/products/${productId}?error=${encodeURIComponent("A product with that SKU already exists.")}`);
  }

  const before = { ...product! };
  product!.name = data.name;
  product!.code = code;
  product!.sku = sku;
  product!.unit = data.unit.trim() || null;
  product!.selling_price = data.selling_price;
  product!.stock_quantity = data.stock_quantity;
  product!.status = data.status;
  product!.pancake_variation_id = data.pancake_variation_id.trim() || null;
  product!.updated_by = user.id;
  product!.updated_at = nowIso();

  const info = await getRequestInfo();
  logActivity(db, user.id, "PRODUCT_UPDATED", "product", product!.id, { name: product!.name }, {
    module: "products",
    previous_value: before,
    updated_value: product,
    ...info,
  });
  await writeDb(db);
  redirect(`/products/${productId}?updated=1`);
}

export async function setProductStatusAction(productId: string, status: ProductStatus) {
  "use server";
  const { user, db } = await requireUser();
  requirePermission(user, "products", "edit", db, "/products");

  const product = db.products.find((p) => p.id === productId);
  if (!product) redirect("/products");

  const before = { ...product! };
  product!.status = status;
  product!.updated_by = user.id;
  product!.updated_at = nowIso();

  const info = await getRequestInfo();
  logActivity(
    db,
    user.id,
    status === "active" ? "PRODUCT_ACTIVATED" : "PRODUCT_DEACTIVATED",
    "product",
    product!.id,
    { name: product!.name, status },
    { module: "products", previous_value: before, updated_value: product, ...info }
  );
  await writeDb(db);
  redirect(`/products?status_set=${encodeURIComponent(status)}`);
}

export async function deleteProductAction(productId: string) {
  "use server";
  const { user, db } = await requireUser();
  requirePermission(user, "products", "delete", db, "/products");

  const product = db.products.find((p) => p.id === productId);
  if (!product) redirect("/products");

  const usedByLead = db.orders.some((o) => o.product_id === productId);
  if (usedByLead) {
    redirect(`/products?error=${encodeURIComponent("This product is used in existing leads and can only be deactivated.")}`);
  }

  const idx = db.products.findIndex((p) => p.id === productId);
  const [removed] = db.products.splice(idx, 1);
  const info = await getRequestInfo();
  logActivity(db, user.id, "PRODUCT_DELETED", "product", productId, { snapshot: removed }, {
    module: "products",
    previous_value: removed,
    ...info,
  });
  await writeDb(db);
  redirect("/products?deleted=1");
}
