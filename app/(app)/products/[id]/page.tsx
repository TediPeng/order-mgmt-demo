import { notFound } from "next/navigation";
import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Field";
import { Button, LinkButton } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/utils";
import { updateProductAction } from "@/lib/actions/products";

function summarizeValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") {
    const json = JSON.stringify(v);
    return json.length > 120 ? json.slice(0, 120) + "…" : json;
  }
  return String(v);
}

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; created?: string; updated?: string }>;
}) {
  const { id } = await params;
  const { error, created, updated } = await searchParams;
  const db = await readDb();
  const product = db.products.find((p) => p.id === id);
  if (!product) notFound();

  const user = (await getCurrentUser())!;
  if (!can(user.role, "products", "view", db.role_permissions)) notFound();
  const canEdit = can(user.role, "products", "edit", db.role_permissions);

  const creator = db.profiles.find((p) => p.id === product.created_by);
  const byId = new Map(db.profiles.map((p) => [p.id, p.full_name]));
  const history = db.activity_log
    .filter((e) => e.entity_id === product.id && e.module === "products")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const boundUpdate = updateProductAction.bind(null, product.id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-page-title text-slate-900">{product.name}</h1>
          <Badge className={product.is_active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}>
            {product.is_active ? "Active" : "Inactive"}
          </Badge>
        </div>
        <p className="text-sm text-slate-500">
          Created by {creator?.full_name || "—"} on {formatDateTime(product.created_at)}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Product details</CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert kind="error" className="mb-4">
              {error}
            </Alert>
          )}
          {created && (
            <Alert kind="success" className="mb-4">
              Product created successfully.
            </Alert>
          )}
          {updated && (
            <Alert kind="success" className="mb-4">
              Product updated successfully.
            </Alert>
          )}
          <form action={boundUpdate} className="space-y-4">
            <div>
              <Label htmlFor="name">Product name</Label>
              <Input id="name" name="name" defaultValue={product.name} disabled={!canEdit} required />
            </div>
            <div>
              <Label htmlFor="code">Product code</Label>
              <Input id="code" name="code" defaultValue={product.code || ""} disabled={!canEdit} />
            </div>
            <div>
              <Label htmlFor="pancake_variation_id">Pancake variation ID / SKU</Label>
              <Input
                id="pancake_variation_id"
                name="pancake_variation_id"
                defaultValue={product.pancake_variation_id || ""}
                disabled={!canEdit}
                placeholder="Leave blank to send as a Pancake quick-add product"
              />
              <p className="mt-1 text-xs text-slate-400">
                Links this product to one in your Pancake catalog, so the order draws down Pancake stock. Paste the
                variation ID (or its SKU) exactly as Pancake shows it — a product name will be rejected. Leave it blank
                and the order is sent as a Pancake quick-add (one-time) product instead, provided that option is enabled
                on the integration account.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <LinkButton href="/products" variant="outline">
                Back
              </LinkButton>
              {canEdit && <Button type="submit">Save Changes</Button>}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-slate-100">
            {history.map((e) => (
              <li key={e.id} className="px-5 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-700">
                    {e.user_id ? byId.get(e.user_id) || "Unknown" : "System"}
                  </span>
                  <span className="text-xs text-slate-400">{formatDateTime(e.created_at)}</span>
                </div>
                <p className="text-slate-500">
                  <span className="inline-flex rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                    {e.action}
                  </span>
                </p>
                {Boolean(e.previous_value || e.updated_value) && (
                  <p className="mt-1 text-xs text-slate-400">
                    {e.previous_value ? `Previous: ${summarizeValue(e.previous_value)}` : ""}
                    {e.previous_value && e.updated_value ? " · " : ""}
                    {e.updated_value ? `Updated: ${summarizeValue(e.updated_value)}` : ""}
                  </p>
                )}
              </li>
            ))}
            {history.length === 0 && <li className="px-5 py-6 text-center text-sm text-slate-400">No history yet.</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
