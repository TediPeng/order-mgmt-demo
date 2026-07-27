import Link from "next/link";
import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { Button, LinkButton } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { setProductActiveAction, deleteProductAction } from "@/lib/actions/products";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; error?: string; deleted?: string; activated?: string; deactivated?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = readDb();
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
    products = products.filter((p) => p.name.toLowerCase().includes(q) || (p.code || "").toLowerCase().includes(q));
  }
  if (sp.status === "active") products = products.filter((p) => p.is_active);
  if (sp.status === "inactive") products = products.filter((p) => !p.is_active);
  products.sort((a, b) => b.created_at.localeCompare(a.created_at));

  const byId = new Map(db.profiles.map((p) => [p.id, p.full_name]));
  const usedProductIds = new Set(db.orders.filter((o) => o.product_id).map((o) => o.product_id));

  const boundDeactivate = async (id: string) => {
    "use server";
    await setProductActiveAction(id, false);
  };
  const boundActivate = async (id: string) => {
    "use server";
    await setProductActiveAction(id, true);
  };
  const boundDelete = async (id: string) => {
    "use server";
    await deleteProductAction(id);
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Products</h1>
        {canCreate && <LinkButton href="/products/new">Add Product</LinkButton>}
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
      {sp.activated && (
        <Alert kind="success" className="mb-4">
          Product activated.
        </Alert>
      )}
      {sp.deactivated && (
        <Alert kind="success" className="mb-4">
          Product deactivated.
        </Alert>
      )}

      <form className="mb-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <Input name="q" placeholder="Search name or code" defaultValue={sp.q} />
        </div>
        <Select name="status" defaultValue={sp.status || ""}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Product Name</th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Date Created</th>
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
                <td className="px-4 py-3 text-slate-500">{p.code || "—"}</td>
                <td className="px-4 py-3">
                  <Badge className={p.is_active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}>
                    {p.is_active ? "Active" : "Inactive"}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-slate-500">{formatDate(p.created_at)}</td>
                <td className="px-4 py-3 text-slate-500">{byId.get(p.created_by) || "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    {canEdit && p.is_active && (
                      <ConfirmButton
                        action={boundDeactivate.bind(null, p.id)}
                        variant="outline"
                        size="sm"
                        label="Deactivate"
                        confirmTitle="Deactivate this product?"
                        confirmBody="It will no longer appear in the New Product Order dropdown. Existing leads keep referencing it."
                      />
                    )}
                    {canEdit && !p.is_active && (
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
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
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
