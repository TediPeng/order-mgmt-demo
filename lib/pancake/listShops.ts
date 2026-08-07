import type { PancakeAccount } from "@/lib/types";
import { mockMode } from "./config";
import { pancakeFetch } from "./client";

/** Every shop the account's API key can see (GET /shops).
 *
 * The one Pancake endpoint that takes no shop id, which is exactly why it is
 * useful: when the configured id is wrong, every other call answers 404 and
 * none of them can tell you what the right one would have been.
 *
 * It also settles the confusion this exists to solve. Pancake's own schema
 * gives a shop an INTEGER `id` and nests `pages[]` inside it whose ids are
 * STRINGS -- Facebook page ids, ten digits, beginning 10. Both are "the
 * number for my shop" to anyone reading the Pancake UI, only one works here,
 * and the field on our side is called shop_or_page_id for both. Listing them
 * side by side is the fastest way to see which is which.
 */

export interface PancakeShop {
  id: string;
  name: string;
  /** Facebook pages merged into this shop — shown because a page id is the
   * value most likely to have been entered by mistake. */
  pageIds: string[];
}

export interface ShopLookupResult {
  ok: boolean;
  error: string | null;
  shops: PancakeShop[];
}

export async function listShops(account: PancakeAccount): Promise<ShopLookupResult> {
  if (mockMode() !== "off") {
    return {
      ok: true,
      error: null,
      shops: [{ id: "12", name: "Mock Shop", pageIds: ["1021942350"] }],
    };
  }

  // Deliberately not resolvePath(): this call must not carry the shop id,
  // since the whole point is that the stored one may be wrong.
  const res = await pancakeFetch(account, "/shops", { method: "GET" });
  if (!res.ok) return { ok: false, error: res.error, shops: [] };

  const body = (res.body || {}) as Record<string, unknown>;
  const raw = Array.isArray(body.shops) ? body.shops : Array.isArray(body.data) ? body.data : [];

  const shops: PancakeShop[] = raw.map((entry) => {
    const s = (entry || {}) as Record<string, unknown>;
    const pages = Array.isArray(s.pages) ? s.pages : [];
    return {
      id: String(s.id ?? ""),
      name: String(s.name ?? "(unnamed)"),
      pageIds: pages
        .map((p) => String(((p || {}) as Record<string, unknown>).id ?? ""))
        .filter((id) => id.length > 0),
    };
  });

  return { ok: true, error: null, shops };
}
