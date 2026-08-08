"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ProductCombobox } from "@/components/ProductCombobox";
import { Input } from "@/components/ui/Field";
import { formatCurrency } from "@/lib/utils";

/** The products an agent can pick, plus what the line needs to describe
 * itself. `pancake_variation_id` drives the Quick add badge and nothing else. */
export interface EditorProduct {
  id: string;
  name: string;
  code: string | null;
  selling_price: number | null;
  variants: string[] | null;
  pancake_variation_id: string | null;
}

export interface EditorLine {
  product_id: string;
  product_name: string;
  variant: string;
  quantity: string;
  unit_price: string;
  discount: string;
}

/** Rows are keyed by a client-only id rather than by index. Keying by index
 * makes React reuse the wrong inputs when a line is removed from the middle,
 * so the row below inherits the deleted row's typed values. */
interface Row extends EditorLine {
  key: string;
}

let nextKey = 0;
const newKey = () => `line-${nextKey++}`;

const blank = (): Row => ({
  key: newKey(),
  product_id: "",
  product_name: "",
  variant: "",
  quantity: "1",
  unit_price: "",
  discount: "",
});

const num = (value: string) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const lineTotal = (row: EditorLine) => Math.round((num(row.unit_price) * num(row.quantity) - num(row.discount)) * 100) / 100;

/**
 * The products on an order, as a stack of line cards.
 *
 * Posts repeated `item_*` fields, which parseOrderItemFields() zips back into
 * rows — so the form still submits as a plain form and the action reads it
 * without any JSON in between.
 *
 * Every input is uncontrolled-by-name but controlled in state, because the
 * running totals have to update as someone types. The totals shown here are
 * display only; the server recomputes them from the same arithmetic before
 * anything is stored.
 */
export function OrderItemsEditor({
  products,
  initialLines,
  shippingFee = 0,
  disabled,
}: {
  products: EditorProduct[];
  initialLines?: EditorLine[];
  /** Shown in the summary so the grand total matches what will be saved. The
   * field itself lives elsewhere on the order form. */
  shippingFee?: number;
  disabled?: boolean;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    initialLines && initialLines.length > 0 ? initialLines.map((line) => ({ ...line, key: newKey() })) : [blank()]
  );

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const update = (key: string, patch: Partial<EditorLine>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const remove = (key: string) =>
    // Never leave the editor with nothing in it: an empty stack offers no
    // obvious way back, and a blank row is also how the form says "no product
    // yet", which is a legitimate state for a lead.
    setRows((current) => (current.length === 1 ? [blank()] : current.filter((row) => row.key !== key)));

  const subtotal = rows.reduce((sum, row) => sum + lineTotal(row), 0);
  const totalQuantity = rows.reduce((sum, row) => sum + (row.product_id ? num(row.quantity) : 0), 0);
  const filledLines = rows.filter((row) => row.product_id).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <span>
          Products: <strong className="tabular-nums text-slate-800">{filledLines}</strong>
          <span className="mx-2 text-slate-300">|</span>
          Total quantity: <strong className="tabular-nums text-slate-800">{totalQuantity}</strong>
        </span>
        {!disabled && (
          <button
            type="button"
            onClick={() => setRows((current) => [...current, blank()])}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700 hover:border-slate-400"
          >
            <Plus className="h-3.5 w-3.5" /> Add product
          </button>
        )}
      </div>

      {rows.map((row, index) => {
        const product = row.product_id ? byId.get(row.product_id) : undefined;
        const variants = product?.variants || [];
        // Unmapped products forward to Pancake as one-time "quick add" lines
        // rather than catalogue items. Worth surfacing here, because it is a
        // property of the product that only shows up at sync time otherwise.
        const quickAdd = Boolean(product && !product.pancake_variation_id);

        return (
          <div key={row.key} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs tabular-nums text-slate-400">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <ProductCombobox
                      name="item_product_id"
                      products={products}
                      defaultValue={row.product_id}
                      defaultLabel={row.product_name}
                      disabled={disabled}
                      onChange={(productId) => {
                        const picked = byId.get(productId);
                        update(row.key, {
                          product_id: productId,
                          product_name: picked?.name || "",
                          // Pre-fill the catalogue price on first pick, but do
                          // not overwrite a price the agent has already typed
                          // — a negotiated price must survive changing the
                          // variant or correcting a mis-picked product.
                          unit_price: row.unit_price || (picked?.selling_price != null ? String(picked.selling_price) : ""),
                          variant: "",
                        });
                      }}
                    />
                  </div>
                  {quickAdd && (
                    <span
                      className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800"
                      title="Not mapped to a Pancake catalogue product — forwards as a one-time item"
                    >
                      Quick add
                    </span>
                  )}
                </div>

                {variants.length > 0 && (
                  <select
                    name="item_variant"
                    value={row.variant}
                    onChange={(e) => update(row.key, { variant: e.target.value })}
                    disabled={disabled}
                    className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm disabled:bg-slate-50"
                  >
                    <option value="">Select variant…</option>
                    {variants.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                )}
                {/* A product with no variants still has to post the field, or
                    the parallel arrays fall out of step and every line after
                    this one takes the wrong variant. */}
                {variants.length === 0 && <input type="hidden" name="item_variant" value="" />}
              </div>

              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(row.key)}
                  aria-label={`Remove line ${index + 1}`}
                  className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="mt-2 grid grid-cols-2 items-end gap-2 sm:grid-cols-4">
              <div>
                <label className="mb-0.5 block text-[11px] text-slate-500">Unit price</label>
                <Input
                  name="item_unit_price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={row.unit_price}
                  onChange={(e) => update(row.key, { unit_price: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div>
                <label className="mb-0.5 block text-[11px] text-slate-500">Quantity</label>
                <Input
                  name="item_quantity"
                  type="number"
                  min="1"
                  step="1"
                  value={row.quantity}
                  onChange={(e) => update(row.key, { quantity: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div>
                <label className="mb-0.5 block text-[11px] text-slate-500">Discount</label>
                <Input
                  name="item_discount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={row.discount}
                  onChange={(e) => update(row.key, { discount: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="text-right">
                <p className="mb-0.5 text-[11px] text-slate-500">Line total</p>
                <p className="text-sm font-semibold tabular-nums text-slate-900">{formatCurrency(lineTotal(row))}</p>
              </div>
            </div>
          </div>
        );
      })}

      <div className="flex flex-col items-end gap-0.5 border-t border-slate-100 pt-2 text-sm">
        <p className="text-slate-500">
          Subtotal <span className="ml-2 tabular-nums text-slate-800">{formatCurrency(subtotal)}</span>
        </p>
        <p className="text-slate-500">
          Shipping <span className="ml-2 tabular-nums text-slate-800">{formatCurrency(shippingFee)}</span>
        </p>
        <p className="font-semibold text-slate-900">
          Total <span className="ml-2 tabular-nums">{formatCurrency(subtotal + shippingFee)}</span>
        </p>
      </div>
    </div>
  );
}
