"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Input, Label, Select, Textarea, FieldError } from "@/components/ui/Field";
import { Button, LinkButton } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { OrderItemsEditor, type EditorLine, type EditorProduct } from "@/components/OrderItemsEditor";
import { AddressSelect } from "@/components/AddressSelect";
import { LEAD_STATUS_LABELS, LEAD_STATUSES, PAYMENT_METHOD_SUGGESTIONS, ORDER_TAGS, selectableStatuses } from "@/lib/validation";
import type { Order, Profile } from "@/lib/types";

interface FormState {
  customer_name: string;
  customer_phone: string;
  purok: string;
  barangay: string;
  city: string;
  province: string;
  // Pancake's own address IDs — what the server validates and forwards.
  pancake_province_id: string;
  pancake_district_id: string;
  pancake_commune_id: string;
  landmark: string;
  previous_order_date: string;
  previous_order_product: string;
  previous_order_amount: string;
  previous_order_note: string;
  previous_order_status: string;
  product_id: string;
  unit_price: string;
  discount: string;
  variant: string;
  shipping_fee: string;
  courier: string;
  payment_method: string;
  order_source: string;
  tag: string;
  status: string;
  agent_id: string;
  notes: string;
}

function snapshotFrom(order: Order): FormState {
  return {
    customer_name: order.customer_name,
    customer_phone: order.customer_phone,
    purok: order.purok,
    barangay: order.barangay,
    city: order.city,
    province: order.province,
    pancake_province_id: order.pancake_province_id || "",
    pancake_district_id: order.pancake_district_id || "",
    pancake_commune_id: order.pancake_commune_id || "",
    landmark: order.landmark,
    previous_order_date: order.previous_order_date || "",
    previous_order_product: order.previous_order_product || "",
    previous_order_amount: order.previous_order_amount != null ? String(order.previous_order_amount) : "",
    previous_order_note: order.previous_order_note || "",
    previous_order_status: order.previous_order_status || "",
    product_id: order.product_id || "",
    unit_price: order.unit_price != null ? String(order.unit_price) : "",
    discount: order.discount ? String(order.discount) : "",
    variant: order.variant || "",
    shipping_fee: order.shipping_fee != null ? String(order.shipping_fee) : "",
    courier: order.courier || "",
    payment_method: order.payment_method || "",
    order_source: order.order_source || "",
    tag: order.tag || "",
    status: order.status,
    agent_id: order.agent_id,
    notes: order.notes,
  };
}

const FIELD_LABELS: Record<string, string> = {
  customer_name: "Customer Name",
  customer_phone: "Phone Number",
  barangay: "Barangay",
  city: "City",
  province: "Province",
  product_id: "New Product Order",
  unit_price: "Unit Price",
};

export function LeadEditForm({
  order,
  action,
  canEdit,
  canReassign,
  canTag,
  canSeePreviousOrderFields,
  canSetFulfillmentStatus = false,
  agents,
  activeProducts,
  initialLines,
}: {
  order: Order;
  action: (formData: FormData) => void | Promise<void>;
  canEdit: boolean;
  canReassign: boolean;
  canTag: boolean;
  canSeePreviousOrderFields: boolean;
  /** Full-access users may set Pancake-owned fulfillment statuses by hand. */
  canSetFulfillmentStatus?: boolean;
  agents: Pick<Profile, "id" | "full_name" | "username">[];
  activeProducts: EditorProduct[];
  /** The order's existing lines, so an edit starts from what is there rather
   * than from a blank row. */
  initialLines: EditorLine[];
}) {
  const initial = useMemo(() => snapshotFrom(order), [order]);
  const [form, setForm] = useState<FormState>(initial);
  const [missing, setMissing] = useState<string[]>([]);
  const [lines, setLines] = useState<EditorLine[]>(initialLines);
  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!isDirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    }
    function handleClick(e: MouseEvent) {
      if (!isDirtyRef.current) return;
      const anchor = (e.target as HTMLElement)?.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      const ok = window.confirm("You have unsaved changes on this lead. Leave without saving?");
      if (!ok) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleClick, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleClick, true);
    };
  }, []);

  function update<K extends keyof FormState>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (form.status === "packaging") {
      const missingFields: string[] = [];
      if (!form.customer_name.trim()) missingFields.push("customer_name");
      if (!form.customer_phone.trim()) missingFields.push("customer_phone");
      if (!form.barangay.trim()) missingFields.push("barangay");
      if (!form.city.trim()) missingFields.push("city");
      if (!form.province.trim()) missingFields.push("province");
      // Asked of the lines now rather than the retired single-product fields.
      // A line with a product but no price is the same omission the server
      // will reject, so it is caught here too.
      const filled = lines.filter((line) => line.product_id);
      if (filled.length === 0) missingFields.push("product_id");
      else if (filled.every((line) => line.unit_price.trim() === "")) missingFields.push("unit_price");
      if (missingFields.length > 0) {
        e.preventDefault();
        setMissing(missingFields);
        return;
      }
    }
    setMissing([]);
  }

  const err = (key: string) => (missing.includes(key) ? "border-red-400 focus:border-red-500 focus:ring-red-500" : "");

  return (
    <form action={action} onSubmit={handleSubmit} className="space-y-4">
      {missing.length > 0 && (
        <Alert kind="error">
          Missing required fields for Packaging: {missing.map((k) => FIELD_LABELS[k] || k).join(", ")}
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="customer_name">Customer name</Label>
          <Input
            id="customer_name"
            name="customer_name"
            value={form.customer_name}
            onChange={(e) => update("customer_name", e.target.value)}
            disabled={!canEdit}
            className={err("customer_name")}
            required
          />
        </div>
        <div>
          <Label htmlFor="customer_phone">Phone number</Label>
          <Input
            id="customer_phone"
            name="customer_phone"
            value={form.customer_phone}
            onChange={(e) => update("customer_phone", e.target.value)}
            disabled={!canEdit}
            className={err("customer_phone")}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="purok">Address / Purok</Label>
        <Input id="purok" name="purok" value={form.purok} onChange={(e) => update("purok", e.target.value)} disabled={!canEdit} />
      </div>

      {/* Province/City/Barangay come from Pancake's own address data, so a
          selection here is one Pancake recognises. Free-text entry is gone:
          typed names were never sent as IDs, which is what left the location
          empty on Pancake's side. */}
      <AddressSelect
        value={{
          province_id: form.pancake_province_id,
          province: form.province,
          city_id: form.pancake_district_id,
          city: form.city,
          barangay_id: form.pancake_commune_id,
          barangay: form.barangay,
        }}
        onChange={(next) =>
          setForm((prev) => ({
            ...prev,
            pancake_province_id: next.province_id,
            province: next.province,
            pancake_district_id: next.city_id,
            city: next.city,
            pancake_commune_id: next.barangay_id,
            barangay: next.barangay,
          }))
        }
        disabled={!canEdit}
        errors={{
          province: missing.includes("province") ? "Province is required." : undefined,
          city: missing.includes("city") ? "City / Municipality is required." : undefined,
          barangay: missing.includes("barangay") ? "Barangay is required." : undefined,
        }}
      />
      <div>
        <Label htmlFor="landmark">Landmark</Label>
        <Input id="landmark" name="landmark" value={form.landmark} onChange={(e) => update("landmark", e.target.value)} disabled={!canEdit} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label htmlFor="previous_order_date">Previous order date</Label>
          <Input
            id="previous_order_date"
            name="previous_order_date"
            type="date"
            value={form.previous_order_date}
            onChange={(e) => update("previous_order_date", e.target.value)}
            disabled={!canSeePreviousOrderFields}
          />
        </div>
        <div>
          <Label htmlFor="previous_order_product">Previous order product</Label>
          <Input
            id="previous_order_product"
            name="previous_order_product"
            value={form.previous_order_product}
            onChange={(e) => update("previous_order_product", e.target.value)}
            disabled={!canSeePreviousOrderFields}
          />
        </div>
        <div>
          <Label htmlFor="previous_order_amount">Previous order amount</Label>
          <Input
            id="previous_order_amount"
            name="previous_order_amount"
            type="number"
            min={0}
            step={0.01}
            value={form.previous_order_amount}
            onChange={(e) => update("previous_order_amount", e.target.value)}
            disabled={!canSeePreviousOrderFields}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="previous_order_status">Previous status</Label>
        <Select
          id="previous_order_status"
          name="previous_order_status"
          value={form.previous_order_status}
          onChange={(e) => update("previous_order_status", e.target.value)}
          disabled={!canSeePreviousOrderFields}
        >
          <option value="">—</option>
          {/* A value an import brought in that is not one of ours would
              otherwise vanish the moment this form is saved. */}
          {form.previous_order_status &&
            !(LEAD_STATUSES as readonly string[]).includes(form.previous_order_status) && (
              <option value={form.previous_order_status}>{form.previous_order_status}</option>
            )}
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {LEAD_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <Label htmlFor="previous_order_note">Previous note</Label>
        <Textarea
          id="previous_order_note"
          name="previous_order_note"
          rows={2}
          value={form.previous_order_note}
          onChange={(e) => update("previous_order_note", e.target.value)}
          disabled={!canSeePreviousOrderFields}
          placeholder="What was noted on the customer's last order"
        />
      </div>
      {!canSeePreviousOrderFields && (
        <p className="-mt-2 text-xs text-slate-400">Previous order information is informational and can only be corrected by an Administrator.</p>
      )}

      <div>
        <Label htmlFor="items">Products</Label>
        <OrderItemsEditor
          products={activeProducts}
          initialLines={initialLines}
          shippingFee={Number(form.shipping_fee) || 0}
          disabled={!canEdit}
          onLinesChange={setLines}
        />
        {missing.includes("product_id") && <FieldError>At least one product is required.</FieldError>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="shipping_fee">Shipping fee</Label>
          <Input
            id="shipping_fee"
            name="shipping_fee"
            type="number"
            min={0}
            step={0.01}
            inputMode="decimal"
            value={form.shipping_fee}
            onChange={(e) => update("shipping_fee", e.target.value)}
            disabled={!canEdit}
          />
        </div>
        <div>
          <Label htmlFor="courier">Courier</Label>
          <Input id="courier" name="courier" value={form.courier} onChange={(e) => update("courier", e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <Label htmlFor="payment_method">Payment method</Label>
          <Input
            id="payment_method"
            name="payment_method"
            list="payment_method_options"
            value={form.payment_method}
            onChange={(e) => update("payment_method", e.target.value)}
            disabled={!canEdit}
          />
          <datalist id="payment_method_options">
            {PAYMENT_METHOD_SUGGESTIONS.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
        <div>
          <Label htmlFor="order_source">Order source</Label>
          <Input
            id="order_source"
            name="order_source"
            value={form.order_source}
            onChange={(e) => update("order_source", e.target.value)}
            disabled={!canEdit}
            placeholder="Optional Pancake routing tag"
          />
        </div>
        <div>
          <Label htmlFor="tag">Tag</Label>
          {/* A supervisor's mark on the order. Agents see it and cannot change
              it, so the control is disabled for them — and refused server-side
              as well, because a disabled input is not a permission. */}
          <Select
            id="tag"
            name="tag"
            value={form.tag}
            onChange={(e) => update("tag", e.target.value)}
            disabled={!canEdit || !canTag}
          >
            <option value="">No tag</option>
            {ORDER_TAGS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          {!canTag && <p className="mt-1 text-xs text-slate-400">Set by Team Leads and Administrators.</p>}
        </div>
      </div>

      <div>
        <Label htmlFor="status">Status</Label>
        <Select id="status" name="status" value={form.status} onChange={(e) => update("status", e.target.value)} disabled={!canEdit}>
          {selectableStatuses(canSetFulfillmentStatus, order.status).map((s) => (
            <option key={s} value={s}>
              {LEAD_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <Label htmlFor="agent_id">Agent</Label>
        {canReassign ? (
          <Select id="agent_id" name="agent_id" value={form.agent_id} onChange={(e) => update("agent_id", e.target.value)}>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.full_name} ({a.username})
              </option>
            ))}
          </Select>
        ) : (
          <>
            <Input value={`${agents.find((a) => a.id === form.agent_id)?.full_name || "—"}`} disabled />
            <input type="hidden" name="agent_id" value={form.agent_id} />
          </>
        )}
        {!canReassign && <p className="mt-1 text-xs text-slate-400">Only an Administrator can reassign a lead to a different agent.</p>}
      </div>

      <div>
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" rows={3} value={form.notes} onChange={(e) => update("notes", e.target.value)} disabled={!canEdit} />
      </div>

      <div className="flex items-center justify-between gap-2 pt-2">
        <span className="text-xs text-slate-400">{isDirty ? "You have unsaved changes." : ""}</span>
        <div className="flex gap-2">
          <LinkButton href="/leads" variant="outline">
            Back
          </LinkButton>
          {canEdit && <Button type="submit">Save Changes</Button>}
        </div>
      </div>
    </form>
  );
}
