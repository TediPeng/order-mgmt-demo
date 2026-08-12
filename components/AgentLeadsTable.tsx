"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge, LEAD_STATUS_STYLES } from "@/components/ui/Badge";
import { OrderDetailsModal } from "@/components/OrderDetailsModal";
import { TrackingCell } from "@/components/TrackingCell";
import type { EditorLine } from "@/components/OrderItemsEditor";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { listItemNames } from "@/lib/order-totals";
import type { CallSession, Order } from "@/lib/types";
import { displayOrderId, isPendingOrderId } from "@/lib/types";

export interface CareStaff {
  name: string;
  email: string;
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
  /**
   * The open lead is HELD, not looked up in the current page.
   *
   * It used to be `rows.find(o => o.id === openId)`, so the popup existed only
   * as long as its row happened to be among the twenty-five on screen. The
   * shell re-renders the route every sixty seconds, and any refresh that
   * returned a page without that row closed the popup — mid-sentence, with
   * whatever had been typed in it. Agents reported leads vanishing while they
   * were still filling them in, before they had even reached the status.
   *
   * A refresh now updates the copy being shown when it brings a newer one, and
   * leaves it alone when it does not. Only Close closes it.
   */
  const [openOrder, setOpenOrder] = useState<Order | null>(null);

  useEffect(() => setRows(orders), [orders]);

  useEffect(() => {
    setOpenOrder((current) => (current ? orders.find((o) => o.id === current.id) ?? current : current));
  }, [orders]);

  useEffect(() => {
    if (!initialOpenOrderNumber) return;
    const match = orders.find((o) => o.order_number === initialOpenOrderNumber);
    if (match) setOpenOrder(match);
    // Only for the initial deep-link, not on every refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenOrderNumber]);

  // By id, which is what "Return to active call" has to hand.
  useEffect(() => {
    if (!initialOpenOrderId) return;
    const match = orders.find((o) => o.id === initialOpenOrderId);
    if (match) setOpenOrder(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenOrderId]);

  function handleSaved(updated: Order) {
    setRows((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
    setOpenOrder((current) => (current && current.id === updated.id ? updated : current));
    router.refresh();
  }

  // One row per lead, one line per row. Every cell keeps its content on a single
  // line: an agent scans this table down the customer-name column, and a row
  // that grows to three lines because one address wrapped costs more than the
  // truncation does.
  const cell = "px-2.5 py-1.5 text-slate-600 whitespace-nowrap";

  return (
    <>
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[2250px] text-left text-table">
          <thead className="sticky top-0 z-20 bg-slate-50 text-table font-medium uppercase tracking-wide text-slate-500 shadow-sm">
            <tr>
              <th className="sticky left-0 z-30 whitespace-nowrap bg-slate-50 px-2.5 py-2">Order ID</th>
              <th className="px-2.5 py-2">Order Date</th>
              <th className="px-2.5 py-2">Order Source</th>
              <th className="px-2.5 py-2">Customer Name</th>
              <th className="px-2.5 py-2">Phone Number</th>
              <th className="px-2.5 py-2">Address (Purok)</th>
              <th className="px-2.5 py-2">Province</th>
              <th className="px-2.5 py-2">City / Municipality</th>
              <th className="px-2.5 py-2">Barangay</th>
              <th className="px-2.5 py-2">Landmark</th>
              <th className="px-2.5 py-2">Notes</th>
              <th className="px-2.5 py-2">New Product Order</th>
              <th className="px-2.5 py-2">Unit Price</th>
              <th className="px-2.5 py-2">Tag</th>
              <th className="px-2.5 py-2">Courier</th>
              <th className="px-2.5 py-2">Tracking Number</th>
              <th className="px-2.5 py-2">Status</th>
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
                  <td className={cn("sticky left-0 z-10 whitespace-nowrap px-2.5 py-1.5", style.row)}>
                    <button
                      type="button"
                      onClick={() => setOpenOrder(o)}
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
                    <span className="block max-w-[14rem] truncate">{o.notes || "—"}</span>
                  </td>
                  {/* The cell names the first product and counts the rest; the
                      tooltip names them all. */}
                  <td className={cell} title={listItemNames(linesByOrder[o.id] || []) || undefined}>
                    {productNameByOrderId[o.id] || o.product_name || "—"}
                  </td>
                  <td className={cell}>{o.unit_price != null ? formatCurrency(o.unit_price) : "—"}</td>
                  <td className={cell}>{o.tag || "—"}</td>
                  <td className={cell}>{o.courier || "—"}</td>
                  <td className={cell}>
                    <TrackingCell value={o.tracking_number} />
                  </td>
                  <td className="px-2.5 py-1.5">
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
          onClose={() => setOpenOrder(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
