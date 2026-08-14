"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge, LEAD_STATUS_STYLES } from "@/components/ui/Badge";
import { OrderDetailsModal } from "@/components/OrderDetailsModal";
import { TrackingCell } from "@/components/TrackingCell";
import type { EditorLine } from "@/components/OrderItemsEditor";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { useGridKeys } from "@/components/useGridKeys";
import type { CallSession, Order, OrderStatus } from "@/lib/types";
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
  latestStatusUpdateByOrderId = {},
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
  /** The last status change per order, for the "from X" line under the badge. */
  latestStatusUpdateByOrderId?: Record<string, { status: OrderStatus; from: string | null; at: string } | undefined>;
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

  // Spreadsheet keys over the rows on screen: arrows move a cell cursor, Enter
  // opens the lead under it, Ctrl+C copies that row as tab-separated text that
  // pastes into Excel as cells. Off while the popup is open, which owns the
  // keyboard and has fields of its own.
  const grid = useGridKeys({
    rowCount: rows.length,
    onEnter: (i) => setOpenOrder(rows[i]),
    enabled: !openOrder,
  });

  function handleSaved(updated: Order) {
    setRows((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
    setOpenOrder((current) => (current && current.id === updated.id ? updated : current));
    router.refresh();
  }

  // One row per lead, one line per row. Every cell keeps its content on a single
  // line: an agent scans this table down the customer-name column, and a row
  // that grows to three lines because one address wrapped costs more than the
  // truncation does.
  const cell = "border-r border-slate-100 px-2.5 py-1.5 text-slate-600 whitespace-nowrap";

  return (
    <>
      <div
        {...grid.containerProps}
        className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
      >
        <table className="w-full min-w-[2850px] text-left text-table">
          <thead className="sticky top-0 z-20 bg-slate-50 text-table font-medium uppercase tracking-wide text-slate-500 shadow-sm">
            <tr>
              <th className="sticky left-0 z-30 whitespace-nowrap border-r border-slate-200 bg-slate-50 px-2.5 py-2">Order ID</th>
              <th className="border-r border-slate-200 px-2.5 py-2">Order Date</th>
              <th className="border-r border-slate-200 px-2.5 py-2">Order Source</th>
              <th className="border-r border-slate-200 px-2.5 py-2">Customer Name</th>
              <th className="border-r border-slate-200 px-2.5 py-2">Phone Number</th>
              <th className="border-r border-slate-200 px-2.5 py-2">Address (Purok)</th>
              <th className="border-r border-slate-200 px-2.5 py-2">Province</th>
              <th className="border-r border-slate-200 px-2.5 py-2">City / Municipality</th>
              <th className="border-r border-slate-200 px-2.5 py-2">Barangay</th>
              <th className="border-r border-slate-200 px-2.5 py-2">Landmark</th>
              <th className="border-r border-slate-200 px-2.5 py-2">Notes</th>
              {/* The customer's last purchase, back in the list where an agent
                  can see it while dialling: what they bought, when, for how
                  much, and how that order ended. It sat only in the popup, so
                  the one fact that opens a call was a click away on every row. */}
              <th className="border-r border-slate-200 px-2.5 py-2">Previous Order Date</th>
              <th className="border-r border-slate-200 px-2.5 py-2">Previous Order Product</th>
              <th className="border-r border-slate-200 px-2.5 py-2">Previous Order Amount</th>
              <th className="border-r border-slate-200 px-2.5 py-2">Previous Status</th>
              <th className="border-r border-slate-200 px-2.5 py-2">New Product Order</th>
              <th className="border-r border-slate-200 px-2.5 py-2">Unit Price</th>
              <th className="border-r border-slate-200 px-2.5 py-2">Tag</th>
              <th className="border-r border-slate-200 px-2.5 py-2">Courier</th>
              <th className="border-r border-slate-200 px-2.5 py-2">Tracking Number</th>
              <th className="border-r border-slate-200 px-2.5 py-2">Status</th>
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
                  <td className={cn("sticky left-0 z-10 whitespace-nowrap border-r border-slate-100 px-2.5 py-1.5", style.row)}>
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
                  <td className={cell}>{o.previous_order_date ? formatDate(o.previous_order_date) : "—"}</td>
                  <td className={cell} title={o.previous_order_product || undefined}>
                    <span className="block max-w-[14rem] truncate">{o.previous_order_product || "—"}</span>
                  </td>
                  <td className={cell}>
                    {o.previous_order_amount != null ? formatCurrency(o.previous_order_amount) : "—"}
                  </td>
                  {/* Text, not a badge: the column can hold a status an import
                      named that this system does not have, and it sits a few
                      cells from the badge for the CURRENT status — two badges
                      in one row would read as one lead in two states. */}
                  <td className={cell}>{o.previous_order_status ? o.previous_order_status.toUpperCase() : "—"}</td>
                  {/* Every product, one per line. The cell used to name the
                      first and count the rest — "+1 more" is the least useful
                      thing that can be said about what somebody is buying, and
                      an agent reading it aloud on a call had to open the order
                      to find out. Of the orders that carry lines, most have two
                      or three and the largest has five, so the row grows by a
                      line or two and only where there is something to show. */}
                  <td className="border-r border-slate-100 px-2.5 py-1.5 text-slate-600">
                    {(() => {
                      const names = (linesByOrder[o.id] || []).map((l) => l.product_name).filter(Boolean);
                      // No lines is the ordinary case for an imported lead: it
                      // never went through the line editor, so the order's own
                      // product field is all there is.
                      if (names.length === 0) return productNameByOrderId[o.id] || o.product_name || "—";
                      return names.map((name, i) => (
                        <span key={i} className="block whitespace-nowrap">
                          {name}
                        </span>
                      ));
                    })()}
                  </td>
                  <td className={cell}>{o.unit_price != null ? formatCurrency(o.unit_price) : "—"}</td>
                  <td className={cell}>{o.tag || "—"}</td>
                  <td className={cell}>{o.courier || "—"}</td>
                  <td className={cell}>
                    <TrackingCell value={o.tracking_number} />
                  </td>
                  <td className="border-r border-slate-100 px-2.5 py-1.5">
                    {/* Where it came from, above where it is. "CBR" alone does
                        not say whether a lead has just been picked up or given
                        up on; "from NEW" does. Only on rows that have actually
                        moved — a lead nobody has touched shows the badge alone. */}
                    {(() => {
                      const change = latestStatusUpdateByOrderId[o.id];
                      const from = change && change.from !== o.status ? change.from : null;
                      return from ? (
                        <span className="block text-[10px] uppercase leading-none text-slate-400">from {from.replace(/_/g, " ")}</span>
                      ) : null;
                    })()}
                    <StatusBadge status={o.status} />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={21} className="px-4 py-10 text-center text-slate-400">
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
