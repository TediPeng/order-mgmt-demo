"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, ChevronRight, ChevronUp, Copy, Maximize2, Minimize2, Star } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select, Textarea } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";
import { OrderItemsEditor, type EditorLine } from "@/components/OrderItemsEditor";
import { summarizeItems, totalsFor } from "@/lib/order-totals";
import { StatusBadge, SyncStatusChip, LEAD_STATUS_STYLES } from "@/components/ui/Badge";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { LEAD_STATUS_LABELS, LEAD_STATUSES, selectableStatuses } from "@/lib/validation";
import { isOrderLocked, SYNCED_LOCK_MESSAGE } from "@/lib/lead-workflow";
import { useCallSession } from "@/components/CallSessionProvider";
import { isPendingOrderId, PANCAKE_SYNC_SOURCE_LABELS, shortOrderId, type PancakeSyncSource } from "@/lib/types";
import { AddressSelect } from "@/components/AddressSelect";
import { CallingPanel } from "@/components/CallingPanel";
import { CallHistory } from "@/components/CallHistory";
import { DuplicateBlockDialog, type DuplicateWarning } from "@/components/DuplicateBlockDialog";
import { validateForPancake as computePancakeCheck } from "@/lib/pancake/validate";
import { MAX_ATTEMPTS } from "@/lib/pancake/retry";
import { buildRawFromOrder } from "@/lib/lead-payload";
import { tagRegularCustomerAction } from "@/lib/actions/regular-customers";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmitButton";
import type { CallSession, Order, OrderStatus } from "@/lib/types";

interface EditForm {
  customer_name: string;
  customer_phone: string;
  purok: string;
  barangay: string;
  city: string;
  province: string;
  // Pancake's own address IDs travel with the names: the IDs are what the
  // server validates and what gets sent to Pancake, the names are what the app
  // displays.
  pancake_province_id: string;
  pancake_district_id: string;
  pancake_commune_id: string;
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
    pancake_province_id: order.pancake_province_id || "",
    pancake_district_id: order.pancake_district_id || "",
    pancake_commune_id: order.pancake_commune_id || "",
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

/** Previous Status is a text column (an import may name a status this system
 * does not have), so anything rendered as a badge has to be checked first. */
function isKnownStatus(value: string | null): value is OrderStatus {
  return !!value && (LEAD_STATUSES as readonly string[]).includes(value);
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

export function OrderDetailsModal({
  order,
  agentName,
  productName,
  latestStatusUpdate,
  activeProducts,
  initialLines,
  canEdit,
  canManageIntegrations = false,
  canSeeFulfillment = false,
  canSetFulfillmentStatus = false,
  duplicateWarnings = [],
  canOverrideDuplicate = false,
  canTagRegular = false,
  requiresCallSession = false,
  callSessions = [],
  agentNameById = {},
  fullPageHref,
  onClose,
  onSaved,
}: {
  order: Order;
  agentName: string;
  productName: string;
  latestStatusUpdate: { status: OrderStatus; from: string | null; at: string } | null;
  activeProducts: {
    id: string;
    name: string;
    code: string | null;
    variants: string[] | null;
    selling_price: number | null;
    pancake_variation_id: string | null;
  }[];
  /** The order's existing lines, so opening Edit starts from what is on the
   * order rather than a blank row. */
  initialLines: EditorLine[];
  canEdit: boolean;
  canManageIntegrations?: boolean;
  /** Fulfillment/Pancake surface is hidden from agents entirely. */
  canSeeFulfillment?: boolean;
  /** Full-access users may set Pancake-owned fulfillment statuses by hand. */
  canSetFulfillmentStatus?: boolean;
  /** Team Lead and above may save past a duplicate; an agent may not. */
  canOverrideDuplicate?: boolean;
  /** Whether to offer Make Regular Customer in the footer. */
  canTagRegular?: boolean;
  /** Possible duplicates for this customer. Shown to the agent too now: they
   * are the one person who can still stop before a second agent works a
   * customer somebody else already has. */
  duplicateWarnings?: DuplicateWarning[];
  /** Agents must have a calling session open before editing; Management does not. */
  requiresCallSession?: boolean;
  callSessions?: CallSession[];
  agentNameById?: Record<string, string>;
  fullPageHref: string | null;
  onClose: () => void;
  onSaved: (updated: Order) => void;
}) {
  const initial = useMemo(() => snapshotFrom(order), [order]);
  const [form, setForm] = useState<EditForm>(initial);
  const [lines, setLines] = useState<EditorLine[]>(initialLines);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [syncHistoryOpen, setSyncHistoryOpen] = useState(false);
  const [syncHistory, setSyncHistory] = useState<SyncHistoryEntry[] | null>(null);
  const [pancakeAccountName, setPancakeAccountName] = useState<string | null>(null);
  const [syncActionRunning, setSyncActionRunning] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [historyMaximized, setHistoryMaximized] = useState(false);
  const [duplicateBlock, setDuplicateBlock] = useState(false);

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


  // Calling session state. `locked` is what disables the controls; the server
  // refuses the same edits independently, so this is only the visible half.
  // The session is app-level state (CallSessionProvider) so the timer survives
  // so a server-rendered open popup has the right state on first paint.
  const { session: callSession, clearSession } = useCallSession();
  const callActive = Boolean(callSession && callSession.order_id === order.id);
  // A synced order is frozen for everyone (the server rejects the same edits);
  // an Administrator unlock sets manual_unlock_active and reopens it for one save.
  const syncedLocked = isOrderLocked(order);
  const locked = syncedLocked || (requiresCallSession && !callActive);
  /**
   * The popup IS the form.
   *
   * It used to open read-only behind an Edit Order button, so working a lead
   * was: press Calling, press Edit Order, then start typing — two presses
   * between a ringing phone and the first field. There is nothing to read
   * here that the form does not also show, so the form is what opens.
   *
   * Derived, not stored: a lead becomes editable the moment the call starts
   * and read-only again when it ends or the order syncs to Pancake, with no
   * state to keep in step.
   */
  const editing = canEdit && !locked;

  const isDirty = editing && JSON.stringify(form) !== JSON.stringify(initial);
  // Only an in-progress edit can be lost now that the view mode has no controls
  // of its own to abandon.
  const hasUnsavedChanges = isDirty;

  function update<K extends keyof EditForm>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // --- Live order economics ------------------------------------------------
  // Derived from the lines now, using the same arithmetic the server applies
  // when it stores them, so the figures shown here and the figures saved
  // cannot disagree.
  const draftShipping = form.shipping_fee.trim() === "" ? 0 : Number(form.shipping_fee) || 0;
  const draftLines = lines.filter((line) => line.product_id);
  const draftTotals = totalsFor(
    draftLines.map((line) => ({
      quantity: Number(line.quantity) || 0,
      unit_price: Number(line.unit_price) || 0,
      discount: Number(line.discount) || 0,
    })),
    draftShipping
  );
  const draftQuantity = draftTotals.quantity;
  const draftDiscount = draftTotals.discount;
  const grandTotal = draftTotals.total;
  // The first priced line stands in for the order wherever a single figure is
  // still wanted — the Pancake pre-check below asks for one unit price.
  const draftUnitPrice = Number(draftLines[0]?.unit_price) || 0;
  // Whether a price has actually been entered. This used to read
  // form.unit_price — the order-level field the line editor never writes — so
  // a lead priced on its line was told "Unit price is required" while the
  // total beside it read ₱300.00. Imported leads have no order-level price at
  // all, which made Packaging unreachable for them.
  //
  // The order-level field is still the answer for an order with no lines,
  // which is what the single-product form used to produce.
  const checkUnitPrice = draftLines.length > 0 ? draftUnitPrice : Number(form.unit_price) || 0;
  // Greater than zero, matching the server's packaging gate — "a free order is
  // not a sale". Offering Packaging for a blank or zero price would only mean
  // the save comes back refused.
  const unitPriceEntered = checkUnitPrice > 0;

  // Review step: exactly what the server will check before sending. With
  // several lines the check still asks for one product name, so it gets the
  // same summary the order itself will carry.
  const selectedProductName =
    draftLines.length === 0
      ? ""
      : summarizeItems(
          draftLines.map((line) => ({
            product_name: activeProducts.find((p) => p.id === line.product_id)?.name || line.product_name,
          }))
        );
  const pancakeCheck = computePancakeCheck({
    customer_name: form.customer_name,
    customer_phone: form.customer_phone,
    barangay: form.barangay,
    city: form.city,
    province: form.province,
    product_name: selectedProductName,
    quantity: draftQuantity,
    unit_price: unitPriceEntered ? checkUnitPrice : null,
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
      // A save closes the calling session server-side (it records the transition
      // the call produced), so drop it here too rather than leaving a timer
      // running against a session that no longer exists.
      if (callActive) clearSession();
      onSaved(json.order as Order);
      setError(null);
      setMissing([]);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  /** What Save Changes presses. Stops at the duplicate dialog when there is one
   * to show — the server refuses the same save for the same reason, so letting
   * it through would only produce a red error a moment later. */
  function attemptSave() {
    if (duplicateWarnings.length > 0) {
      setDuplicateBlock(true);
      return;
    }
    saveNow();
  }

  /** Save, having already passed or dismissed the duplicate check. */
  function saveNow() {
    submit(
      buildRawFromOrder(order, {
        customer_name: form.customer_name,
        customer_phone: form.customer_phone,
        purok: form.purok,
        barangay: form.barangay,
        city: form.city,
        province: form.province,
        pancake_province_id: form.pancake_province_id,
        pancake_district_id: form.pancake_district_id,
        pancake_commune_id: form.pancake_commune_id,
        landmark: form.landmark,
        // The products travel as lines. Only the Edit flow sends them; Update
        // Status deliberately does not, so changing a status leaves an order's
        // products exactly as they were.
        items: draftLines.map((line) => ({
          product_id: line.product_id,
          variant: line.variant,
          quantity: Number(line.quantity) || 1,
          unit_price: Number(line.unit_price) || 0,
          discount: Number(line.discount) || 0,
        })),
        shipping_fee: form.shipping_fee.trim() === "" ? null : Number(form.shipping_fee),
        courier: form.courier,
        payment_method: form.payment_method,
        order_source: form.order_source,
        status: form.status,
        notes: form.notes,
      })
    );
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={requestClose}>
      {/* Above the popup's own backdrop (z-50) and stopping its click-to-close,
          so pressing anywhere in the warning cannot dismiss the order behind it. */}
      {duplicateBlock && (
        <div onClick={(e) => e.stopPropagation()}>
          <DuplicateBlockDialog
            warnings={duplicateWarnings}
            canOverride={canOverrideDuplicate}
            onBack={() => setDuplicateBlock(false)}
            onOverride={() => {
              setDuplicateBlock(false);
              saveNow();
            }}
          />
        </div>
      )}
      <div
        className="dense-form max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Pinned, like the footer bar: which order this is, where it stands and
            where it came from are the three things you need while reading any
            part of the form, and they were scrolling away at the first section.
            The header carries a solid background already, so nothing shows
            through it. */}
        <div className={`sticky top-0 z-30 flex items-center justify-between rounded-t-xl ${style.header} px-5 py-3`}>
          <div className="flex items-center gap-2 text-white">
            {/* The same id the row was clicked on. The header used to print the
                whole ORD-YYYYMMDD-NNNN while the list showed its counter, so
                the popup appeared to be about a different order than the one
                just pressed. The full reference stays on the tooltip, which is
                where it gets read out and pasted into Pancake. */}
            <h2
              className="text-base font-semibold"
              title={
                order.pancake_order_id
                  ? `Pancake ID ${order.pancake_order_id} · internal reference ${order.order_number}`
                  : `Internal reference: ${order.order_number}`
              }
            >
              {shortOrderId(order)}
              {/* "(pending sync)" is a Pancake fact, and Pancake is fulfillment's
                  surface — an agent is not shown the sync state anywhere else in
                  this popup, and being told an order has not reached a system
                  they have no part in only reads as something being wrong. */}
              {canSeeFulfillment && isPendingOrderId(order) && (
                <span className="ml-1.5 text-xs font-normal opacity-80">(pending sync)</span>
              )}
            </h2>
            {/* Where it came from, beside where it is — the PREV Status column
                of the list, carried into the header so the pair is read the
                same way in both places.

                Solid white with near-black text, not the status's own pale
                badge colours. Those are made for a white table row: teal-100 on
                a teal-500 header, or blue-100 on blue-500, is the same colour
                twice and the chip disappears into the bar behind it. White reads
                against every header in the palette, from yellow-400 to red-900,
                which is the one thing this chip has to do. */}
            {order.previous_order_status && (
              <span className="whitespace-nowrap rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-900 shadow-sm ring-1 ring-slate-900/10">
                prev {order.previous_order_status.replace(/_/g, " ")}
              </span>
            )}
            <StatusBadge status={order.status} />

            {/* This lead belongs to a regular customer.
                Worth saying in the header rather than leaving to be inferred:
                these orders are kept out of the Leads list, so an agent who
                reaches one through a search or a pinned link has no other clue
                why it is not among the leads they were working. It is also the
                one state in which Make Regular Customer is absent from the
                footer, and an absent button explains nothing by itself.

                Amber and starred, matching that button — the same fact, once as
                the action and once as the result. */}
            {order.is_regular_customer && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950 shadow-sm">
                <Star className="h-3 w-3" aria-hidden /> Regular Customer
              </span>
            )}
          </div>
          {/* No ✕. Close is in the footer bar, which is pinned and therefore on
              screen from anywhere in the form, and the backdrop closes too —
              both go through requestClose, so unsaved work is still asked about
              either way. Two closes a hand's width apart, doing the same thing,
              is one more than the header needs. */}
        </div>

        <div className="space-y-4 p-5">
          {syncedLocked && <Alert kind="info">{SYNCED_LOCK_MESSAGE}</Alert>}
          {order.manual_unlock_active && (
            <Alert kind="warning">
              Unlocked for editing by an Administrator{order.manual_unlock_reason ? `: ${order.manual_unlock_reason}` : ""}. It
              relocks as soon as you save.
            </Alert>
          )}
          {/* Calling moved to the footer bar, beside Close — see below. */}
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

          {/* What the customer bought last, above the order being taken now.
              It sat at the bottom, under the whole form and the notes — which
              is the one place it is no use, because it is what the call opens
              with. The five fields are one block under one heading rather than
              five labels each repeating the word "Previous". */}
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="mb-2 border-b border-slate-200 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Previous Details
            </p>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs uppercase text-slate-400">Order Date</p>
                <p className="text-slate-700">{order.previous_order_date ? formatDate(order.previous_order_date) : "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-400">Ordered Product</p>
                <p className="text-slate-700">{order.previous_order_product || "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-400">Amt</p>
                <p className="text-slate-700">
                  {order.previous_order_amount != null ? formatCurrency(order.previous_order_amount) : "—"}
                </p>
              </div>
              {/* Full width: a note is a sentence, not a value, and wrapping it
                  into a third-of-a-row column made it unreadable. */}
              <div className="col-span-3">
                <p className="text-xs uppercase text-slate-400">Note</p>
                <p className="whitespace-pre-wrap text-slate-700">{order.previous_order_note || "—"}</p>
              </div>
              <div className="col-span-3">
                <p className="text-xs uppercase text-slate-400">Status</p>
                {/* The column is text, so it can hold a status an import file
                    named that this system does not have. Badge the ones we know
                    and print the rest as-is — StatusBadge would throw on a key
                    that has no style. */}
                {isKnownStatus(order.previous_order_status) ? (
                  <StatusBadge status={order.previous_order_status as OrderStatus} />
                ) : (
                  <p className="text-slate-700">{order.previous_order_status || "—"}</p>
                )}
              </div>
            </div>
          </div>

          {!editing ? (
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
              <div>
                <p className="text-xs uppercase text-slate-400">Tag</p>
                <p className="text-slate-800">{order.tag || "—"}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">

              <h4 className="border-b border-slate-100 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Customer</h4>
              {(
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
                  />
                  <div>
                    <Label htmlFor="m_landmark">Landmark</Label>
                    <Input id="m_landmark" value={form.landmark} onChange={(e) => update("landmark", e.target.value)} />
                  </div>
                </div>
              )}

              <h4 className="border-b border-slate-100 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Products &amp; pricing</h4>
              {(
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="m_items">Products</Label>
                    {/* The editor posts nothing itself here — this modal sends
                        JSON, so `lines` is what travels in the body. Its inputs
                        still carry names, which is harmless: they are not
                        inside a form element. */}
                    <OrderItemsEditor
                      products={activeProducts}
                      initialLines={initialLines}
                      shippingFee={draftShipping}
                      onLinesChange={setLines}
                    />
                  </div>
                  {/* Shipping Fee, Courier, Payment Method and Order Source
                      lived here. None of them is a thing an agent decides on a
                      call: the first three are fulfillment's, filled from the
                      Pancake account's defaults when an order forwards, and
                      Order Source was already read-only, set from the agent's
                      own Call Name.

                      The values are untouched — the form still carries and
                      saves whatever the order holds, so nothing is cleared by
                      no longer being on screen. */}
                  {/* The totals box stood here: Line total, Discount, Shipping
                      fee, Grand total. All of it is gone.

                      It was the working for a sum the agent has no part in —
                      discount and shipping left the form with the other
                      fulfillment fields, so both read ₱0.00 on every order —
                      and the figure it ended on was the same one the line
                      editor already prints as its Total, a few lines up. Two
                      boxes were saying one number.

                      Nothing changed in what is calculated or saved: the same
                      total goes to the server, appears in the Review list under
                      "Total amount", and reaches Pancake unchanged. */}
                </div>
              )}

              <h4 className="border-b border-slate-100 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Review</h4>
              {(
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
                      // Unit price, Discount, Payment method and Order source
                      // are gone from this summary. The first two are stated on
                      // the line they belong to in the editor above — a lead
                      // with three products has three unit prices and one line
                      // here could only ever show one of them — and the last
                      // two left the form with the rest of fulfillment's
                      // fields. Total amount is what this list is read for.
                      ["Shipping fee", form.shipping_fee === "" ? "" : formatCurrency(draftShipping)],
                      ["Total amount", formatCurrency(grandTotal)],
                      ["Courier", form.courier],
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
            </div>
          )}

          {!editing && (
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
                      · {h.source ? PANCAKE_SYNC_SOURCE_LABELS[h.source as PancakeSyncSource] || h.source : "—"} ·{" "}
                      {formatDateTime(h.request_at)}
                      {h.old_status || h.new_status ? (
                        <>
                          {" "}
                          · <span className="text-slate-500">{h.old_status || "—"}</span> →{" "}
                          <span className="font-medium text-slate-700">{h.new_status || "—"}</span>
                        </>
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
                {/* Where it came from, not just where it landed. The trail has
                    always recorded both; only the destination was shown. */}
                {isKnownStatus(latestStatusUpdate.from) && (
                  <>
                    <StatusBadge status={latestStatusUpdate.from} />
                    <span className="mx-1 text-slate-400">→</span>
                  </>
                )}
                <StatusBadge status={latestStatusUpdate.status} /> on {formatDateTime(latestStatusUpdate.at)}
              </>
            ) : (
              "—"
            )}
          </div>

          {/* The quick Update Status control and its call-remarks box used to sit
              here. Removed at the client's request: status is changed through
              Edit Order, which is the one path that also validates the fields a
              status needs. */}

          {callSessions.length > 0 && (
            <div className="border-t border-slate-100 pt-3">
              {/* An order that has been called twenty times filled the popup
                  with its own history and pushed Save Changes off the bottom.
                  It opens on the latest call only — the one that says where the
                  lead was left — and the earlier ones are a press away. The
                  other control folds the section to its heading entirely.

                  Neither choice is remembered: the popup opens the same way
                  every time, which is what makes it predictable. */}
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Call History ({callSessions.length})
                </p>
                <div className="flex items-center gap-1">
                  {historyOpen && callSessions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setHistoryMaximized((v) => !v)}
                      title={
                        historyMaximized
                          ? "Show the latest call only"
                          : `Show all ${callSessions.length} calls`
                      }
                      aria-label={
                        historyMaximized
                          ? "Show the latest call only"
                          : `Show all ${callSessions.length} calls`
                      }
                      className="rounded border border-slate-200 p-1 text-slate-500 hover:bg-slate-50"
                    >
                      {historyMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setHistoryOpen((v) => !v)}
                    title={historyOpen ? "Hide the call history" : "Show the call history"}
                    aria-label={historyOpen ? "Hide the call history" : "Show the call history"}
                    aria-expanded={historyOpen}
                    className="rounded border border-slate-200 p-1 text-slate-500 hover:bg-slate-50"
                  >
                    {historyOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              {historyOpen && (
                <>
                  <CallHistory
                    sessions={historyMaximized ? callSessions : callSessions.slice(0, 1)}
                    agentNameById={agentNameById}
                    maxHeightClass={historyMaximized ? "max-h-[60vh]" : "max-h-none"}
                  />
                  {/* Say what is being held back, rather than leaving one row
                      to look like the whole history. */}
                  {!historyMaximized && callSessions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setHistoryMaximized(true)}
                      className="mt-1 text-[11px] text-slate-500 hover:text-[var(--brand-primary)] hover:underline"
                    >
                      {callSessions.length - 1} earlier {callSessions.length - 1 === 1 ? "call" : "calls"} hidden — show all
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {duplicateWarnings.length > 0 && (
          <div className="border-t border-amber-200 bg-amber-50 px-5 py-3">
            <p className="text-sm font-medium text-amber-900">
              Possible duplicate customer{duplicateWarnings.length === 1 ? "" : "s"}
            </p>
            <ul className="mt-1 space-y-1 text-xs text-amber-800">
              {duplicateWarnings.map((d, i) => (
                <li key={i}>
                  <strong>{d.name}</strong> · {d.phone} · agent {d.agent} — matched on {d.fields.join(", ")} ({d.confidence} confidence)
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-amber-700">Nothing is merged automatically. Review under Regular Customers.</p>
          </div>
        )}

        {/* Pinned to the bottom of the card, which is the scrolling element, so
            Close and Save Changes are reachable from anywhere in the form. They
            used to sit after the last section: on a long order — a call history,
            a sync panel, a duplicate warning — you had to scroll to the end to
            leave, and the further you were from finished the further away the
            way out was. */}
        <div className="sticky bottom-0 z-20 flex items-center justify-between gap-2 rounded-b-xl border-t border-slate-200 bg-white px-5 py-3 shadow-[0_-2px_6px_-2px_rgba(15,23,42,0.12)]">
          <div>{fullPageHref && <Link href={fullPageHref} className="text-xs font-medium text-[var(--brand-primary)] hover:underline">Open full page</Link>}</div>
          <div className="flex items-center gap-2">
            {/* Making this customer a regular is a decision that comes out of
                the call, so it belongs with the controls the call ends on —
                not eleven fields up where it used to sit. Offered only where
                it can do anything: the order needs a number to key a customer
                on, and one already tagged has nothing left to do.

                It leads the group, ahead of Close: it is the only thing here
                that changes what this lead IS, and it sat behind the button
                that walks away from it. */}
            {canTagRegular && !order.is_regular_customer && order.customer_phone.trim() && (
              <form action={tagRegularCustomerAction.bind(null, order.id)}>
                {/* Amber, matching the star it carries: making a customer a
                    regular is a promotion, and it read as one more grey button
                    beside Close. Near-black text rather than white — white on
                    amber-400 is below the contrast this app holds elsewhere. */}
                <ConfirmSubmitButton
                  disabled={saving}
                  confirmTitle="Make Regular Customer?"
                  confirmMessage={`Confirm ${order.customer_name}${
                    order.customer_phone ? ` · ${order.customer_phone}` : ""
                  } to Regular Customer?`}
                  confirmLabel="Make Regular Customer"
                  danger={false}
                  className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-amber-400 px-4 py-2 text-control font-medium text-amber-950 transition-colors hover:bg-amber-500 disabled:pointer-events-none disabled:opacity-40"
                >
                  <Star className="h-4 w-4" /> Make Regular Customer
                </ConfirmSubmitButton>
              </form>
            )}

            {/* No Edit Order and no Cancel. There is nothing to switch into —
                the form is the popup — and requestClose already asks before
                dropping unsaved work, which is all Cancel ever did. */}
            <Button type="button" variant="outline" onClick={requestClose} disabled={saving}>
              Close
            </Button>

            {/* Calling lives here rather than in a strip at the top of the form.
                It is a control, and the controls are in the bar that is always
                on screen — an agent who scrolled to the address no longer has to
                scroll back up to start the call, and the running timer stays
                visible for the whole call instead of only at the top.

                Shown to anyone the call rule applies to, and to anyone who HAS a
                call running on this order whether the rule applies to them or
                not: CALL in the leads row is offered to every role, so a
                supervisor could otherwise start a call and find the popup had no
                timer and no way to end it.

                A call already running is shown even on a locked order. The lock
                stops the order being *edited* once Pancake has it, and it does
                still stop a call being started — but an order can sync while a
                call is open on it, and hiding the panel then left the call with
                no way to end: the row said Details rather than Return to call,
                and the popup it opened had no timer and no button. The session
                stayed on the clock and on the Agent Monitor until somebody
                noticed. Ending is never the thing to withhold. */}
            {(callActive || (requiresCallSession && !syncedLocked)) && (
              <CallingPanel
                compact
                orderId={order.id}
                onOpenActive={(id) => {
                  window.location.href = `/leads?open_id=${id}`;
                }}
              />
            )}

            {editing && (
              <Button type="button" onClick={attemptSave} disabled={saving} className="whitespace-nowrap">
                {saving ? "Saving…" : "Save Changes"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
