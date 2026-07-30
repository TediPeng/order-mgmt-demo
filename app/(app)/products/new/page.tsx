import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Label, Select } from "@/components/ui/Field";
import { Button, LinkButton } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { createProductAction } from "@/lib/actions/products";
import { PRODUCT_STATUSES, PRODUCT_STATUS_LABELS } from "@/lib/types";

export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-page-title text-slate-900">Add Product</h1>
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
          <form action={createProductAction} className="space-y-4">
            <div>
              <Label htmlFor="name">Product name</Label>
              <Input id="name" name="name" required />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="code">Product code</Label>
                <Input id="code" name="code" placeholder="Optional, must be unique" />
              </div>
              <div>
                <Label htmlFor="sku">SKU</Label>
                <Input id="sku" name="sku" placeholder="Optional, must be unique" />
              </div>
              <div>
                <Label htmlFor="unit">Unit</Label>
                <Input id="unit" name="unit" placeholder="pc, box, bottle" />
              </div>
              <div>
                <Label htmlFor="status">Status</Label>
                <Select id="status" name="status" defaultValue="active">
                  {PRODUCT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {PRODUCT_STATUS_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="selling_price">Selling price</Label>
                <Input id="selling_price" name="selling_price" type="number" min="0" step="0.01" />
              </div>
              <div>
                <Label htmlFor="stock_quantity">Stock quantity</Label>
                <Input id="stock_quantity" name="stock_quantity" type="number" min="0" step="1" />
              </div>
            </div>
            <div>
              <Label htmlFor="pancake_variation_id">Pancake variation ID / SKU</Label>
              <Input id="pancake_variation_id" name="pancake_variation_id" placeholder="Optional — blank sends a quick-add product" />
              <p className="mt-1 text-xs text-slate-400">
                Links this product to your Pancake catalog so orders draw down Pancake stock. Leave blank to send it as a
                Pancake quick-add (one-time) product instead.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <LinkButton href="/products" variant="outline">
                Cancel
              </LinkButton>
              <Button type="submit">Save Product</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
