import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDbLite } from "@/lib/db";
import { can } from "@/lib/permissions";
import { buildBrandedCsv } from "@/lib/csv";
import { getProductUpload } from "@/lib/actions/product-upload";

export const dynamic = "force-dynamic";

/** The downloadable error report for one upload (Section 7): every row that was
 * skipped or rejected, with the reason, so the uploader can fix the source file
 * rather than guess at what went wrong. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const db = await readDbLite();
  if (!can(user.role, "products", "view", db.role_permissions)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const upload = await getProductUpload(id);
  if (!upload) return NextResponse.json({ ok: false, error: "Upload not found" }, { status: 404 });

  const csv = buildBrandedCsv(
    `Product Upload Errors — ${upload.file_name}`,
    ["Row", "Product Name", "Reason"],
    (upload.errors || []).map((e) => [e.row, e.product_name, e.reason])
  );

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="product-upload-errors-${id.slice(0, 8)}.csv"`,
    },
  });
}
