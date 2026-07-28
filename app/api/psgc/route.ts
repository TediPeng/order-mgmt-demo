import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listBarangays, listCities, listProvinces } from "@/lib/psgc";

/** Feeds the dependent address dropdowns:
 *   /api/psgc                     -> provinces
 *   /api/psgc?province=<code>     -> cities/municipalities in that province
 *   /api/psgc?city=<code>         -> barangays in that city
 *
 * One level at a time, so the ~42k barangays are never shipped at once.
 * PSGC is public reference data that changes only when we re-seed, so responses
 * are cached hard at the edge and in the browser; a session is still required
 * because the endpoint exists only to serve the app's own forms. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const province = req.nextUrl.searchParams.get("province");
  const city = req.nextUrl.searchParams.get("city");

  try {
    const options = city ? await listBarangays(city) : province ? await listCities(province) : await listProvinces();
    return NextResponse.json(
      { ok: true, options },
      { headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" } }
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
