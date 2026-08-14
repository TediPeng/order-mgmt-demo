"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SyncStatusChip, LEAD_STATUS_STYLES } from "@/components/ui/Badge";
import { OrderDetailsModal } from "@/components/OrderDetailsModal";
import { TrackingCell } from "@/components/TrackingCell";
import type { EditorLine } from "@/components/OrderItemsEditor";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { useGridKeys } from "@/components/useGridKeys";
import { LeadCallCell, LeadStatusCell } from "@/components/LeadStatusCell";
import { MAX_ATTEMPTS } from "@/lib/pancake/retry";
import type { CallSession, Order, OrderStatus } from "@/lib/types";
import { shortOrderId, isPendingOrderId } from "@/lib/types";

export function LeadsTable({
  orders: initialOrders,
  agentCallNameById,
  productNameByOrderId,
  latestStatusUpdateByOrderId,
  activeProducts,
  linesByOrder,
  canEdit,
  canManageIntegrations = false,
  canSetFulfillmentStatus = false,
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
  /** Call Name per agent — what the floor calls them, not their login. */
  agentCallNameById: Record<string, string>;
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
        <table className="w-full min-w-[2650px] text-left text-table">
          <thead className="sticky top-0 z-20 bg-slate-50 text-table font-medium uppercase tracking-wide text-slate-500 shadow-sm">
            <tr>
              {/* Above the body's own sticky column (z-10), so the two do not
                  cross at the corner where both are pinned. */}
              <th className="sticky left-0 z-30 whitespace-nowrap border-r border-slate-200 bg-slate-50 px-2.5 py-2">Order ID</th>
              {/* Same order as the agents' table and as TEST TEMPLATE ROMA, so
                  a supervisor comparing the two screens — or either against the
                  spreadsheet — is reading one layout. */}
              <th className="whitespace-nowrap border-r border-slate-200 px-2.5 py-2">PREV Status</th>
              <th className="whitespace-nowrap border-r border-slate-200 px-2.5 py-2">Order Date</th>
              <th className="whitespace-nowrap border-r border-slate-200 px-2.5 py-2">Agent</th>
              <th className="whitespace-nowrap border-r border-slate-200 px-2.5 py-2">Customer</th>
              <th className="whitespace-nowrap border-r border-slate-200 px-2.5 py-2">Number</th>
              <th className="whitespace-nowrap border-r border-slate-200 px-2.5 py-2">Purok</th>
              <th className="whitespace-nowrap border-r border-slate-200 px-2.5 py-2">Barangay</th>
              <th className="whitespace-nowrap border-r border-slate-200 px-2.5 py-2">City</th>
              <th className="whitespace-nowrap border-r border-slate-200 px-2.5 py-2">Province</th>
              <th className="whitespace-nowrap border-r border-slate-200 px-2.5 py-2">LM</th>
              <th className="whitespace-nowrap border-r border-slate-200 px-2.5 py-2">Notes</th>
              <th className="whitespace-nowrap border-r border-slate-200 px-2.5 py-2">Prev Date</th>
              <th className="whitespace-nowrap border-r border-slate-200 px-2.5 py-2">Prev Order</th>
              <th className="whitespace-nowrap border-r border-slate-200 px-2.5 py-2">Prev AMT</th>
              <th className="whitespace-nowrap border-r border-slate-200 px-2.5 py-2">New Order</th>
              <th className="whitespace-nowrap border-r border-slate-200 px-2.5 py-2">Amount</th>
              <th className="whitespace-nowrap border-r border-slate-200 px-2.5 py-2">Courier</th>
              <th className="whitespace-nowrap border-r border-slate-200 px-2.5 py-2">Tracking Number</th>
              <th className="whitespace-nowrap border-r border-slate-200 px-2.5 py-2">Status</th>
              <th className="whitespace-nowrap border-r border-slate-200 px-2.5 py-2">Pancake Sync</th>
              {/* Pinned to the right edge, the way Order ID is pinned to the left: the call is reachable from any horizontal scroll position. */}
              <th className="sticky right-0 z-30 whitespace-nowrap border-l border-slate-200 bg-slate-50 px-2.5 py-2">Call</th>
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
                      // The cell drops the "ORD-" prefix to keep the pinned
                      // column narrow, so the tooltip carries the whole thing.
                      title={
                        isPendingOrderId(o)
                          ? `${o.order_number} — not yet forwarded to Pancake POS`
                          : `Pancake ID ${o.pancake_order_id} · internal reference ${o.order_number}`
                      }
                      className={cn(
                        "font-medium hover:underline",
                        isPendingOrderId(o) ? "text-slate-400" : "text-[var(--brand-primary)]"
                      )}
                    >
                      {shortOrderId(o)}
                      {isPendingOrderId(o) && (
                        <span className="ml-1 text-amber-500" aria-label="Not yet forwarded to Pancake POS">•</span>
                      )}
                    </button>
                  </td>
                  {/* Text, not a badge: the column can hold a status an import
                      named that this system does not have, and a second badge
                      in the row would read as one lead in two states. */}
                  <td className={cell}>{o.previous_order_status ? o.previous_order_status.toUpperCase() : "—"}</td>
                  <td className={cell}>{o.order_date ? formatDate(o.order_date) : "—"}</td>
                  <td className={cell}>{agentCallNameById[o.agent_id] || "—"}</td>
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
                  {/* The template's AMOUNT: the order's total, which is what is
                      said to the customer and what Prev Amount is on the other
                      side of the row. Unit price lives in the popup. */}
                  <td className={cell}>{formatCurrency(o.total_amount)}</td>
                  <td className={cell}>{o.courier || "—"}</td>
                  <td className={cell}>
                    <TrackingCell value={o.tracking_number} />
                  </td>
                  {/* Where the lead stands, and the call that moves it. */}
                  <td className="border-r border-slate-100 px-2.5 py-1.5">
                    <LeadStatusCell order={o} previousStatus={latestStatusUpdateByOrderId[o.id]?.from ?? null} />
                  </td>
                  <td className="border-r border-slate-100 px-2.5 py-1.5">
                    <SyncStatusChip
                      status={o.pancake_sync_status}
                      needsReview={o.pancake_sync_status === "sync_failed" && o.pancake_retry_count >= MAX_ATTEMPTS}
                    />
                  </td>
                  {/* Its own column, pinned right: a reading and a control are
                      two different things, and the control stays reachable
                      however far the row is scrolled. */}
                  <td className={cn("sticky right-0 z-10 border-l border-slate-200 px-2.5 py-1.5", style.row)}>
                    <LeadCallCell order={o} onOpen={() => setOpenOrder(o)} />
                  </td>
                </tr>
              );
            })}
            {orders.length === 0 && (
              <tr>
                <td colSpan={22} className="px-4 py-10 text-center text-slate-400">
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
          agentName={agentCallNameById[openOrder.agent_id] || "—"}
          productName={productNameByOrderId[openOrder.id] || openOrder.product_name}
          latestStatusUpdate={latestStatusUpdateByOrderId[openOrder.id] || null}
          activeProducts={activeProducts}
          initialLines={linesByOrder[openOrder.id] ?? []}
          canEdit={canEdit}
          canManageIntegrations={canManageIntegrations}
          canSetFulfillmentStatus={canSetFulfillmentStatus}
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
