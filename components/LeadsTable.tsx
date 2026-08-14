"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge, SyncStatusChip, LEAD_STATUS_STYLES } from "@/components/ui/Badge";
import { OrderDetailsModal } from "@/components/OrderDetailsModal";
import { TrackingCell } from "@/components/TrackingCell";
import type { EditorLine } from "@/components/OrderItemsEditor";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { listItemNames } from "@/lib/order-totals";
import { useGridKeys } from "@/components/useGridKeys";
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
  latestStatusUpdateByOrderId: Record<string, { status: OrderStatus; from: string | null; at: string } | undefined>;
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
  /**
   * The open lead is HELD, not looked up in the current page — see the same
   * note in AgentLeadsTable. Deriving it from the rows meant the shell's
   * sixty-second refresh could close the popup, and whatever had been typed
   * into it, the moment a refresh returned a page without that row.
   */
  const [openOrder, setOpenOrder] = useState<Order | null>(null);

  useEffect(() => {
    setOrders(initialOrders);
  }, [initialOrders]);

  useEffect(() => {
    setOpenOrder((current) => (current ? initialOrders.find((o) => o.id === current.id) ?? current : current));
  }, [initialOrders]);

  useEffect(() => {
    if (!initialOpenOrderNumber) return;
    const match = initialOrders.find((o) => o.order_number === initialOpenOrderNumber);
    if (match) setOpenOrder(match);
    // Only run for the initial deep-link, not on every orders refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenOrderNumber]);

  // By id, which is what "Return to active call" has to hand: the call is on
  // an order id, and the page pins that order into the rows so this always
  // finds it.
  useEffect(() => {
    if (!initialOpenOrderId) return;
    const match = initialOrders.find((o) => o.id === initialOpenOrderId);
    if (match) setOpenOrder(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenOrderId]);

  // Spreadsheet keys over the rows on screen: arrows move a cell cursor, Enter
  // opens the lead under it, Ctrl+C copies that row as tab-separated text that
  // pastes into Excel as cells. Off while the popup is open, which owns the
  // keyboard and has fields of its own.
  const grid = useGridKeys({
    rowCount: orders.length,
    onEnter: (i) => setOpenOrder(orders[i]),
    enabled: !openOrder,
  });

  function handleSaved(updated: Order) {
    setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
    setOpenOrder((current) => (current && current.id === updated.id ? updated : current));
    router.refresh();
  }

  // Matches the agent table: one line per row, truncation over wrapping. A
  // supervisor reads down a column here, and a row that grows to three lines
  // because one landmark wrapped costs more than the truncation does.
  const cell = "border-r border-slate-100 px-2.5 py-1.5 text-slate-600 whitespace-nowrap";

  return (
    <>
      {/* Capped height, so the table scrolls inside its own box rather than
          making the page longer. That is what keeps the sideways scrollbar
          reachable: it sits at the bottom edge of what you can see instead of
          below twenty-five rows, and seventeen columns of a 2200px table were
          otherwise only reachable by scrolling to the end of the page first.
          The agent table has worked this way all along. */}
      <div
        {...grid.containerProps}
        className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
      >
        <table className="w-full min-w-[2800px] text-left text-table">
          <thead className="sticky top-0 z-20 bg-slate-50 text-table font-medium uppercase tracking-wide text-slate-500 shadow-sm">
            <tr>
              {/* Above the body's own sticky column (z-10), so the two do not
                  cross at the corner where both are pinned. */}
              <th className="sticky left-0 z-30 whitespace-nowrap border-r border-slate-200 bg-slate-50 px-2.5 py-2">Order ID</th>
              <th className="border-r border-slate-200 px-2.5 py-2">Order Date</th>
              <th className="border-r border-slate-200 px-2.5 py-2">Agent</th>
              <th className="border-r border-slate-200 px-2.5 py-2">Customer Name</th>
              <th className="border-r border-slate-200 px-2.5 py-2">Phone Number</th>
              <th className="border-r border-slate-200 px-2.5 py-2">Purok</th>
              <th className="border-r border-slate-200 px-2.5 py-2">Barangay</th>
              <th className="border-r border-slate-200 px-2.5 py-2">City</th>
              <th className="border-r border-slate-200 px-2.5 py-2">Province</th>
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
              {/* The two columns this table was missing. A supervisor chasing a
                  parcel had to open each order to find out who is carrying it
                  and under what number — the agents' own table has shown both
                  all along. */}
              <th className="border-r border-slate-200 px-2.5 py-2">Courier</th>
              <th className="border-r border-slate-200 px-2.5 py-2">Tracking Number</th>
              <th className="border-r border-slate-200 px-2.5 py-2">Status</th>
              <th className="border-r border-slate-200 px-2.5 py-2">Pancake Sync</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {orders.map((o) => {
              const style = LEAD_STATUS_STYLES[o.status];
              return (
                <tr key={o.id} className={cn(style.row, style.rowHover)}>
                  <td className={cn("sticky left-0 z-10 whitespace-nowrap border-r border-slate-100 px-2.5 py-1.5", style.row)}>
                    <button
                      type="button"
                      onClick={() => setOpenOrder(o)}
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
                  <td className={cell}>{o.order_date ? formatDate(o.order_date) : "—"}</td>
                  <td className={cell}>{agentUsernameById[o.agent_id] || "—"}</td>
                  <td className={cell}>{o.customer_name}</td>
                  <td className={cell}>{o.customer_phone || "—"}</td>
                  <td className={cell}>{o.purok || "—"}</td>
                  <td className={cell}>{o.barangay || "—"}</td>
                  <td className={cell}>{o.city || "—"}</td>
                  <td className={cell}>{o.province || "—"}</td>
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
                  {/* The cell names the first product and counts the rest; the
                      tooltip names them all. */}
                  <td className={cell} title={listItemNames(linesByOrder[o.id] || []) || undefined}>
                    {o.product_name || "—"}
                  </td>
                  <td className={cell}>{o.unit_price != null ? formatCurrency(o.unit_price) : "—"}</td>
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
                  <td className="border-r border-slate-100 px-2.5 py-1.5">
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
          onClose={() => setOpenOrder(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
