"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, ChevronRight, Copy, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select, Textarea } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";
import { ProductCombobox } from "@/components/ProductCombobox";
import { StatusBadge, SyncStatusChip, LEAD_STATUS_STYLES } from "@/components/ui/Badge";
import { cn, formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { LEAD_STATUS_LABELS, PAYMENT_METHOD_SUGGESTIONS, selectableStatuses } from "@/lib/validation";
import { AddressSelect } from "@/components/AddressSelect";
import { CallingPanel } from "@/components/CallingPanel";
import { CallHistory } from "@/components/CallHistory";
import { computeOrderTotal, validateForPancake as computePancakeCheck } from "@/lib/pancake/validate";
import { MAX_ATTEMPTS } from "@/lib/pancake/retry";
import type { CallSession, Order, OrderStatus } from "@/lib/types";

interface EditForm {
  customer_name: string;
  customer_phone: string;
  purok: string;
  barangay: string;
  city: string;
  province: string;
  // PSGC codes travel with the names: the codes are what the server validates,
  // the names are what gets displayed and sent onward.
  province_code: string;
  city_code: string;
  barangay_code: string;
  landmark: string;
  product_id: string;
  variant: string;
  quantity: string;
  unit_price: string;
  discount: string;
  shipping_fee: string;
  courier: string;
  payment_method: string;
  order_source: string;
  notes: string;
  status: string;
}

function snapshotFrom(order: Order): EditForm {
  return {
    customer_name: order.customer_name,
    customer_phone: order.customer_phone,
    purok: order.purok,
    barangay: order.barangay,
    province_code: order.province_code || "",
    city_code: order.city_code || "",
    barangay_code: order.barangay_code || "",
    city: order.city,
    province: order.province,
    landmark: order.landmark,
    product_id: order.product_id || "",
    variant: order.variant || "",
    quantity: String(order.quantity),
    unit_price: order.unit_price != null ? String(order.unit_price) : "",
    discount: order.discount ? String(order.discount) : "",
    shipping_fee: order.shipping_fee != null ? String(order.shipping_fee) : "",
    courier: order.courier || "",
    payment_method: order.payment_method || "",
    order_source: order.order_source || "",
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
    province_code: o.province_code || "",
    city_code: o.city_code || "",
    barangay_code: o.barangay_code || "",
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
    shipping_fee: o.shipping_fee,
    courier: o.courier || "",
    payment_method: o.payment_method || "",
    order_source: o.order_source || "",
    discount: o.discount ?? 0,
    variant: o.variant || "",
    ...overrides,
  };
}

interface SyncHistoryEntry {
  id: string;
  action: string;
  old_status: string | null;
  new_status: string | null;
  request_at: string | null;
  http_status: number | null;
  result: "success" | "failed" | null;
  error_message: string | null;
  source: string | null;
}

const MISSING_PREFIX = "Missing required fields for Packaging: ";

const STEPS = [
  { n: 1 as const, label: "Customer" },
  { n: 2 as const, label: "Products & pricing" },
  { n: 3 as const, label: "Review" },
];

export function OrderDetailsModal({
  order,
  agentName,
  productName,
  latestStatusUpdate,
  activeProducts,
  canEdit,
  canManageIntegrations = false,
  canSeeFulfillment = false,
  canSetFulfillmentStatus = false,
  requiresCallSession = false,
  initialCallSession = null,
  callSessions = [],
  agentNameById = {},
  fullPageHref,
  onClose,
  onSaved,
}: {
  order: Order;
  agentName: string;
  productName: string;
  latestStatusUpdate: { status: OrderStatus; at: string } | null;
  activeProducts: { id: string; name: string; code: string | null; variants?: string[] | null }[];
  canEdit: boolean;
  canManageIntegrations?: boolean;
  /** Fulfillment/Pancake surface is hidden from agents entirely. */
  canSeeFulfillment?: boolean;
  /** Full-access users may set Pancake-owned fulfillment statuses by hand. */
  canSetFulfillmentStatus?: boolean;
  /** Agents must have a calling session open before editing; Management does not. */
  requiresCallSession?: boolean;
  initialCallSession?: CallSession | null;
  callSessions?: CallSession[];
  agentNameById?: Record<string, string>;
  fullPageHref: string | null;
  onClose: () => void;
  onSaved: (updated: Order) => void;
}) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  // Edit mode walks Customer info → Products & pricing → Review.
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const initial = useMemo(() => snapshotFrom(order), [order]);
  const [form, setForm] = useState<EditForm>(initial);
  const [statusDraft, setStatusDraft] = useState<string>(order.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [syncHistoryOpen, setSyncHistoryOpen] = useState(false);
  const [syncHistory, setSyncHistory] = useState<SyncHistoryEntry[] | null>(null);
  const [pancakeAccountName, setPancakeAccountName] = useState<string | null>(null);
  const [syncActionRunning, setSyncActionRunning] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  // The sync panel appears once the order has reached Packaging (Section 4
  // step 5) — before that there is nothing to sync and nothing to report.
  // Agents never see it at all: Pancake sync is fulfillment surface, and the
  // data behind it is withheld from the agent payload server-side too.
  const showSyncPanel =
    canSeeFulfillment &&
    (order.status === "packaging" ||
      Boolean(order.pancake_order_id || order.forwarded_to_pancake_at) ||
      order.pancake_sync_status !== "not_synced");
  const syncNeedsReview = order.pancake_sync_status === "sync_failed" && order.pancake_retry_count >= MAX_ATTEMPTS;

  async function copyPancakeOrderId() {
    if (!order.pancake_order_id) return;
    try {
      await navigator.clipboard.writeText(order.pancake_order_id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1500);
    } catch {
      /* clipboard unavailable — the id stays selectable on screen */
    }
  }

  useEffect(() => {
    // Load account name + history lazily whenever the Pancake section is relevant.
    if (!showSyncPanel) return;
    let cancelled = false;
    fetch(`/api/pancake/orders/${order.id}/sync`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled || !json.ok) return;
        setSyncHistory(json.logs as SyncHistoryEntry[]);
        setPancakeAccountName(json.account_name);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [order.id, order.pancake_sync_status, order.pancake_synced_at, showSyncPanel]);

  async function runSyncAction(mode: "sync_now" | "retry") {
    setSyncActionRunning(true);
    setSyncMessage(null);
    try {
      const res = await fetch(`/api/pancake/orders/${order.id}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const json = await res.json();
      setSyncMessage(json.message || json.error || "Done.");
      // Pull the fresh order row so chips/status update in place.
      const fresh = await fetch(`/api/pancake/orders/${order.id}/sync`).then((r) => r.json());
      if (fresh.ok) {
        setSyncHistory(fresh.logs as SyncHistoryEntry[]);
        setPancakeAccountName(fresh.account_name);
      }
      onSaved({ ...order }); // triggers router.refresh() upstream
    } catch {
      setSyncMessage("Network error. Please try again.");
    } finally {
      setSyncActionRunning(false);
    }
  }

  const isDirty = mode === "edit" && JSON.stringify(form) !== JSON.stringify(initial);
  const hasUnsavedChanges = isDirty || statusDraft !== order.status;

  // Calling session state. `locked` is what disables the controls; the server
  // refuses the same edits independently, so this is only the visible half.
  const [callSession, setCallSession] = useState<CallSession | null>(initialCallSession);
  const [callRemarks, setCallRemarks] = useState("");
  const callActive = Boolean(callSession && callSession.order_id === order.id);
  const blockedBy =
    callSession && callSession.order_id !== order.id
      ? { id: callSession.order_id, order_number: callSession.order_id.slice(0, 8) }
      : null;
  const locked = requiresCallSession && !callActive;

  function update<K extends keyof EditForm>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // --- Live order economics (mirrors the server's computeOrderTotal) --------
  const draftQuantity = Number(form.quantity) || 0;
  const draftUnitPrice = form.unit_price.trim() === "" ? 0 : Number(form.unit_price) || 0;
  const draftDiscount = form.discount.trim() === "" ? 0 : Number(form.discount) || 0;
  const draftShipping = form.shipping_fee.trim() === "" ? 0 : Number(form.shipping_fee) || 0;
  const lineTotal = draftUnitPrice * draftQuantity;
  const grandTotal = computeOrderTotal({
    unit_price: form.unit_price.trim() === "" ? null : draftUnitPrice,
    quantity: draftQuantity,
    discount: draftDiscount,
    shipping_fee: form.shipping_fee.trim() === "" ? null : draftShipping,
  });

  // Review step: exactly what the server will check before sending.
  const selectedProductName =
    activeProducts.find((p) => p.id === form.product_id)?.name || (form.product_id ? productName : "");
  const pancakeCheck = computePancakeCheck({
    customer_name: form.customer_name,
    customer_phone: form.customer_phone,
    barangay: form.barangay,
    city: form.city,
    province: form.province,
    product_name: selectedProductName,
    quantity: draftQuantity,
    unit_price: form.unit_price.trim() === "" ? null : draftUnitPrice,
    discount: draftDiscount,
    shipping_fee: form.shipping_fee.trim() === "" ? null : draftShipping,
  });

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
    submit(buildRawFromOrder(order, { status: statusDraft, call_remarks: callRemarks }));
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
        province_code: form.province_code,
        city_code: form.city_code,
        barangay_code: form.barangay_code,
        landmark: form.landmark,
        product_id: form.product_id,
        variant: form.variant,
        quantity: form.quantity.trim() === "" ? undefined : Number(form.quantity),
        unit_price: form.unit_price.trim() === "" ? null : Number(form.unit_price),
        discount: form.discount.trim() === "" ? 0 : Number(form.discount),
        shipping_fee: form.shipping_fee.trim() === "" ? null : Number(form.shipping_fee),
        courier: form.courier,
        payment_method: form.payment_method,
        order_source: form.order_source,
        status: form.status,
        notes: form.notes,
      })
    );
  }

  function handleCancelEdit() {
    setForm(initial);
    setMissing([]);
    setError(null);
    setStep(1);
    setMode("view");
  }

  function requestClose() {
    if (callActive) {
      const ok = window.confirm(
        "A call is still in progress on this order. Close anyway? The call stays open — use End without update to close it."
      );
      if (!ok) return;
    }
    if (hasUnsavedChanges) {
      const ok = window.confirm("You have unsaved changes on this lead. Close without saving?");
      if (!ok) return;
    }
    onClose();
  }

  const style = LEAD_STATUS_STYLES[order.status];
  // Variants the selected product defines, if any; otherwise the field is free text.
  const productVariants = activeProducts.find((p) => p.id === form.product_id)?.variants || [];

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
          {requiresCallSession && (
            <CallingPanel
              orderId={order.id}
              session={callSession}
              blockedBy={blockedBy}
              onStarted={(s) => setCallSession(s)}
              onEnded={() => {
                setCallSession(null);
                setMode("view");
              }}
              onOpenActive={(id) => {
                window.location.href = `/leads?open_id=${id}`;
              }}
            />
          )}
          {error && <Alert kind="error">{error}</Alert>}
          {missing.length > 0 && (
            <Alert kind="error">Missing required fields for Packaging: {missing.join(", ")}</Alert>
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
              <div>
                <p className="text-xs uppercase text-slate-400">Shipping Fee</p>
                <p className="text-slate-800">{order.shipping_fee != null ? formatCurrency(order.shipping_fee) : "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-400">Courier</p>
                <p className="text-slate-800">{order.courier || "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-400">Payment Method</p>
                <p className="text-slate-800">{order.payment_method || "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-400">Order Source</p>
                <p className="text-slate-800">{order.order_source || "—"}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <ol className="flex items-center gap-1 text-xs font-medium">
                {STEPS.map((s) => (
                  <li key={s.n} className="flex flex-1 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setStep(s.n)}
                      className={cn(
                        "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors",
                        step === s.n
                          ? "bg-[var(--brand-primary-10)] text-[var(--brand-primary)]"
                          : "text-slate-500 hover:bg-slate-50"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px]",
                          step === s.n ? "bg-[var(--brand-primary)] text-white" : "bg-slate-200 text-slate-600"
                        )}
                      >
                        {s.n}
                      </span>
                      {s.label}
                    </button>
                  </li>
                ))}
              </ol>

              {step === 1 && (
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
                  <div>
                    <Label htmlFor="m_purok">Address / Purok</Label>
                    <Input id="m_purok" value={form.purok} onChange={(e) => update("purok", e.target.value)} />
                  </div>
                  {order.address_needs_review && (
                    <Alert kind="info">
                      This lead&apos;s address predates the Province/City/Barangay lists and could not be matched
                      automatically. The original text was{" "}
                      <strong>{[order.barangay, order.city, order.province].filter(Boolean).join(", ") || "—"}</strong> —
                      please re-select it below before Packaging.
                    </Alert>
                  )}
                  <AddressSelect
                    value={{
                      province_code: form.province_code,
                      province: form.province,
                      city_code: form.city_code,
                      city: form.city,
                      barangay_code: form.barangay_code,
                      barangay: form.barangay,
                    }}
                    onChange={(next) =>
                      setForm((prev) => ({
                        ...prev,
                        province_code: next.province_code,
                        province: next.province,
                        city_code: next.city_code,
                        city: next.city,
                        barangay_code: next.barangay_code,
                        barangay: next.barangay,
                      }))
                    }
                  />
                  <div>
                    <Label htmlFor="m_landmark">Landmark</Label>
                    <Input id="m_landmark" value={form.landmark} onChange={(e) => update("landmark", e.target.value)} />
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <Label htmlFor="m_product_id">Product</Label>
                      <ProductCombobox
                        name="product_id"
                        products={activeProducts}
                        defaultValue={form.product_id}
                        defaultLabel={productName}
                        onChange={(id) => update("product_id", id)}
                      />
                    </div>
                    {canSeeFulfillment && (
                    <div>
                      <Label htmlFor="m_variant">Variant</Label>
                      {productVariants.length > 0 ? (
                        <Select id="m_variant" value={form.variant} onChange={(e) => update("variant", e.target.value)}>
                          <option value="">— none —</option>
                          {productVariants.map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Input
                          id="m_variant"
                          value={form.variant}
                          onChange={(e) => update("variant", e.target.value)}
                          placeholder="Optional"
                        />
                      )}
                    </div>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label htmlFor="m_quantity">Quantity</Label>
                      <Input id="m_quantity" type="number" min={1} step={1} value={form.quantity} onChange={(e) => update("quantity", e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="m_unit_price">Unit Price</Label>
                      <Input id="m_unit_price" type="number" min={0} step={0.01} value={form.unit_price} onChange={(e) => update("unit_price", e.target.value)} />
                    </div>
                    {canSeeFulfillment && (
                    <div>
                      <Label htmlFor="m_discount">Discount</Label>
                      <Input id="m_discount" type="number" min={0} step={0.01} value={form.discount} onChange={(e) => update("discount", e.target.value)} />
                    </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {canSeeFulfillment && (
                    <>
                    <div>
                      <Label htmlFor="m_shipping_fee">Shipping Fee</Label>
                      <Input id="m_shipping_fee" type="number" min={0} step={0.01} value={form.shipping_fee} onChange={(e) => update("shipping_fee", e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="m_courier">Courier</Label>
                      <Input id="m_courier" value={form.courier} onChange={(e) => update("courier", e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="m_payment_method">Payment Method</Label>
                      <Input
                        id="m_payment_method"
                        list="m_payment_method_options"
                        value={form.payment_method}
                        onChange={(e) => update("payment_method", e.target.value)}
                      />
                      <datalist id="m_payment_method_options">
                        {PAYMENT_METHOD_SUGGESTIONS.map((p) => (
                          <option key={p} value={p} />
                        ))}
                      </datalist>
                    </div>
                    </>
                    )}
                    <div>
                      <Label htmlFor="m_order_source">Order Source</Label>
                      <Input id="m_order_source" value={form.order_source || "—"} disabled readOnly />
                      <p className="mt-1 text-xs text-slate-400">Set from the assigned agent&apos;s Call Name.</p>
                    </div>
                  </div>
                  <dl className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
                    <div className="flex justify-between text-slate-600">
                      <dt>Line total ({draftQuantity || 0} × {formatCurrency(draftUnitPrice)})</dt>
                      <dd>{formatCurrency(lineTotal)}</dd>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <dt>Discount</dt>
                      <dd>− {formatCurrency(draftDiscount)}</dd>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <dt>Shipping fee</dt>
                      <dd>+ {formatCurrency(draftShipping)}</dd>
                    </div>
                    <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-slate-900">
                      <dt>Grand total</dt>
                      <dd>{formatCurrency(grandTotal)}</dd>
                    </div>
                  </dl>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-3">
                  {pancakeCheck.ok ? (
                    <Alert kind="success">All required fields are present — this order is ready to send to Pancake POS.</Alert>
                  ) : (
                    <Alert kind="error">
                      <p className="font-medium">Complete these before Packaging:</p>
                      <ul className="mt-1 list-inside list-disc">
                        {pancakeCheck.errors.map((e) => (
                          <li key={e.field}>{e.message}</li>
                        ))}
                      </ul>
                    </Alert>
                  )}

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-slate-200 p-3 text-sm">
                    {[
                      ["Customer", form.customer_name],
                      ["Phone", form.customer_phone],
                      ["Address", [form.purok, form.barangay, form.city, form.province].filter(Boolean).join(", ")],
                      ["Landmark", form.landmark],
                      ["Product", [selectedProductName, form.variant].filter(Boolean).join(" — ")],
                      ["Quantity", String(draftQuantity || "")],
                      ["Unit price", form.unit_price === "" ? "" : formatCurrency(draftUnitPrice)],
                      ["Discount", formatCurrency(draftDiscount)],
                      ["Shipping fee", form.shipping_fee === "" ? "" : formatCurrency(draftShipping)],
                      ["Total amount", formatCurrency(grandTotal)],
                      ["Payment method", form.payment_method],
                      ["Courier", form.courier],
                      ["Order source", form.order_source],
                      ["Agent", agentName],
                    ].map(([label, value]) => (
                      <div key={label as string} className={label === "Address" ? "col-span-2" : undefined}>
                        <dt className="text-xs uppercase text-slate-400">{label}</dt>
                        <dd className={value ? "text-slate-800" : "text-slate-400"}>{value || "—"}</dd>
                      </div>
                    ))}
                  </dl>

                  <div>
                    <Label htmlFor="m_status">Status</Label>
                    <Select id="m_status" value={form.status} onChange={(e) => update("status", e.target.value)}>
                      {selectableStatuses(canSetFulfillmentStatus, order.status).map((s) => (
                        <option key={s} value={s} disabled={s === "packaging" && !pancakeCheck.ok}>
                          {LEAD_STATUS_LABELS[s]}
                          {s === "packaging" && !pancakeCheck.ok ? " (fields missing)" : ""}
                        </option>
                      ))}
                    </Select>
                    {!canSetFulfillmentStatus && (
                      <p className="mt-1 text-xs text-slate-400">
                        Fulfillment statuses are set by Pancake POS once the order is sent.
                      </p>
                    )}
                    {form.status === "packaging" && (
                      <p className="mt-1 text-xs text-slate-500">
                        Saving with Packaging sends this order to Pancake POS.
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="m_notes">Notes</Label>
                    <Textarea id="m_notes" rows={3} value={form.notes} onChange={(e) => update("notes", e.target.value)} />
                  </div>
                </div>
              )}

              <div className="flex justify-between border-t border-slate-100 pt-3">
                <Button type="button" variant="outline" size="sm" disabled={step === 1} onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}>
                  Back
                </Button>
                <Button type="button" variant="secondary" size="sm" disabled={step === 3} onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)}>
                  Next
                </Button>
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

          {showSyncPanel && (
            <div className="space-y-3 rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase text-slate-500">Pancake POS Sync</p>
                <SyncStatusChip status={order.pancake_sync_status} needsReview={syncNeedsReview} />
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs uppercase text-slate-400">Pancake Account</p>
                  <p className="text-slate-800">{pancakeAccountName || "—"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-400">Pancake POS Order ID</p>
                  {order.pancake_order_id ? (
                    <div className="flex items-center gap-1.5">
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-800">{order.pancake_order_id}</code>
                      <button
                        type="button"
                        onClick={copyPancakeOrderId}
                        className="text-slate-400 hover:text-[var(--brand-primary)]"
                        aria-label="Copy Pancake POS Order ID"
                        title="Copy"
                      >
                        {copiedId ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  ) : (
                    <p className="text-slate-400">—</p>
                  )}
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-400">Pancake Status</p>
                  <p className="text-slate-800">{order.pancake_status || "—"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-400">Internal Status</p>
                  <StatusBadge status={order.status} />
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-400">Last Sync Attempt</p>
                  <p className="text-slate-800">
                    {order.pancake_last_sync_attempt_at ? formatDateTime(order.pancake_last_sync_attempt_at) : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-400">Synced At</p>
                  <p className="text-slate-800">{order.pancake_synced_at ? formatDateTime(order.pancake_synced_at) : "—"}</p>
                </div>
                {order.pancake_retry_count > 0 && (
                  <div className="col-span-2">
                    <p className="text-xs uppercase text-slate-400">Attempts</p>
                    <p className="text-slate-800">
                      {order.pancake_retry_count} of {MAX_ATTEMPTS}
                    </p>
                  </div>
                )}
              </div>
              {order.pancake_sync_error && <Alert kind="error">Last sync error: {order.pancake_sync_error}</Alert>}
              {syncMessage && <Alert kind="info">{syncMessage}</Alert>}

              <button
                type="button"
                onClick={() => setSyncHistoryOpen((v) => !v)}
                className="flex items-center gap-1 text-xs font-medium text-[var(--brand-primary)] hover:underline"
              >
                {syncHistoryOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Sync History {syncHistory ? `(${syncHistory.length})` : ""}
              </button>
              {syncHistoryOpen && (
                <ul className="max-h-48 space-y-1.5 overflow-y-auto text-xs text-slate-600">
                  {(syncHistory || []).map((h) => (
                    <li key={h.id} className="rounded border border-slate-100 px-2 py-1.5">
                      <span className={h.result === "failed" ? "font-medium text-red-600" : "font-medium text-green-700"}>
                        {h.action.replaceAll("_", " ")}
                      </span>{" "}
                      · {h.source ? h.source.replaceAll("_", " ") : "—"} · {formatDateTime(h.request_at)}
                      {h.old_status || h.new_status ? (
                        <> · {h.old_status || "—"} → {h.new_status || "—"}</>
                      ) : null}
                      {h.error_message && <p className="mt-0.5 text-red-500">{h.error_message}</p>}
                    </li>
                  ))}
                  {(!syncHistory || syncHistory.length === 0) && <li className="text-slate-400">No sync history yet.</li>}
                </ul>
              )}

              {canManageIntegrations && (
                <div className="flex gap-2 border-t border-slate-100 pt-2">
                  <Button type="button" variant="outline" size="sm" disabled={syncActionRunning} onClick={() => runSyncAction("sync_now")}>
                    {syncActionRunning ? "Working…" : "Sync Now"}
                  </Button>
                  {order.pancake_sync_status === "sync_failed" && (
                    <Button type="button" variant="secondary" size="sm" disabled={syncActionRunning} onClick={() => runSyncAction("retry")}>
                      Retry Sync
                    </Button>
                  )}
                </div>
              )}
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
                <Select id="m_status_quick" value={statusDraft} onChange={(e) => setStatusDraft(e.target.value)} disabled={locked}>
                  {selectableStatuses(canSetFulfillmentStatus, order.status).map((s) => (
                    <option key={s} value={s}>
                      {LEAD_STATUS_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={locked || saving || statusDraft === order.status}
                onClick={handleUpdateStatus}
              >
                {saving ? "Updating…" : "Update Status"}
              </Button>
              {callActive && (
                <div className="w-full">
                  <Label htmlFor="m_call_remarks">Call remarks (saved with this call)</Label>
                  <Textarea
                    id="m_call_remarks"
                    rows={2}
                    value={callRemarks}
                    onChange={(e) => setCallRemarks(e.target.value)}
                    placeholder="What was discussed on this call?"
                  />
                </div>
              )}
            </div>
          )}

          {callSessions.length > 0 && (
            <div className="border-t border-slate-100 pt-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Call History</p>
              <CallHistory sessions={callSessions} agentNameById={agentNameById} />
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
                  <Button type="button" disabled={locked} onClick={() => setMode("edit")}>
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
