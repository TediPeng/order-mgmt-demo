import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listAccounts } from "@/lib/pancake/store";
import { fetchCommunes, fetchDistricts, fetchProvinces } from "@/lib/pancake/address";
import { mockMode } from "@/lib/pancake/config";
import type { PancakeAccount } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Address options for the order form's cascading picker, proxied from Pancake.
 *
 * The browser cannot call Pancake directly — the API key is server-side only —
 * so the picker reads through here. Results are cached in the address service,
 * so a repeated province expansion costs nothing.
 *
 * `level=provinces` | `districts&province_id=…` | `communes&province_id=…&district_id=…`
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const level = req.nextUrl.searchParams.get("level") || "provinces";
  const provinceId = req.nextUrl.searchParams.get("province_id") || "";
  const districtId = req.nextUrl.searchParams.get("district_id") || "";

  // Address data is shop-independent, so any active account's credentials serve.
  const accounts = (await listAccounts()).filter((a) => a.is_active);
  const account = accounts.find((a) => a.is_default) || accounts[0];
  // Mock mode answers without calling Pancake, so it needs no credentials —
  // and refusing here for want of an account defeated the point of it. The dev
  // database has no Pancake account and never will, which left the address
  // boxes permanently empty and unable to be worked on locally at all.
  if (!account && mockMode() === "off") {
    return NextResponse.json(
      { ok: false, error: "No active Pancake POS account is configured, so address options cannot be loaded." },
      { status: 503 }
    );
  }
  // The mock branches inside these never look at it.
  const shop = account ?? ({ id: "mock" } as unknown as PancakeAccount);

  const result =
    level === "districts"
      ? await fetchDistricts(shop, provinceId)
      : level === "communes"
        ? await fetchCommunes(shop, provinceId, districtId)
        : await fetchProvinces(shop);

  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true, options: result.options });
}
