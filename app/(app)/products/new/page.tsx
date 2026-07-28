import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Field";
import { Button, LinkButton } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { createProductAction } from "@/lib/actions/products";

export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto max-w-lg">
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
            <div>
              <Label htmlFor="code">Product code</Label>
              <Input id="code" name="code" placeholder="Optional, must be unique" />
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
