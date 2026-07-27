import type { PancakeAccount } from "@/lib/types";
import { mockMode } from "./config";
import { pancakeFetch, resolvePath } from "./client";

export interface PancakeVariation {
  variation_id: string;
  sku: string | null;
  product_name: string;
  retail_price: number | null;
}

export interface VariationLookupResult {
  ok: boolean;
  error: string | null;
  variations: PancakeVariation[];
}

/** Reads the shop's product catalog (GET /shops/{SHOP_ID}/products/variations)
 * so Management can copy a real variation ID into a product instead of
 * guessing. Read-only; the API key never leaves the server. */
export async function listVariations(account: PancakeAccount, search = ""): Promise<VariationLookupResult> {
  if (mockMode() !== "off") {
    return {
      ok: true,
      error: null,
      variations: [
        { variation_id: "MOCK-VARIATION-1", sku: "MOCK-SKU-1", product_name: "Mock Product A", retail_price: 100 },
        { variation_id: "MOCK-VARIATION-2", sku: "MOCK-SKU-2", product_name: "Mock Product B", retail_price: 250 },
      ],
    };
  }

  // Variation rows are large (warehouses, price tables, images), so keep the
  // page small — this runs inside a page render.
  const query = new URLSearchParams({ page_size: "25", page_number: "1" });
  if (search.trim()) query.set("search", search.trim());
  const path = `${resolvePath("/shops/{shopId}/products/variations", account)}?${query.toString()}`;
  const res = await pancakeFetch(account, path, { method: "GET" });
  if (!res.ok) return { ok: false, error: res.error || "Lookup failed.", variations: [] };

  const rows = ((res.body as { data?: unknown })?.data || []) as Record<string, unknown>[];
  return {
    ok: true,
    error: null,
    variations: rows.map((v) => {
      const product = (v.product || {}) as Record<string, unknown>;
      return {
        variation_id: String(v.id ?? ""),
        sku: v.display_id != null && v.display_id !== "" ? String(v.display_id) : null,
        product_name: String(product.name ?? v.name ?? "(unnamed)"),
        retail_price: v.retail_price != null ? Number(v.retail_price) : null,
      };
    }),
  };
}
