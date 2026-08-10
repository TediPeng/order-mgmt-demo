"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge, SyncStatusChip, LEAD_STATUS_STYLES } from "@/components/ui/Badge";
import { OrderDetailsModal } from "@/components/OrderDetailsModal";
import type { EditorLine } from "@/components/OrderItemsEditor";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { MAX_ATTEMPTS } from "@/lib/pancake/retry";
import type { CallSession, Order, OrderStatus } from "@/lib/types";
import { displayOrderId, isPendingOrderId } from "@/lib/types";

export function LeadsTable({
  orders: initialOrders,
  agentUsernameById,
  agentFullNameById,
  productNameByOrderId,
  latestStatusUpdateByOrderId,
  activeProducts,
  linesByOrder,
  canEdit,
  canManageIntegrations = false,
  canSetFulfillmentStatus = false,
  canTagRegular = false,
  duplicateWarningsByOrderId = {},
  requiresCallSession = false,
  callSessionsByOrderId = {},
  agentNameById = {},
  canSeeFulfillment = false,
  fullPageHrefBase,
  initialOpenOrderNumber,
  initialOpenOrderId,
}: {
  orders: Order[];
  agentUsernameById: Record<string, string>;
  agentFullNameById: Record<string, string>;
  productNameByOrderId: Record<string, string>;
  latestStatusUpdateByOrderId: Record<string, { status: OrderStatus; at: string } | undefined>;
  activeProducts: {
    id: string;
    name: string;
    code: string | null;
    variants: string[] | null;
    selling_price: number | null;
    pancake_variation_id: string | null;
  }[];
  /** Existing lines per order id, fetched in one query by the page so the
   * modal opens on the order as it stands rather than a blank row. */
  linesByOrder: Record<string, EditorLine[]>;
  canEdit: boolean;
  canManageIntegrations?: boolean;
  canSetFulfillmentStatus?: boolean;
  canTagRegular?: boolean;
  duplicateWarningsByOrderId?: Record<string, { name: string; phone: string; agent: string; fields: string[]; confidence: string }[]>;
  requiresCallSession?: boolean;
  callSessionsByOrderId?: Record<string, CallSession[]>;
  agentNameById?: Record<string, string>;
  canSeeFulfillment?: boolean;
  fullPageHrefBase: string | null;
  initialOpenOrderNumber?: string;
  initialOpenOrderId?: string;
}) {
  const router = useRouter();
  const [orders, setOrders] = useState(initialOrders);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    setOrders(initialOrders);
  }, [initialOrders]);

  useEffect(() => {
    if (!initialOpenOrderNumber) return;
    const match = initialOrders.find((o) => o.order_number === initialOpenOrderNumber);
    if (match) setOpenId(match.id);
    // Only run for the initial deep-link, not on every orders refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenOrderNumber]);

  // By id, which is what "Return to active call" has to hand: the call is on
  // an order id, and the page pins that order into the rows so this always
  // finds it.
  useEffect(() => {
    if (!initialOpenOrderId) return;
    if (initialOrders.some((o) => o.id === initialOpenOrderId)) setOpenId(initialOpenOrderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenOrderId]);

  const openOrder = orders.find((o) => o.id === openId) || null;

  function handleSaved(updated: Order) {
    setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
    router.refresh();
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[2200px] text-left text-table">
          <thead className="bg-slate-50 text-table font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="sticky left-0 z-10 bg-slate-50 px-4 py-3">Order ID</th>
              <th className="px-4 py-3">Order Date</th>
              <th className="px-4 py-3">Agent</th>
              <th className="px-4 py-3">Customer Name</th>
              <th className="px-4 py-3">Phone Number</th>
              <th className="px-4 py-3">Purok</th>
              <th className="px-4 py-3">Barangay</th>
              <th className="px-4 py-3">City</th>
              <th className="px-4 py-3">Province</th>
              <th className="px-4 py-3">Landmark</th>
              <th className="px-4 py-3">Previous Order Date</th>
              <th className="px-4 py-3">Previous Order Product</th>
              <th className="px-4 py-3">Previous Order Amount</th>
              <th className="px-4 py-3">New Product Order</th>
              <th className="px-4 py-3">Unit Price</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Pancake Sync</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {orders.map((o) => {
              const style = LEAD_STATUS_STYLES[o.status];
              return (
                <tr key={o.id} className={cn(style.row, style.rowHover)}>
                  <td className={cn("sticky left-0 z-10 px-4 py-3", style.row)}>
                    <button
                      type="button"
                      onClick={() => setOpenId(o.id)}
                      title={isPendingOrderId(o) ? "Not yet forwarded to Pancake POS" : `Internal reference: ${o.order_number}`}
                      className={cn(
                        "font-medium hover:underline",
                        isPendingOrderId(o) ? "text-slate-400" : "text-[var(--brand-primary)]"
                      )}
                    >
                      {displayOrderId(o)}
                      {isPendingOrderId(o) && <span className="ml-1 text-xs font-normal">(pending sync)</span>}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{o.order_date ? formatDate(o.order_date) : "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{agentUsernameById[o.agent_id] || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{o.customer_name}</td>
                  <td className="px-4 py-3 text-slate-600">{o.customer_phone || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{o.purok || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{o.barangay || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{o.city || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{o.province || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{o.landmark || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{o.previous_order_date ? formatDate(o.previous_order_date) : "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{o.previous_order_product || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {o.previous_order_amount != null ? formatCurrency(o.previous_order_amount) : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{o.product_name || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{o.unit_price != null ? formatCurrency(o.unit_price) : "—"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="px-4 py-3">
                    <SyncStatusChip
                      status={o.pancake_sync_status}
                      needsReview={o.pancake_sync_status === "sync_failed" && o.pancake_retry_count >= MAX_ATTEMPTS}
                    />
                  </td>
                </tr>
              );
            })}
            {orders.length === 0 && (
              <tr>
                <td colSpan={17} className="px-4 py-10 text-center text-slate-400">
                  No leads found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {openOrder && (
        <OrderDetailsModal
          order={openOrder}
          agentName={agentFullNameById[openOrder.agent_id] || "—"}
          productName={productNameByOrderId[openOrder.id] || openOrder.product_name}
          latestStatusUpdate={latestStatusUpdateByOrderId[openOrder.id] || null}
          activeProducts={activeProducts}
          initialLines={linesByOrder[openOrder.id] ?? []}
          canEdit={canEdit}
          canManageIntegrations={canManageIntegrations}
          canSetFulfillmentStatus={canSetFulfillmentStatus}
          canTagRegular={canTagRegular}
          duplicateWarnings={duplicateWarningsByOrderId[openOrder.id] || []}
          requiresCallSession={requiresCallSession}
          callSessions={callSessionsByOrderId[openOrder.id] || []}
          agentNameById={agentNameById}
          canSeeFulfillment={canSeeFulfillment}
          fullPageHref={fullPageHrefBase ? `${fullPageHrefBase}/${openOrder.id}` : null}
          onClose={() => setOpenId(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
