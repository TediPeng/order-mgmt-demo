import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDbLite } from "@/lib/db";
import { can } from "@/lib/permissions";
import { buildBrandedCsv } from "@/lib/csv";
import { formatDate } from "@/lib/utils";
import { displayUserName, PRODUCT_STATUS_LABELS, PRODUCT_STATUSES, type ProductStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Exports the product catalogue as CSV.
 *
 * Gated on products.view, like the template download beside it, because the
 * file carries nothing the requester is not already reading on the page. The
 * catalogue is shared and unscoped -- there is no per-agent slice of it the way
 * there is for leads, which is why this does not need its own export right.
 *
 * The filter and sort below are a deliberate copy of app/(app)/products/page.tsx.
 * The button sends whatever the page is currently filtered by, so the file and
 * the screen agree; if that filter ever changes in one place it has to change in
 * both, or the export quietly stops matching what the user is looking at.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  // readDbLite, not readDb: this reads the catalogue and writes nothing, and a
  // full read-and-rewrite to record a catalogue download would cost more than
  // the download. Nothing is logged here for the same reason -- unlike the leads
  // export, no customer data leaves the building.
  const db = await readDbLite();
  if (!can(user.role, "products", "view", db.role_permissions)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").toLowerCase();
  const status = searchParams.get("status") || "";

  let products = [...db.products];
  if (q) {
    products = products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.code || "").toLowerCase().includes(q) ||
        (p.sku || "").toLowerCase().includes(q)
    );
  }
  if (status && (PRODUCT_STATUSES as readonly string[]).includes(status)) {
    products = products.filter((p) => p.status === status);
  }
  products.sort((a, b) => b.created_at.localeCompare(a.created_at));

  const byId = new Map(db.profiles.map((p) => [p.id, displayUserName(p)]));

  const header = [
    "Product Name",
    "Code",
    "SKU",
    "Unit",
    "Selling Price",
    "Stock",
    "Status",
    "Date Added",
    "Created By",
  ];

  const rows = products.map((p) => [
    p.name,
    p.code || "",
    p.sku || "",
    p.unit || "",
    // Plain numbers, not formatCurrency. The page shows "₱1,234.00" because a
    // person is reading it; a spreadsheet cannot sum that string, and totalling
    // the price and stock columns is most of why anyone exports this.
    p.selling_price ?? "",
    p.stock_quantity ?? "",
    PRODUCT_STATUS_LABELS[p.status as ProductStatus] || p.status,
    formatDate(p.created_at),
    byId.get(p.created_by) || "",
  ]);

  return new NextResponse(buildBrandedCsv("Products Export", header, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="products-export-${Date.now()}.csv"`,
    },
  });
}
