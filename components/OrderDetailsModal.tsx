"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select, Textarea } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";
import { ProductCombobox } from "@/components/ProductCombobox";
import { StatusBadge, LEAD_STATUS_STYLES } from "@/components/ui/Badge";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { LEAD_STATUSES, LEAD_STATUS_LABELS } from "@/lib/validation";
import type { Order, OrderStatus } from "@/lib/types";

interface EditForm {
  customer_name: string;
  customer_phone: string;
  purok: string;
  barangay: string;
  city: string;
  province: string;
  landmark: string;
  product_id: string;
  quantity: string;
  unit_price: string;
  notes: string;
  status: string;
}

function snapshotFrom(order: Order): EditForm {
  return {
    customer_name: order.customer_name,
    customer_phone: order.customer_phone,
    purok: order.purok,
    barangay: order.barangay,
    city: order.city,
    province: order.province,
    landmark: order.landmark,
    product_id: order.product_id || "",
    quantity: String(order.quantity),
    unit_price: order.unit_price != null ? String(order.unit_price) : "",
    notes: order.notes,
    status: order.status,
  };
}

function buildRawFromOrder(o: Order, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    customer_name: o.customer_name,
    customer_phone: o.customer_phone,
    purok: o.purok,
    barangay: o.barangay,
    city: o.city,
    province: o.province,
    landmark: o.landmark,
    previous_order_date: o.previous_order_date || "",
    previous_order_product: o.previous_order_product || "",
    previous_order_amount: o.previous_order_amount,
    product_id: o.product_id || "",
    unit_price: o.unit_price,
    status: o.status,
    notes: o.notes,
    agent_id: o.agent_id,
    quantity: o.quantity,
    ...overrides,
  };
}

const MISSING_PREFIX = "Missing required fields for Ready to Ship: ";

export function OrderDetailsModal({
  order,
  agentName,
  productName,
  latestStatusUpdate,
  activeProducts,
  canEdit,
  fullPageHref,
  onClose,
  onSaved,
}: {
  order: Order;
  agentName: string;
  productName: string;
  latestStatusUpdate: { status: OrderStatus; at: string } | null;
  activeProducts: { id: string; name: string; code: string | null }[];
  canEdit: boolean;
  fullPageHref: string | null;
  onClose: () => void;
  onSaved: (updated: Order) => void;
}) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const initial = useMemo(() => snapshotFrom(order), [order]);
  const [form, setForm] = useState<EditForm>(initial);
  const [statusDraft, setStatusDraft] = useState<string>(order.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);

  const isDirty = mode === "edit" && JSON.stringify(form) !== JSON.stringify(initial);
  const hasUnsavedChanges = isDirty || statusDraft !== order.status;

  function update<K extends keyof EditForm>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(raw: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    setMissing([]);
    try {
      const res = await fetch(`/api/leads/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(raw),
      });
      const json = await res.json();
      if (!json.ok) {
        const msg: string = json.error || "Something went wrong.";
        if (msg.startsWith(MISSING_PREFIX)) {
          setMissing(msg.slice(MISSING_PREFIX.length).split(", "));
        }
        setError(msg);
        return;
      }
      onSaved(json.order as Order);
      setMode("view");
      setStatusDraft(json.order.status);
      setError(null);
      setMissing([]);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function handleUpdateStatus() {
    if (statusDraft === order.status) return;
    submit(buildRawFromOrder(order, { status: statusDraft }));
  }

  function handleSaveEdit() {
    submit(
      buildRawFromOrder(order, {
        customer_name: form.customer_name,
        customer_phone: form.customer_phone,
        purok: form.purok,
        barangay: form.barangay,
        city: form.city,
        province: form.province,
        landmark: form.landmark,
        product_id: form.product_id,
        quantity: form.quantity.trim() === "" ? undefined : Number(form.quantity),
        unit_price: form.unit_price.trim() === "" ? null : Number(form.unit_price),
        status: form.status,
        notes: form.notes,
      })
    );
  }

  function handleCancelEdit() {
    setForm(initial);
    setMissing([]);
    setError(null);
    setMode("view");
  }

  function requestClose() {
    if (hasUnsavedChanges) {
      const ok = window.confirm("You have unsaved changes on this lead. Close without saving?");
      if (!ok) return;
    }
    onClose();
  }

  const style = LEAD_STATUS_STYLES[order.status];
  const previewQuantity = Number(form.quantity) || order.quantity;
  const previewUnitPrice = form.unit_price.trim() === "" ? 0 : Number(form.unit_price) || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={requestClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-center justify-between rounded-t-xl ${style.header} px-5 py-3`}>
          <div className="flex items-center gap-2 text-white">
            <h2 className="text-base font-semibold">{order.order_number}</h2>
            <StatusBadge status={order.status} />
          </div>
          <button type="button" onClick={requestClose} className="rounded p-1 text-white/90 hover:bg-black/10" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {error && <Alert kind="error">{error}</Alert>}
          {missing.length > 0 && (
            <Alert kind="error">Missing required fields for Ready to Ship: {missing.join(", ")}</Alert>
          )}

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs uppercase text-slate-400">Order Date</p>
              <p className="text-slate-800">{order.order_date ? formatDate(order.order_date) : "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-400">Agent</p>
              <p className="text-slate-800">{agentName}</p>
            </div>
          </div>

          {mode === "view" ? (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs uppercase text-slate-400">Customer Name</p>
                <p className="text-slate-800">{order.customer_name}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-400">Phone Number</p>
                <p className="text-slate-800">{order.customer_phone || "—"}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs uppercase text-slate-400">Complete Address</p>
                <p className="text-slate-800">
                  {[order.purok, order.barangay, order.city, order.province].filter(Boolean).join(", ") || "—"}
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-xs uppercase text-slate-400">Landmark</p>
                <p className="text-slate-800">{order.landmark || "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-400">Product Ordered</p>
                <p className="text-slate-800">{productName || "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-400">Quantity</p>
                <p className="text-slate-800">{order.quantity}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-400">Unit Price</p>
                <p className="text-slate-800">{order.unit_price != null ? formatCurrency(order.unit_price) : "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-400">Total Amount</p>
                <p className="text-slate-800">{formatCurrency(order.total_amount)}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="m_customer_name">Customer name</Label>
                  <Input id="m_customer_name" value={form.customer_name} onChange={(e) => update("customer_name", e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="m_customer_phone">Phone number</Label>
                  <Input id="m_customer_phone" value={form.customer_phone} onChange={(e) => update("customer_phone", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="m_purok">Purok</Label>
                  <Input id="m_purok" value={form.purok} onChange={(e) => update("purok", e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="m_barangay">Barangay</Label>
                  <Input id="m_barangay" value={form.barangay} onChange={(e) => update("barangay", e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="m_city">City</Label>
                  <Input id="m_city" value={form.city} onChange={(e) => update("city", e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="m_province">Province</Label>
                  <Input id="m_province" value={form.province} onChange={(e) => update("province", e.target.value)} />
                </div>
              </div>
              <div>
                <Label htmlFor="m_landmark">Landmark</Label>
                <Input id="m_landmark" value={form.landmark} onChange={(e) => update("landmark", e.target.value)} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Label htmlFor="m_product_id">Product Ordered</Label>
                  <ProductCombobox
                    name="product_id"
                    products={activeProducts}
                    defaultValue={form.product_id}
                    defaultLabel={productName}
                    onChange={(id) => update("product_id", id)}
                  />
                </div>
                <div>
                  <Label htmlFor="m_unit_price">Unit Price</Label>
                  <Input
                    id="m_unit_price"
                    type="number"
                    min={0}
                    step={0.01}
                    value={form.unit_price}
                    onChange={(e) => update("unit_price", e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="m_quantity">Quantity</Label>
                  <Input
                    id="m_quantity"
                    type="number"
                    min={1}
                    step={1}
                    value={form.quantity}
                    onChange={(e) => update("quantity", e.target.value)}
                  />
                </div>
                <div>
                  <Label>Total Amount (preview)</Label>
                  <Input value={formatCurrency(previewQuantity * previewUnitPrice)} disabled />
                </div>
              </div>
              <div>
                <Label htmlFor="m_status">Status</Label>
                <Select id="m_status" value={form.status} onChange={(e) => update("status", e.target.value)}>
                  {LEAD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {LEAD_STATUS_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="m_notes">Notes</Label>
                <Textarea id="m_notes" rows={3} value={form.notes} onChange={(e) => update("notes", e.target.value)} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3 rounded-lg bg-slate-50 p-3 text-sm">
            <div>
              <p className="text-xs uppercase text-slate-400">Previous Order Date</p>
              <p className="text-slate-700">{order.previous_order_date ? formatDate(order.previous_order_date) : "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-400">Previous Order Product</p>
              <p className="text-slate-700">{order.previous_order_product || "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-400">Previous Order Amount</p>
              <p className="text-slate-700">
                {order.previous_order_amount != null ? formatCurrency(order.previous_order_amount) : "—"}
              </p>
            </div>
          </div>

          {mode === "view" && (
            <div>
              <p className="text-xs uppercase text-slate-400">Notes</p>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{order.notes || "—"}</p>
            </div>
          )}

          <div className="text-xs text-slate-500">
            Latest status update:{" "}
            {latestStatusUpdate ? (
              <>
                <StatusBadge status={latestStatusUpdate.status} /> on {formatDateTime(latestStatusUpdate.at)}
              </>
            ) : (
              "—"
            )}
          </div>

          {canEdit && mode === "view" && (
            <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
              <div className="flex-1">
                <Label htmlFor="m_status_quick">Update Status</Label>
                <Select id="m_status_quick" value={statusDraft} onChange={(e) => setStatusDraft(e.target.value)}>
                  {LEAD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {LEAD_STATUS_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="button" variant="secondary" disabled={saving || statusDraft === order.status} onClick={handleUpdateStatus}>
                {saving ? "Updating…" : "Update Status"}
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-5 py-3">
          <div>{fullPageHref && <Link href={fullPageHref} className="text-xs font-medium text-[var(--brand-primary)] hover:underline">Open full page</Link>}</div>
          <div className="flex gap-2">
            {mode === "view" ? (
              <>
                <Button type="button" variant="outline" onClick={requestClose}>
                  Close
                </Button>
                {canEdit && (
                  <Button type="button" onClick={() => setMode("edit")}>
                    Edit Order
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={handleCancelEdit} disabled={saving}>
                  Cancel
                </Button>
                <Button type="button" onClick={handleSaveEdit} disabled={saving}>
                  {saving ? "Saving…" : "Save Changes"}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
