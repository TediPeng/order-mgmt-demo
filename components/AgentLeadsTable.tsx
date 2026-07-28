"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge, LEAD_STATUS_STYLES } from "@/components/ui/Badge";
import { OrderDetailsModal } from "@/components/OrderDetailsModal";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import type { CallSession, Order } from "@/lib/types";

export interface CareStaff {
  name: string;
  email: string;
}

/** The agent leads table: exactly the columns an agent is allowed to see, in
 * the order the spec lays out. Shipping fee, payment method, variant, discount
 * and every Pancake/sync column are absent by construction — this component
 * has no props carrying them, so there is nothing to leak.
 *
 * Order Number is not a column of its own: the spec's list starts at Order
 * Date, so the date cell doubles as the row's control (matching the previous
 * "clickable Order-ID-style row" behaviour) and carries the order number as its
 * title for reference. */
export function AgentLeadsTable({
  orders,
  careStaffById,
  productNameByOrderId,
  activeProducts,
  canEdit,
  canTagRegular = false,
  initialCallSession = null,
  callSessionsByOrderId = {},
  agentNameById = {},
  initialOpenOrderNumber,
}: {
  orders: Order[];
  careStaffById: Record<string, CareStaff>;
  productNameByOrderId: Record<string, string>;
  activeProducts: { id: string; name: string; code: string | null }[];
  canEdit: boolean;
  canTagRegular?: boolean;
  initialCallSession?: CallSession | null;
  callSessionsByOrderId?: Record<string, CallSession[]>;
  agentNameById?: Record<string, string>;
  initialOpenOrderNumber?: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(orders);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => setRows(orders), [orders]);

  useEffect(() => {
    if (!initialOpenOrderNumber) return;
    const match = orders.find((o) => o.order_number === initialOpenOrderNumber);
    if (match) setOpenId(match.id);
    // Only for the initial deep-link, not on every refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenOrderNumber]);

  const openOrder = rows.find((o) => o.id === openId) || null;

  function handleSaved(updated: Order) {
    setRows((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
    router.refresh();
  }

  const cell = "px-3 py-2.5 text-slate-600 whitespace-nowrap";

  return (
    <>
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[2100px] text-left text-table">
          <thead className="sticky top-0 z-20 bg-slate-50 text-table font-medium uppercase tracking-wide text-slate-500 shadow-sm">
            <tr>
              <th className="sticky left-0 z-30 bg-slate-50 px-3 py-3">Order Date</th>
              <th className="px-3 py-3">Order Source</th>
              <th className="px-3 py-3">Care Staff</th>
              <th className="px-3 py-3">Customer Name</th>
              <th className="px-3 py-3">Phone Number</th>
              <th className="px-3 py-3">Address (Purok)</th>
              <th className="px-3 py-3">Province</th>
              <th className="px-3 py-3">City / Municipality</th>
              <th className="px-3 py-3">Barangay</th>
              <th className="px-3 py-3">Landmark</th>
              <th className="px-3 py-3">Previous Order Date</th>
              <th className="px-3 py-3">Previous Order Product</th>
              <th className="px-3 py-3">Previous Order Amount</th>
              <th className="px-3 py-3">New Product Order</th>
              <th className="px-3 py-3">Unit Price</th>
              <th className="px-3 py-3">Tag</th>
              <th className="px-3 py-3">Courier</th>
              <th className="px-3 py-3">Tracking Number</th>
              <th className="px-3 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((o) => {
              const style = LEAD_STATUS_STYLES[o.status];
              const care = careStaffById[o.agent_id];
              return (
                <tr key={o.id} className={cn(style.row, style.rowHover)}>
                  <td className={cn("sticky left-0 z-10 px-3 py-2.5", style.row)}>
                    <button
                      type="button"
                      onClick={() => setOpenId(o.id)}
                      title={o.order_number}
                      className="font-medium text-[var(--brand-primary)] hover:underline"
                    >
                      {o.order_date ? formatDate(o.order_date) : "Open"}
                    </button>
                  </td>
                  <td className={cell}>{o.order_source || "—"}</td>
                  <td className={cell} title={care?.email || undefined}>
                    {care?.name || "—"}
                  </td>
                  <td className={cell}>{o.customer_name}</td>
                  <td className={cell}>{o.customer_phone || "—"}</td>
                  <td className={cell}>{o.purok || "—"}</td>
                  <td className={cell}>{o.province || "—"}</td>
                  <td className={cell}>{o.city || "—"}</td>
                  <td className={cell}>{o.barangay || "—"}</td>
                  <td className={cell}>{o.landmark || "—"}</td>
                  <td className={cell}>{o.previous_order_date ? formatDate(o.previous_order_date) : "—"}</td>
                  <td className={cell}>{o.previous_order_product || "—"}</td>
                  <td className={cell}>
                    {o.previous_order_amount != null ? formatCurrency(o.previous_order_amount) : "—"}
                  </td>
                  <td className={cell}>{productNameByOrderId[o.id] || o.product_name || "—"}</td>
                  <td className={cell}>{o.unit_price != null ? formatCurrency(o.unit_price) : "—"}</td>
                  <td className={cell}>{o.tag || "—"}</td>
                  <td className={cell}>{o.courier || "—"}</td>
                  <td className={cell}>
                    {o.tracking_number || <span className="text-slate-400">Not Available</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={o.status} />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={19} className="px-4 py-10 text-center text-slate-400">
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
          agentName={careStaffById[openOrder.agent_id]?.name || "—"}
          productName={productNameByOrderId[openOrder.id] || openOrder.product_name}
          latestStatusUpdate={null}
          activeProducts={activeProducts}
          canEdit={canEdit}
          // Agents get no fulfillment surface and cannot set fulfillment
          // statuses; both are also refused server-side.
          canSeeFulfillment={false}
          canSetFulfillmentStatus={false}
          canManageIntegrations={false}
          // Agents must open a call before they can edit or change status;
          // the same rule is enforced server-side.
          canTagRegular={canTagRegular}
          requiresCallSession
          initialCallSession={initialCallSession}
          callSessions={callSessionsByOrderId[openOrder.id] || []}
          agentNameById={agentNameById}
          fullPageHref={null}
          onClose={() => setOpenId(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
