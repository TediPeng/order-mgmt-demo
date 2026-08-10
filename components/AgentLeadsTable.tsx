"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge, LEAD_STATUS_STYLES } from "@/components/ui/Badge";
import { OrderDetailsModal } from "@/components/OrderDetailsModal";
import type { EditorLine } from "@/components/OrderItemsEditor";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import type { CallSession, Order } from "@/lib/types";
import { displayOrderId, isPendingOrderId } from "@/lib/types";

export interface CareStaff {
  name: string;
  email: string;
}

/** Pancake reports tracking as `tracking_link` — a full courier URL, often 200+
 * characters. Printed raw it stretched the row far past the viewport and pushed
 * every other column out of reach. A URL renders as a short link instead; a
 * plain code (some couriers send one via `partner.extend_code`) still shows as
 * text. The full value stays available via the title attribute either way. */
function TrackingCell({ value }: { value: string | null }) {
  if (!value) return <span className="text-slate-400">Not Available</span>;

  const isUrl = /^https?:\/\//i.test(value);
  if (!isUrl) {
    return (
      <span title={value} className="block max-w-[16rem] truncate">
        {value}
      </span>
    );
  }

  return (
    <a
      href={value}
      target="_blank"
      rel="noopener noreferrer"
      title={value}
      onClick={(e) => e.stopPropagation()}
      className="text-[var(--brand-primary)] hover:underline"
    >
      Track parcel ↗
    </a>
  );
}

/** The agent leads table: exactly the columns an agent is allowed to see, in
 * the order the spec lays out. Shipping fee, payment method, variant, discount
 * and every Pancake/sync column are absent by construction — this component
 * has no props carrying them, so there is nothing to leak.
 *
 * Order ID leads the row and doubles as its control. Once an order has synced
 * that value is Pancake's own generated id — the reference both systems share,
 * and the one an agent quotes — so it earns a column of its own rather than
 * hiding in the date cell's tooltip. Before syncing it falls back to the
 * internal number, dimmed and marked "(pending sync)". */
export function AgentLeadsTable({
  orders,
  careStaffById,
  productNameByOrderId,
  activeProducts,
  linesByOrder,
  canEdit,
  canTagRegular = false,
  callSessionsByOrderId = {},
  agentNameById = {},
  initialOpenOrderNumber,
  initialOpenOrderId,
}: {
  orders: Order[];
  careStaffById: Record<string, CareStaff>;
  productNameByOrderId: Record<string, string>;
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
  canTagRegular?: boolean;
  callSessionsByOrderId?: Record<string, CallSession[]>;
  agentNameById?: Record<string, string>;
  initialOpenOrderNumber?: string;
  initialOpenOrderId?: string;
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

  // By id, which is what "Return to active call" has to hand.
  useEffect(() => {
    if (!initialOpenOrderId) return;
    if (orders.some((o) => o.id === initialOpenOrderId)) setOpenId(initialOpenOrderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenOrderId]);

  const openOrder = rows.find((o) => o.id === openId) || null;

  function handleSaved(updated: Order) {
    setRows((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
    router.refresh();
  }

  const cell = "px-3 py-2.5 text-slate-600 whitespace-nowrap";

  return (
    <>
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[2250px] text-left text-table">
          <thead className="sticky top-0 z-20 bg-slate-50 text-table font-medium uppercase tracking-wide text-slate-500 shadow-sm">
            <tr>
              <th className="sticky left-0 z-30 bg-slate-50 px-3 py-3">Order ID</th>
              <th className="px-3 py-3">Order Date</th>
              <th className="px-3 py-3">Order Source</th>
              <th className="px-3 py-3">Customer Name</th>
              <th className="px-3 py-3">Phone Number</th>
              <th className="px-3 py-3">Address (Purok)</th>
              <th className="px-3 py-3">Province</th>
              <th className="px-3 py-3">City / Municipality</th>
              <th className="px-3 py-3">Barangay</th>
              <th className="px-3 py-3">Landmark</th>
              <th className="px-3 py-3">Notes</th>
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
              return (
                <tr key={o.id} className={cn(style.row, style.rowHover)}>
                  {/* Order ID doubles as the row control. Once an order syncs
                      this is Pancake's own generated id — the reference both
                      systems share — so it leads the row. */}
                  <td className={cn("sticky left-0 z-10 px-3 py-2.5", style.row)}>
                    <button
                      type="button"
                      onClick={() => setOpenId(o.id)}
                      title={
                        isPendingOrderId(o)
                          ? "Not yet forwarded to Pancake POS"
                          : `Internal reference: ${o.order_number}`
                      }
                      className={cn(
                        "font-medium hover:underline",
                        isPendingOrderId(o) ? "text-slate-500" : "text-[var(--brand-primary)]"
                      )}
                    >
                      {displayOrderId(o)}
                      {isPendingOrderId(o) && (
                        <span className="ml-1 text-xs font-normal text-slate-400">(pending sync)</span>
                      )}
                    </button>
                  </td>
                  <td className={cell}>{o.order_date ? formatDate(o.order_date) : "—"}</td>
                  <td className={cell}>{o.order_source || "—"}</td>
                  <td className={cell}>{o.customer_name}</td>
                  <td className={cell}>{o.customer_phone || "—"}</td>
                  <td className={cell}>{o.purok || "—"}</td>
                  <td className={cell}>{o.province || "—"}</td>
                  <td className={cell}>{o.city || "—"}</td>
                  <td className={cell}>{o.barangay || "—"}</td>
                  <td className={cell}>{o.landmark || "—"}</td>
                  <td className={cell} title={o.notes || undefined}>
                    <span className="block max-w-[22rem] truncate">{o.notes || "—"}</span>
                  </td>
                  <td className={cell}>{productNameByOrderId[o.id] || o.product_name || "—"}</td>
                  <td className={cell}>{o.unit_price != null ? formatCurrency(o.unit_price) : "—"}</td>
                  <td className={cell}>{o.tag || "—"}</td>
                  <td className={cell}>{o.courier || "—"}</td>
                  <td className={cell}>
                    <TrackingCell value={o.tracking_number} />
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={o.status} />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={20} className="px-4 py-10 text-center text-slate-400">
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
          initialLines={linesByOrder[openOrder.id] ?? []}
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
