import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Label, Select, Textarea } from "@/components/ui/Field";
import { Button, LinkButton } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ProductCombobox } from "@/components/ProductCombobox";
import { createLeadAction } from "@/lib/actions/leads";
import { allowedAssigneeIds } from "@/lib/order-access";
import { getCurrentUser } from "@/lib/auth";
import { readDb } from "@/lib/db";
import { isFullAccess } from "@/lib/permissions";
import { PRE_SALE_STATUSES, LEAD_STATUS_LABELS, PAYMENT_METHOD_SUGGESTIONS } from "@/lib/validation";

export default async function NewLeadPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDb();
  const allowedIds = new Set(allowedAssigneeIds(user, db));
  const agents = db.profiles.filter((p) => p.is_active && allowedIds.has(p.id));
  const canReassign = isFullAccess(user.role);
  const activeProducts = db.products.filter((p) => p.is_active).map((p) => ({ id: p.id, name: p.name, code: p.code }));

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-xl font-semibold text-slate-900">New Lead</h1>
      <Card>
        <CardHeader>
          <CardTitle>Lead details</CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert kind="error" className="mb-4">
              {error}
            </Alert>
          )}
          <form action={createLeadAction} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="customer_name">Customer name</Label>
                <Input id="customer_name" name="customer_name" required />
              </div>
              <div>
                <Label htmlFor="customer_phone">Phone number</Label>
                <Input id="customer_phone" name="customer_phone" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="purok">Purok</Label>
                <Input id="purok" name="purok" />
              </div>
              <div>
                <Label htmlFor="barangay">Barangay</Label>
                <Input id="barangay" name="barangay" />
              </div>
              <div>
                <Label htmlFor="city">City</Label>
                <Input id="city" name="city" />
              </div>
              <div>
                <Label htmlFor="province">Province</Label>
                <Input id="province" name="province" />
              </div>
            </div>
            <div>
              <Label htmlFor="landmark">Landmark</Label>
              <Input id="landmark" name="landmark" />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="previous_order_date">Previous order date</Label>
                <Input id="previous_order_date" name="previous_order_date" type="date" />
              </div>
              <div>
                <Label htmlFor="previous_order_product">Previous order product</Label>
                <Input id="previous_order_product" name="previous_order_product" />
              </div>
              <div>
                <Label htmlFor="previous_order_amount">Previous order amount</Label>
                <Input id="previous_order_amount" name="previous_order_amount" type="number" min={0} step={0.01} />
              </div>
            </div>
            <p className="-mt-2 text-xs text-slate-400">
              Leave blank to auto-fill from this customer&apos;s most recent packaged lead, matched by phone number.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="product_id">New Product Order</Label>
                <ProductCombobox name="product_id" products={activeProducts} />
              </div>
              <div>
                <Label htmlFor="unit_price">Unit price</Label>
                <Input id="unit_price" name="unit_price" type="number" min={0} step={0.01} inputMode="decimal" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="variant">Variant</Label>
                <Input id="variant" name="variant" placeholder="Optional" />
              </div>
              <div>
                <Label htmlFor="discount">Discount</Label>
                <Input id="discount" name="discount" type="number" min={0} step={0.01} inputMode="decimal" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="shipping_fee">Shipping fee</Label>
                <Input id="shipping_fee" name="shipping_fee" type="number" min={0} step={0.01} inputMode="decimal" />
              </div>
              <div>
                <Label htmlFor="courier">Courier</Label>
                <Input id="courier" name="courier" />
              </div>
              <div>
                <Label htmlFor="payment_method">Payment method</Label>
                <Input id="payment_method" name="payment_method" list="payment_method_options" />
                <datalist id="payment_method_options">
                  {PAYMENT_METHOD_SUGGESTIONS.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>
              <div>
                <Label htmlFor="order_source">Order source</Label>
                <Input id="order_source" name="order_source" placeholder="Optional Pancake routing tag" />
              </div>
            </div>

            <div>
              <Label htmlFor="status">Status</Label>
              {/* Fulfillment statuses are Pancake-driven and require a prior
                  Packaging — a brand-new lead can only start pre-sale. */}
              <Select id="status" name="status" defaultValue="new">
                {PRE_SALE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {LEAD_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="agent_id">Agent</Label>
              {canReassign ? (
                <Select id="agent_id" name="agent_id" defaultValue={user.id}>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.full_name} ({a.username})
                    </option>
                  ))}
                </Select>
              ) : (
                <>
                  <Input value={`${user.full_name} (${user.username})`} disabled />
                  <input type="hidden" name="agent_id" value={user.id} />
                </>
              )}
              <p className="mt-1 text-xs text-slate-400">This determines whose performance metrics the sale counts toward.</p>
            </div>

            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" rows={3} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <LinkButton href="/leads" variant="outline">
                Cancel
              </LinkButton>
              <Button type="submit">Save Lead</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
