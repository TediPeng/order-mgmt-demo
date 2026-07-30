import Link from "next/link";
import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { Badge } from "@/components/ui/Badge";
import { Button, LinkButton } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { setProductStatusAction, deleteProductAction } from "@/lib/actions/products";
import { displayUserName, PRODUCT_STATUS_LABELS, PRODUCT_STATUSES, type ProductStatus } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/utils";

const STATUS_BADGE: Record<ProductStatus, string> = {
  active: "bg-green-100 text-green-700",
  inactive: "bg-slate-200 text-slate-600",
  out_of_stock: "bg-amber-100 text-amber-800",
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    error?: string;
    deleted?: string;
    status_set?: string;
    uploaded?: string;
    imported?: string;
    updated?: string;
    skipped?: string;
    failed?: string;
    upload_id?: string;
  }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDb();
  if (!can(user.role, "products", "view", db.role_permissions)) {
    return (
      <Alert kind="error">You do not have permission to view Products.</Alert>
    );
  }
  const canCreate = can(user.role, "products", "create", db.role_permissions);
  const canEdit = can(user.role, "products", "edit", db.role_permissions);
  const canDelete = can(user.role, "products", "delete", db.role_permissions);

  let products = [...db.products];
  if (sp.q) {
    const q = sp.q.toLowerCase();
    products = products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.code || "").toLowerCase().includes(q) ||
        (p.sku || "").toLowerCase().includes(q)
    );
  }
  if (sp.status && (PRODUCT_STATUSES as readonly string[]).includes(sp.status)) {
    products = products.filter((p) => p.status === sp.status);
  }
  products.sort((a, b) => b.created_at.localeCompare(a.created_at));

  const byId = new Map(db.profiles.map((p) => [p.id, displayUserName(p)]));
  const usedProductIds = new Set(db.orders.filter((o) => o.product_id).map((o) => o.product_id));

  const boundDeactivate = async (id: string) => {
    "use server";
    await setProductStatusAction(id, "inactive");
  };
  const boundActivate = async (id: string) => {
    "use server";
    await setProductStatusAction(id, "active");
  };
  const boundDelete = async (id: string) => {
    "use server";
    await deleteProductAction(id);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-page-title text-slate-900">Products</h1>
        <div className="flex flex-wrap gap-2">
          {canCreate && (
            <LinkButton href="/products/upload" variant="outline">
              Upload Product List
            </LinkButton>
          )}
          <LinkButton href="/api/products/template" variant="outline">
            Download Product Template
          </LinkButton>
          <LinkButton href="/products/upload/history" variant="outline">
            View Upload History
          </LinkButton>
          {canCreate && <LinkButton href="/products/new">Add Product</LinkButton>}
        </div>
      </div>

      {sp.error && (
        <Alert kind="error" className="mb-4">
          {sp.error}
        </Alert>
      )}
      {sp.deleted && (
        <Alert kind="success" className="mb-4">
          Product deleted.
        </Alert>
      )}
      {sp.uploaded && (
        <Alert kind="success" className="mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Upload complete — {sp.imported || 0} imported, {sp.updated || 0} updated, {sp.skipped || 0} skipped,{" "}
              {sp.failed || 0} failed.
            </span>
            {Number(sp.skipped || 0) + Number(sp.failed || 0) > 0 && sp.upload_id && (
              <a
                href={`/api/products/uploads/${sp.upload_id}/errors`}
                className="text-xs font-medium underline hover:no-underline"
              >
                Download error report
              </a>
            )}
          </div>
        </Alert>
      )}
      {sp.status_set && (
        <Alert kind="success" className="mb-4">
          Product status set to {PRODUCT_STATUS_LABELS[sp.status_set as ProductStatus] || sp.status_set}.
        </Alert>
      )}

      <form className="mb-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <Input name="q" placeholder="Search name, code or SKU" defaultValue={sp.q} />
        </div>
        <Select name="status" defaultValue={sp.status || ""}>
          <option value="">All statuses</option>
          {PRODUCT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PRODUCT_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Product Name</th>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Unit</th>
              <th className="px-4 py-3 text-right">Selling Price</th>
              <th className="px-4 py-3 text-right">Stock</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Date Added</th>
              <th className="px-4 py-3">Created By</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {products.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link href={`/products/${p.id}`} className="font-medium text-[var(--brand-primary)] hover:underline">
                    {p.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-500">{p.sku || p.code || "—"}</td>
                <td className="px-4 py-3 text-slate-500">{p.unit || "—"}</td>
                <td className="px-4 py-3 text-right text-slate-500">
                  {p.selling_price === null ? "—" : formatCurrency(p.selling_price)}
                </td>
                <td className="px-4 py-3 text-right text-slate-500">{p.stock_quantity ?? "—"}</td>
                <td className="px-4 py-3">
                  <Badge className={STATUS_BADGE[p.status]}>{PRODUCT_STATUS_LABELS[p.status]}</Badge>
                </td>
                <td className="px-4 py-3 text-slate-500">{formatDate(p.created_at)}</td>
                <td className="px-4 py-3 text-slate-500">{byId.get(p.created_by) || "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    {canEdit && p.status !== "inactive" && (
                      <ConfirmButton
                        action={boundDeactivate.bind(null, p.id)}
                        variant="outline"
                        size="sm"
                        label="Deactivate"
                        confirmTitle="Deactivate this product?"
                        confirmBody="It will no longer appear in the New Product Order dropdown. Existing leads keep referencing it."
                      />
                    )}
                    {canEdit && p.status !== "active" && (
                      <ConfirmButton
                        action={boundActivate.bind(null, p.id)}
                        variant="outline"
                        size="sm"
                        label="Activate"
                        confirmTitle="Activate this product?"
                        confirmBody="It will become selectable again in the New Product Order dropdown."
                      />
                    )}
                    {canDelete && (
                      <ConfirmButton
                        action={boundDelete.bind(null, p.id)}
                        variant="danger"
                        size="sm"
                        label="Delete"
                        confirmTitle="Delete this product?"
                        confirmBody={
                          usedProductIds.has(p.id)
                            ? "This product is used in existing leads and can only be deactivated."
                            : "This permanently removes the product. This action is logged."
                        }
                      />
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                  No products found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
