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
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Add Product</h1>
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
