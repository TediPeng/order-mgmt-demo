"use server";

import { redirect } from "next/navigation";
import { writeDb, uuid, nowIso, nextOrderNumber, queueDelete } from "@/lib/db";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { orderInScope, allowedAssigneeIds } from "@/lib/order-access";
import { getActiveSessionForOrder, endSession } from "@/lib/call-sessions";
import { isFullAccess } from "@/lib/permissions";
import { requireUser, requirePermission, requireAdministrator } from "./guards";
import { describeParseFailure } from "@/lib/zod-error";
import { leadFormSchema, leadImportRowSchema, normalizePreviousStatus, parseOrderItemFields, type OrderItemFields, PACKAGING_STATUS, PRE_SALE_STATUSES } from "@/lib/validation";
import { listItems, replaceItems, summarizeItems, totalsFor } from "@/lib/order-items";
import type { OrderItemInput } from "@/lib/types";
import { matchAgentByCallName } from "@/lib/agent-match";
import { todayInTz, restoreTrunkZero } from "@/lib/utils";
import {
  validatePackaging,
  restrictedStatusBlockReason,
  pipelineBlockReason,
  computeOrderDate,
  findPreviousOrderInfo,
  buildPreviousOrderIndex,
  previousOrderFor,
  fulfillmentOverrideBlockReason,
  lockedEditBlockReason,
} from "@/lib/lead-workflow";
import { timeInBlockReason } from "@/lib/time-in-gate";
import { findRegularCustomerByPhone, getCustomer, recordCustomerOrder } from "@/lib/customers";
import { forwardOrderToPancake } from "@/lib/pancake/forward";
import { computeOrderTotal, validateForPancake } from "@/lib/pancake/validate";
import { verifyOrderAddress } from "@/lib/pancake/verifyAddress";
import { insertSyncLog } from "@/lib/pancake/store";
import type { DbShape, Order, Profile } from "@/lib/types";
import { ORDER_PANCAKE_DEFAULTS } from "@/lib/types";

function buildLeadFieldErrors(formData: FormData): Record<string, unknown> {
  // FormData.get() answers `null` for a field the form does not contain, and
  // Zod's .optional()/.default() only substitute for `undefined` — a null makes
  // z.string() fail outright. Not every form posts every field (the Regular
  // Customer form deliberately dropped courier, payment method, order source,
  // the variant and the previous-order trio), so absent fields are mapped to
  // undefined here and the schema's own defaults fill them in.
  const field = (name: string): unknown => formData.get(name) ?? undefined;
  const numeric = (name: string): unknown => {
    const raw = formData.get(name);
    return raw === null || raw === "" ? null : raw;
  };

  return {
    customer_name: field("customer_name"),
    customer_phone: field("customer_phone"),
    purok: field("purok"),
    barangay: field("barangay"),
    city: field("city"),
    province: field("province"),
    landmark: field("landmark"),
    previous_order_date: field("previous_order_date"),
    previous_order_product: field("previous_order_product"),
    previous_order_amount: numeric("previous_order_amount"),
    previous_order_note: field("previous_order_note"),
    previous_order_status: field("previous_order_status"),
    product_id: field("product_id"),
    quantity: field("quantity"),
    unit_price: numeric("unit_price"),
    status: formData.get("status") || "new",
    notes: field("notes"),
    agent_id: field("agent_id"),
    shipping_fee: numeric("shipping_fee"),
    courier: field("courier"),
    payment_method: field("payment_method"),
    order_source: field("order_source"),
    province_code: field("province_code"),
    city_code: field("city_code"),
    barangay_code: field("barangay_code"),
    pancake_province_id: field("pancake_province_id"),
    pancake_district_id: field("pancake_district_id"),
    pancake_commune_id: field("pancake_commune_id"),
    discount: numeric("discount"),
    variant: field("variant"),
  };
}

export async function createLeadAction(formData: FormData) {
  const { user, db } = await requireUser();
  requirePermission(user, "orders", "create", db, "/leads/new");

  // Creating a lead requires being timed in (Section 2). Adding a regular
  // customer deliberately does not — see app/(app)/regular-customers/new.
  const notTimedIn = timeInBlockReason(db, user);
  if (notTimedIn) redirect(`/leads/new?error=${encodeURIComponent(notTimedIn)}&time_in_required=1`);

  const raw = buildLeadFieldErrors(formData);
  const allowed = allowedAssigneeIds(user, db);
  if (!raw.agent_id || !allowed.includes(String(raw.agent_id))) raw.agent_id = user.id;

  const parsed = leadFormSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(`/leads/new?error=${encodeURIComponent(describeParseFailure(parsed.error))}`);
  }
  const data = parsed.data;

  // Section 3: `New` is the system's own starting point and is never
  // agent-settable. Enforced here as well as hidden from the dropdown, so a
  // crafted request cannot post it either.
  const restricted = restrictedStatusBlockReason(data.status, isFullAccess(user.role));
  if (restricted) redirect(`/leads/new?error=${encodeURIComponent(restricted)}`);

  const blocked = pipelineBlockReason({ order_date: null }, data.status);
  if (blocked) redirect(`/leads/new?error=${encodeURIComponent(blocked)}`);

  const now = nowIso();
  const today = todayInTz();
  const assignedAgent = db.profiles.find((p) => p.id === data.agent_id);
  const product = data.product_id ? db.products.find((p) => p.id === data.product_id) : undefined;

  // Line items. The form may post repeated line fields, or — while the
  // single-product form is still in use — none at all, in which case the one
  // product it does carry becomes the single line. Either way order_items ends
  // up authoritative, so nothing downstream needs to know which form it came
  // from.
  const postedItems = parseOrderItemFields(formData);
  const items: OrderItemInput[] = (
    postedItems ??
    // A lead with no product selected is a legitimate state — it has not been
    // quoted yet — and produces no lines rather than a nameless one.
    (data.product_id
      ? [
          {
            product_id: data.product_id,
            variant: data.variant || "",
            quantity: data.quantity,
            unit_price: data.unit_price ?? 0,
            discount: data.discount ?? 0,
          },
        ]
      : [])
  ).map((line) => {
    const lineProduct = line.product_id ? db.products.find((p) => p.id === line.product_id) : undefined;
    return {
      product_id: line.product_id || null,
      // Resolved from the catalogue, never taken from the request.
      product_name: lineProduct?.name || "",
      variant: line.variant || null,
      quantity: line.quantity,
      unit_price: line.unit_price,
      discount: line.discount,
    };
  });

  const totals = totalsFor(items, data.shipping_fee ?? null);
  const firstLine = items[0];

  // Checked here rather than earlier, because "does this order have a product"
  // is now a question about its lines. The multi-line editor does not post a
  // single product_id, so validating against that field would refuse every
  // multi-line order moving into Packaging.
  if (data.status === PACKAGING_STATUS) {
    const missing = validatePackaging({
      ...data,
      product_id: firstLine?.product_id ?? (data.product_id || null),
      quantity: items.length > 0 ? totals.quantity : data.quantity,
    });
    if (missing.length > 0) {
      redirect(`/leads/new?error=${encodeURIComponent(`Missing required fields for Packaging: ${missing.join(", ")}`)}`);
    }
  }

  const hasProvidedPreviousInfo =
    data.previous_order_date ||
    data.previous_order_product ||
    data.previous_order_amount != null ||
    data.previous_order_note ||
    data.previous_order_status;
  const previousInfo = hasProvidedPreviousInfo ? null : findPreviousOrderInfo(db, data.customer_phone || "");

  const order: Order = {
    id: uuid(),
    order_number: nextOrderNumber(db),
    customer_name: data.customer_name,
    customer_phone: data.customer_phone || "",
    purok: data.purok || "",
    barangay: data.barangay || "",
    city: data.city || "",
    province: data.province || "",
    landmark: data.landmark || "",
    previous_order_date: data.previous_order_date || previousInfo?.date || null,
    previous_order_product: data.previous_order_product || previousInfo?.product || null,
    previous_order_amount: data.previous_order_amount ?? previousInfo?.amount ?? null,
    previous_order_note: data.previous_order_note || previousInfo?.note || null,
    previous_order_status: normalizePreviousStatus(data.previous_order_status) || previousInfo?.status || null,
    // These stay on the order as its summary, so lists, dashboards, exports
    // and the Pancake payload keep reading one row per order. With lines they
    // are derived; with none they fall back to what the form posted, which is
    // the same values the single-product form always produced.
    product_id: firstLine?.product_id ?? (data.product_id || null),
    product_name: items.length > 0 ? summarizeItems(items) : product?.name || "",
    // Section 0.6: Quantity is back on the agent form and feeds the line total
    // and the Pancake payload. Across lines it is the total units.
    quantity: items.length > 0 ? totals.quantity : data.quantity,
    unit_price: firstLine ? firstLine.unit_price : data.unit_price ?? null,
    total_amount:
      items.length > 0
        ? totals.total
        : computeOrderTotal({
            unit_price: data.unit_price ?? null,
            quantity: data.quantity,
            discount: data.discount ?? 0,
            shipping_fee: data.shipping_fee ?? null,
          }),
    status: data.status,
    order_date: data.status === PACKAGING_STATUS ? today : null,
    source: "manual",
    ...ORDER_PANCAKE_DEFAULTS,
    // After the defaults spread, which would otherwise null these back out.
    // Pancake's own address IDs, straight from the Select Address picker.
    pancake_province_id: data.pancake_province_id || null,
    pancake_district_id: data.pancake_district_id || null,
    pancake_commune_id: data.pancake_commune_id || null,
    shipping_fee: data.shipping_fee ?? null,
    courier: data.courier || null,
    payment_method: data.payment_method || null,
    order_source: assignedAgent?.call_name || null,
    // The sum of the line discounts, not a separate figure — one order cannot
    // have two discounts that disagree.
    discount: items.length > 0 ? totals.discount : data.discount ?? 0,
    variant: firstLine ? firstLine.variant : data.variant || null,
    notes: data.notes || "",
    created_by: user.id,
    updated_by: null,
    agent_id: data.agent_id,
    assigned_agent_email: assignedAgent?.email || "",
    created_at: now,
    updated_at: now,
  };
  // Stable external reference Pancake echoes back on status updates.
  order.system_order_id = order.order_number;

  // A regular customer stays a regular customer. An order taken for someone the
  // assigned agent already keeps joins that customer's record instead of
  // landing back in their Leads list — otherwise every repeat purchase would
  // quietly re-add them as a lead, which is exactly what the section exists to
  // prevent. The order itself is untouched in every other respect.
  //
  // `customer_id` is posted when the order was raised from the customer's own
  // record ("New Order" on Regular Customers). It is trusted only after the
  // customer is confirmed to belong to the assigned agent, since a form field
  // is not proof of ownership. Otherwise the phone number decides, which also
  // covers an order typed straight into the lead form.
  const postedCustomerId = String(formData.get("customer_id") || "").trim();
  const claimed = postedCustomerId ? await getCustomer(postedCustomerId) : null;
  const regular =
    claimed && claimed.is_regular_customer && claimed.owner_agent_id === order.agent_id
      ? claimed
      : await findRegularCustomerByPhone(order.customer_phone, order.agent_id);
  if (regular) {
    order.customer_id = regular.id;
    order.is_regular_customer = true;
    order.regular_customer_since = regular.regular_since || now;
  }

  db.orders.push(order);
  const info = await getRequestInfo();
  logActivity(db, user.id, "LEAD_CREATED", "order", order.id, { order_number: order.order_number }, {
    module: "orders",
    ...info,
  });
  // The record of the process the client asked for: an order raised for a
  // regular customer is logged as its own event, naming the customer and
  // whether it started from their record or was matched by phone. Separate
  // from LEAD_CREATED so the customer's order history is auditable on its own.
  if (regular) {
    logActivity(db, user.id, "REGULAR_CUSTOMER_ORDER_CREATED", "customer", regular.id, {
      customer_name: regular.full_name,
      order_id: order.id,
      order_number: order.order_number,
      agent_id: order.agent_id,
      total_amount: order.total_amount,
      status: order.status,
      raised_from: claimed && claimed.id === regular.id ? "customer_record" : "phone_match",
    }, { module: "regular_customers", ...info });
  }
  await writeDb(db);

  // Order count on the customer row, kept in step outside the whole-database
  // write (the customers table is not part of DbShape).
  if (regular) {
    const total = db.orders.filter((o) => o.customer_id === regular.id).length;
    try {
      await recordCustomerOrder(regular.id, total);
    } catch (e) {
      logActivity(db, user.id, "CUSTOMER_TOTAL_ORDERS_WRITE_FAILED", "customer", regular.id, {
        order_number: order.order_number,
        error: (e as Error).message,
      }, { module: "regular_customers", ...info });
      await writeDb(db);
    }
  }

  // After writeDb, because the lines carry a foreign key to an order that has
  // to exist first. Its own query, outside the whole-database write.
  //
  // A failure here must not take the order down with it. The order is the
  // record of the sale and it is already committed; throwing now would show
  // the agent an error for an order that exists, and the likely response --
  // entering it again -- is worse than a missing line. Recorded instead, so
  // the gap is visible and repairable rather than silent.
  try {
    await replaceItems(order.id, items);
  } catch (e) {
    logActivity(db, user.id, "ORDER_ITEMS_WRITE_FAILED", "order", order.id, {
      order_number: order.order_number,
      lines: items.length,
      error: (e as Error).message,
    }, { module: "orders", ...info });
    await writeDb(db);
  }
  if (order.status === PACKAGING_STATUS) {
    // Forward AFTER persisting; the handler has its own duplicate/idempotency guards.
    await forwardOrderToPancake(order.id, { source: "packaging_event", triggeredBy: user.id });
  }
  redirect(`/leads/${order.id}?created=1`);
}

export type ApplyLeadUpdateResult =
  | {
      ok: true;
      order: Order;
      /** Status transitioned INTO packaging — callers trigger the Pancake forward after writeDb(). */
      enteredPackaging: boolean;
      /** Management manually changed the status of an already-forwarded order —
       * callers add a pancake_sync_logs entry with source internal_user. */
      manualFulfillmentOverride: { oldStatus: string; newStatus: string } | null;
      /** Lines to persist after writeDb() — they carry a foreign key to the
       * order, so they cannot be written before it exists. Null means this
       * save was not about the products and the existing lines stand. */
      items: OrderItemInput[] | null;
    }
  | { ok: false; code: "not_found" | "forbidden" | "validation"; error: string };

/** Core of a lead edit/status-update: validation, RTS gating, field writes, and
 * activity logging -- shared by the full-page form action (which redirects)
 * and the Order Details modal's API route (which returns JSON, no redirect).
 * Does not call writeDb(); callers persist once they've decided how to respond. */
export async function applyLeadUpdate(
  user: Profile,
  db: DbShape,
  orderId: string,
  raw: Record<string, unknown>,
  /** Lines from a multi-line form, or null when the caller posted no line
   * fields at all. Null is not "no lines" — it means this save is not about
   * the products, and the order's existing lines must survive it untouched.
   * Callers that never post lines (the JSON API) pass nothing. */
  postedItems: OrderItemFields[] | null = null
): Promise<ApplyLeadUpdateResult> {
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, code: "not_found", error: "Lead not found." };
  if (!orderInScope(user, order, db)) {
    return { ok: false, code: "forbidden", error: "You do not have access to that lead." };
  }

  // A synced order is frozen against manual edits from ANY role — the inputs are
  // disabled in the UI, and this is the check that actually enforces it, so a
  // crafted request cannot bypass a greyed-out field. An Administrator lifts it
  // deliberately through unlockOrderForEditingAction, which is audit-logged.
  const locked = lockedEditBlockReason(order);
  if (locked) return { ok: false, code: "forbidden", error: locked };

  // Processing an order or moving its status requires being timed in (Section 2).
  const notTimedIn = timeInBlockReason(db, user);
  if (notTimedIn) return { ok: false, code: "forbidden", error: notTimedIn };

  const requestedAgentId = String(raw.agent_id || order.agent_id);
  raw.agent_id = isFullAccess(user.role) ? requestedAgentId : order.agent_id;

  // Previous-order fields are informational-only for non-full-access roles.
  if (!isFullAccess(user.role)) {
    raw.previous_order_date = order.previous_order_date || "";
    raw.previous_order_product = order.previous_order_product || "";
    raw.previous_order_amount = order.previous_order_amount ?? null;
    raw.previous_order_note = order.previous_order_note || "";
    raw.previous_order_status = order.previous_order_status || "";
  }

  const parsed = leadFormSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "validation", error: describeParseFailure(parsed.error) };
  }
  const data = parsed.data;

  // Quantity is optional on the wire because partial updates (the modal's quick
  // status change) post a subset of fields — an omitted quantity must leave the
  // existing one alone rather than reset it to the schema default. A quantity
  // that IS supplied but nonsensical is an error, not something to quietly
  // replace with the old value. Resolved before the Packaging gate below so the
  // validation sees the value actually being saved.
  const rawQuantity = raw.quantity;
  const quantitySupplied = rawQuantity !== null && rawQuantity !== undefined && rawQuantity !== "";
  const parsedQuantity = quantitySupplied ? Number(rawQuantity) : NaN;
  if (quantitySupplied && (!Number.isInteger(parsedQuantity) || parsedQuantity < 1)) {
    return { ok: false, code: "validation", error: "Quantity must be a whole number of at least 1." };
  }
  const quantity = quantitySupplied ? parsedQuantity : order.quantity;

  // Statuses past Packaging belong to fulfillment. This is an authorization
  // decision, not a validation one, so it answers 403 — a hidden dropdown
  // option is not a control, and the same check has to hold for a crafted
  // request that never went near the UI.
  if (data.status !== order.status) {
    const restricted = restrictedStatusBlockReason(data.status, isFullAccess(user.role));
    if (restricted) return { ok: false, code: "forbidden", error: restricted };
  }

  // A status only moves while the agent has a calling session open on this
  // order. Enforced here, not by disabling the control: the point of the rule
  // is that every status change is attributable to a recorded call, which a
  // crafted request would otherwise sidestep. Management is exempt — they
  // correct records rather than make calls.
  const statusChanging = data.status !== order.status;
  let session = null;
  if (!isFullAccess(user.role)) {
    session = await getActiveSessionForOrder(user.id, order.id);
    if (statusChanging && !session) {
      return {
        ok: false,
        code: "forbidden",
        error: "Click Calling before updating this order's status.",
      };
    }
  }

  const blocked = pipelineBlockReason(order, data.status);
  if (blocked) return { ok: false, code: "validation", error: blocked };

  const fulfillmentBlocked = fulfillmentOverrideBlockReason(order, data.status, isFullAccess(user.role));
  if (fulfillmentBlocked) return { ok: false, code: "forbidden", error: fulfillmentBlocked };

  if (data.status === PACKAGING_STATUS) {
    // "Has a product" is a question about the lines once the editor is in use:
    // it posts no single product_id, and a save that posts no lines at all
    // must fall back to what the order already carries rather than reading an
    // absent field as absent product.
    const packagingProductId = postedItems
      ? postedItems.find((line) => line.product_id)?.product_id || null
      : data.product_id || order.product_id || null;
    const packagingQuantity = postedItems
      ? postedItems.reduce((sum, line) => sum + line.quantity, 0)
      : quantity;
    const missing = validatePackaging({ ...data, product_id: packagingProductId, quantity: packagingQuantity });
    if (missing.length > 0) {
      return {
        ok: false,
        code: "validation",
        error: `Missing required fields for Packaging: ${missing.join(", ")}`,
      };
    }
    // The address is verified against PANCAKE's own hierarchy, not PSGC: the
    // picker sources its options from Pancake, so this re-checks that the three
    // IDs still exist and still nest before the order can be forwarded. Names
    // are then taken from Pancake's response, so a stale or hand-edited label
    // can never disagree with the location actually selected.
    const address = await verifyOrderAddress({
      provinceId: data.pancake_province_id || order.pancake_province_id,
      districtId: data.pancake_district_id || order.pancake_district_id,
      communeId: data.pancake_commune_id || order.pancake_commune_id,
    });
    if (!address.ok) {
      return { ok: false, code: "validation", error: `Invalid address: ${address.error}` };
    }
    order.province = address.names.province;
    order.city = address.names.city;
    order.barangay = address.names.barangay;

    // Second gate: Pancake's own requirements. Checking here means a status
    // change that would fail at the API is refused up front, so the order is
    // never left mid-sync with a fixable field missing.
    const candidateProduct = data.product_id ? db.products.find((p) => p.id === data.product_id) : undefined;
    const pancakeCheck = validateForPancake({
      customer_name: data.customer_name,
      customer_phone: data.customer_phone || "",
      barangay: data.barangay || "",
      city: data.city || "",
      province: data.province || "",
      product_name: candidateProduct?.name || order.product_name,
      quantity,
      unit_price: data.unit_price ?? null,
      discount: data.discount ?? 0,
      shipping_fee: data.shipping_fee ?? null,
    });
    if (!pancakeCheck.ok) {
      return {
        ok: false,
        code: "validation",
        error: `Missing required Pancake fields: ${pancakeCheck.errors.map((e) => e.message).join(", ")}`,
      };
    }
  }

  const before = { ...order };
  const today = todayInTz();
  const newOrderDate = computeOrderDate(order, data.status, today);
  const isReassignment = isFullAccess(user.role) && data.agent_id !== before.agent_id;
  const product = data.product_id ? db.products.find((p) => p.id === data.product_id) : undefined;


  order.customer_name = data.customer_name;
  order.customer_phone = data.customer_phone || "";
  order.purok = data.purok || "";
  order.barangay = data.barangay || "";
  order.city = data.city || "";
  order.province = data.province || "";
  // Only overwrite a Pancake address ID when the form actually supplied one —
  // a partial update (the modal's quick status change) must not wipe it.
  order.pancake_province_id = data.pancake_province_id || order.pancake_province_id;
  order.pancake_district_id = data.pancake_district_id || order.pancake_district_id;
  order.pancake_commune_id = data.pancake_commune_id || order.pancake_commune_id;
  order.province_code = data.province_code || null;
  order.city_code = data.city_code || null;
  order.barangay_code = data.barangay_code || null;
  // A freshly picked address is by definition resolved.
  if (data.province_code && data.city_code && data.barangay_code) order.address_needs_review = false;
  order.landmark = data.landmark || "";
  order.previous_order_date = data.previous_order_date || null;
  order.previous_order_product = data.previous_order_product || null;
  order.previous_order_amount = data.previous_order_amount ?? null;
  order.previous_order_note = data.previous_order_note || null;
  order.previous_order_status = normalizePreviousStatus(data.previous_order_status) || null;
  // Clear product_name only on an explicit un-select (product_id was set and is
  // now blank); if product_id was already empty (a legacy free-text row) and
  // stays empty, leave the display text alone -- otherwise any save that
  // doesn't touch the product field (e.g. the modal's Update Status quick
  // action) silently wipes it.
  if (data.product_id) {
    order.product_name = product?.name || order.product_name;
  } else if (order.product_id) {
    order.product_name = "";
  }
  order.product_id = data.product_id || null;
  order.variant = data.variant || null;
  order.quantity = quantity;
  order.unit_price = data.unit_price ?? null;
  order.discount = data.discount ?? 0;
  order.shipping_fee = data.shipping_fee ?? null;
  order.total_amount = computeOrderTotal({
    unit_price: order.unit_price,
    quantity,
    discount: order.discount,
    shipping_fee: order.shipping_fee,
  });

  // Lines, and the summary columns that have to agree with them.
  //
  // When the form posted lines they are authoritative and the summary is
  // recomputed from them, overwriting what the single-product fields above
  // just wrote.
  //
  // When it posted none, the lines are left exactly as they are. That is what
  // stops a status change -- which carries no product fields -- from emptying
  // an order. The single exception is an order of at most one line, which is
  // mirrored from the fields above so the two do not drift apart while the
  // single-product form is still in use. An order with two or more lines is
  // never rebuilt from a single product, because that would silently collapse
  // it.
  let pendingItems: OrderItemInput[] | null = null;
  if (postedItems) {
    pendingItems = postedItems.map((line) => {
      const lineProduct = line.product_id ? db.products.find((p) => p.id === line.product_id) : undefined;
      return {
        product_id: line.product_id || null,
        product_name: lineProduct?.name || "",
        variant: line.variant || null,
        quantity: line.quantity,
        unit_price: line.unit_price,
        discount: line.discount,
      };
    });
    const totals = totalsFor(pendingItems, order.shipping_fee);
    const first = pendingItems[0];
    order.quantity = totals.quantity;
    order.discount = totals.discount;
    order.total_amount = totals.total;
    order.product_id = first?.product_id ?? null;
    order.product_name = pendingItems.length > 0 ? summarizeItems(pendingItems) : "";
    order.unit_price = first ? first.unit_price : null;
    order.variant = first ? first.variant : null;
  } else {
    const existing = await listItems(order.id);
    if (existing.length <= 1) {
      pendingItems = order.product_id
        ? [
            {
              product_id: order.product_id,
              product_name: order.product_name,
              variant: order.variant,
              quantity: order.quantity,
              unit_price: order.unit_price ?? 0,
              discount: order.discount,
            },
          ]
        : [];
    } else {
      // A multi-line order saved by a form that carries only one product —
      // the Order Details modal, which has not been converted yet. Its single
      // product field cannot describe this order, so the summary is rebuilt
      // from the lines instead of from what was posted. The lines themselves
      // are left alone.
      //
      // Without this the summary would quietly come to disagree with the
      // lines: the order would claim one product and a total to match, while
      // the lines it forwards and reports on say something else.
      const totals = totalsFor(existing, order.shipping_fee);
      order.quantity = totals.quantity;
      order.discount = totals.discount;
      order.total_amount = totals.total;
      order.product_id = existing[0].product_id;
      order.product_name = summarizeItems(existing);
      order.unit_price = existing[0].unit_price;
      order.variant = existing[0].variant;
    }
  }

  order.status = data.status;
  order.order_date = newOrderDate;
  order.courier = data.courier || null;
  order.payment_method = data.payment_method || null;
    // Re-derived rather than accepted from input: Order Source is the owning
  // agent's Call Name and must not be settable through the form.
  order.order_source = db.profiles.find((p) => p.id === order.agent_id)?.call_name || order.order_source;
  order.notes = data.notes || "";
  if (!order.system_order_id) order.system_order_id = order.order_number;
  if (isReassignment) {
    order.agent_id = data.agent_id;
    order.assigned_agent_email = db.profiles.find((p) => p.id === data.agent_id)?.email || "";
  }
  order.updated_by = user.id;
  order.updated_at = nowIso();

  // An Administrator unlock covers exactly one save; consuming it here means the
  // order relocks the moment those edits land.
  const consumedUnlock = order.manual_unlock_active;
  if (consumedUnlock) {
    order.manual_unlock_active = false;
    order.manual_unlock_reason = null;
    order.manual_unlock_by = null;
    order.manual_unlock_at = null;
  }

  const info = await getRequestInfo();
  if (consumedUnlock) {
    logActivity(db, user.id, "ORDER_RELOCKED", "order", order.id, { order_number: order.order_number }, {
      module: "orders",
      previous_value: { manual_unlock_active: true, manual_unlock_reason: before.manual_unlock_reason },
      updated_value: { manual_unlock_active: false },
      ...info,
    });
  }
  if (isReassignment) {
    logActivity(db, user.id, "LEAD_REASSIGNED", "order", order.id, { order_number: order.order_number }, {
      module: "orders",
      previous_value: { agent_id: before.agent_id, assigned_agent_email: before.assigned_agent_email },
      updated_value: { agent_id: order.agent_id, assigned_agent_email: order.assigned_agent_email },
      ...info,
    });
  }
  if (before.status !== order.status) {
    logActivity(db, user.id, "LEAD_STATUS_CHANGED", "order", order.id, { order_number: order.order_number }, {
      module: "orders",
      previous_value: { status: before.status, order_date: before.order_date },
      updated_value: { status: order.status, order_date: order.order_date },
      ...info,
    });
  }
  logActivity(
    db,
    user.id,
    "LEAD_UPDATED",
    "order",
    order.id,
    { order_number: order.order_number },
    { module: "orders", previous_value: before, updated_value: order, ...info }
  );

  // Close the calling session that licensed this edit, recording the
  // transition it produced. After the activity logging, so the audit trail
  // survives even if this write fails.
  if (session) {
    await endSession(session.id, {
      previousStatus: before.status,
      newStatus: order.status,
      remarks: typeof raw.call_remarks === "string" ? raw.call_remarks : null,
    });
    logActivity(
      db,
      user.id,
      "CALL_SESSION_ENDED",
      "order",
      order.id,
      { order_number: order.order_number, previous_status: before.status, new_status: order.status },
      { module: "orders", ...info }
    );
  }

  const forwarded = Boolean(before.pancake_order_id || before.forwarded_to_pancake_at);
  return {
    ok: true,
    order,
    enteredPackaging: before.status !== PACKAGING_STATUS && order.status === PACKAGING_STATUS,
    manualFulfillmentOverride:
      forwarded && before.status !== order.status ? { oldStatus: before.status, newStatus: order.status } : null,
    items: pendingItems,
  };
}

/** Writes an order's lines after the order itself is committed.
 *
 * Null means the save was not about the products and the existing lines stand
 * — doing nothing is the correct behaviour, not an oversight.
 *
 * A failure is recorded and swallowed for the same reason it is on create: the
 * order is already saved, and showing the agent an error for a save that
 * succeeded invites them to do it again. */
async function persistOrderItems(
  user: Profile,
  db: DbShape,
  order: Order,
  items: OrderItemInput[] | null
): Promise<void> {
  if (!items) return;
  try {
    await replaceItems(order.id, items);
  } catch (e) {
    const info = await getRequestInfo();
    logActivity(db, user.id, "ORDER_ITEMS_WRITE_FAILED", "order", order.id, {
      order_number: order.order_number,
      lines: items.length,
      error: (e as Error).message,
    }, { module: "orders", ...info });
    await writeDb(db);
  }
}

/** Post-persist hook shared by the form action and the modal PATCH route:
 * records Management's manual override of a forwarded order (source
 * internal_user) and fires the exactly-once Pancake forward on entering
 * Packaging. Call only AFTER writeDb() succeeded. */
export async function afterLeadUpdatePersisted(
  user: Profile,
  result: Extract<ApplyLeadUpdateResult, { ok: true }>
): Promise<void> {
  if (result.manualFulfillmentOverride) {
    await insertSyncLog({
      order_id: result.order.id,
      pancake_order_id: result.order.pancake_order_id,
      pancake_account_id: result.order.pancake_pos_account_id,
      action: "status_update",
      old_status: result.manualFulfillmentOverride.oldStatus,
      new_status: result.manualFulfillmentOverride.newStatus,
      request_at: nowIso(),
      result: "success",
      triggered_by: user.id,
      source: "internal_user",
      payload_summary: { note: "Manual status change by an Administrator on a forwarded order" },
    });
  }
  if (result.enteredPackaging) {
    await forwardOrderToPancake(result.order.id, { source: "packaging_event", triggeredBy: user.id });
  }
}

export async function updateLeadAction(orderId: string, formData: FormData) {
  const { user, db } = await requireUser();
  requirePermission(user, "orders", "edit", db, `/leads/${orderId}`);

  const raw = buildLeadFieldErrors(formData);
  const result = await applyLeadUpdate(user, db, orderId, raw, parseOrderItemFields(formData));
  if (!result.ok) {
    const target = result.code === "not_found" ? "/leads" : `/leads/${orderId}`;
    redirect(`${target}?error=${encodeURIComponent(result.error)}`);
  }
  await writeDb(db);
  await persistOrderItems(user, db, result.order, result.items);
  await afterLeadUpdatePersisted(user, result);
  redirect(`/leads/${orderId}?updated=1`);
}

/**
 * Lifts the synced-order lock for one save. Administrator-only, requires a
 * written reason, and is fully audit-logged as ORDER_MANUALLY_UNLOCKED — the
 * point of the lock is that Pancake owns a synced order, so every deliberate
 * exception has to be attributable. applyLeadUpdate clears the flag again on the
 * next save.
 */
export async function unlockOrderForEditingAction(orderId: string, formData: FormData) {
  const { user, db } = await requireUser();
  requireAdministrator(user, `/leads/${orderId}`);

  const order = db.orders.find((o) => o.id === orderId);
  if (!order) redirect("/leads");

  const reason = String(formData.get("unlock_reason") || "").trim();
  if (reason.length < 5) {
    redirect(`/leads/${orderId}?error=${encodeURIComponent("Give a reason for unlocking this order (at least 5 characters).")}`);
  }
  if (order!.pancake_sync_status !== "synced") {
    redirect(`/leads/${orderId}?error=${encodeURIComponent("This order is not locked — no unlock needed.")}`);
  }

  order!.manual_unlock_active = true;
  order!.manual_unlock_reason = reason;
  order!.manual_unlock_by = user.id;
  order!.manual_unlock_at = nowIso();

  const info = await getRequestInfo();
  logActivity(db, user.id, "ORDER_MANUALLY_UNLOCKED", "order", order!.id, {
    order_number: order!.order_number,
    reason,
  }, {
    module: "orders",
    previous_value: { manual_unlock_active: false },
    updated_value: { manual_unlock_active: true, manual_unlock_reason: reason },
    ...info,
  });
  await writeDb(db);
  redirect(`/leads/${orderId}?unlocked=1`);
}

export async function deleteLeadAction(orderId: string) {
  "use server";
  const { user, db } = await requireUser();
  requirePermission(user, "orders", "delete", db, "/leads");

  const order = db.orders.find((o) => o.id === orderId);
  if (!order) redirect("/leads");
  if (!orderInScope(user, order!, db)) {
    redirect(`/leads?error=${encodeURIComponent("You do not have access to that lead.")}`);
  }

  const idx = db.orders.findIndex((o) => o.id === orderId);
  const [removed] = db.orders.splice(idx, 1);
  queueDelete(db, "orders", orderId);
  const info = await getRequestInfo();
  logActivity(db, user.id, "LEAD_DELETED", "order", orderId, { snapshot: removed }, {
    module: "orders",
    previous_value: removed,
    ...info,
  });
  await writeDb(db);
  redirect("/leads?deleted=1");
}

/** The status an imported row lands on. Honours a file's status column only
 * when Management has opted in, and even then only for pre-sale statuses —
 * a spreadsheet must never place a lead into the fulfillment pipeline. */
function importedStatus(raw: Record<string, unknown>, allowStatusImport: boolean): Order["status"] {
  if (!allowStatusImport) return "new";
  const requested = String(raw.status ?? "").trim().toLowerCase().replace(/s+/g, "_");
  return (PRE_SALE_STATUSES as readonly string[]).includes(requested) ? (requested as Order["status"]) : "new";
}

export interface LeadImportRowResult {
  row: number;
  category: "imported" | "duplicate" | "invalid" | "missing_info" | "unrecognized_agent";
  reason: string;
  data: Record<string, unknown>;
}

export interface LeadImportSummary {
  total: number;
  imported: number;
  duplicates: number;
  invalid: number;
  missingInfo: number;
  unrecognizedAgents: number;
  results: LeadImportRowResult[];
}

function leadDedupeKey(f: {
  agent: string;
  customer_name: string;
  customer_phone: string;
  purok: string;
  barangay: string;
  city: string;
  province: string;
  landmark: string;
  previous_order_date: string;
  previous_order_product: string;
  previous_order_amount: string;
}): string {
  return [
    f.agent,
    f.customer_name,
    f.customer_phone,
    f.purok,
    f.barangay,
    f.city,
    f.province,
    f.landmark,
    f.previous_order_date,
    f.previous_order_product,
    f.previous_order_amount,
  ]
    .map((v) => v.trim().toLowerCase())
    .join("|");
}

/**
 * Re-validates every row server-side (never trusts client parsing) and returns
 * a full categorized summary the client can render and turn into a CSV error
 * report.
 *
 * Called once per BATCH — the browser sends a large file a few hundred rows at
 * a time — so this must not do work proportional to the whole import. The new
 * rows are inserted directly rather than through writeDb(), which upserts the
 * entire orders table: with that, batch twelve rewrote everything batches one
 * to eleven had just written, and the cost grew with every batch until the
 * function timed out.
 */
export async function importLeadsAction(
  rawRows: { row: number; data: Record<string, unknown> }[],
  fileName: string
): Promise<LeadImportSummary> {
  const { user, db } = await requireUser();
  requirePermission(user, "orders", "upload", db, "/leads/import");

  const allowedIds = new Set(allowedAssigneeIds(user, db));
  const usernameById = new Map(db.profiles.map((p) => [p.id, p.username]));

  const existingKeys = new Set(
    db.orders.map((o) =>
      leadDedupeKey({
        agent: usernameById.get(o.agent_id) || "",
        customer_name: o.customer_name,
        customer_phone: o.customer_phone,
        purok: o.purok,
        barangay: o.barangay,
        city: o.city,
        province: o.province,
        landmark: o.landmark,
        previous_order_date: o.previous_order_date || "",
        previous_order_product: o.previous_order_product || "",
        previous_order_amount: o.previous_order_amount != null ? String(o.previous_order_amount) : "",
      })
    )
  );
  const seenInFile = new Set<string>();
  const results: LeadImportRowResult[] = [];
  const now = nowIso();
  // Built once. Doing this per row walked every order for every line of the
  // file, against an array the loop was growing — quadratic, and the reason a
  // two-thousand-row import ran past the function timeout with the page still
  // saying "Importing…".
  const previousIndex = buildPreviousOrderIndex(db);
  const t0 = Date.now();
  // Same reasoning: matchAgentByCallName scans the profile list per row.
  const agentCache = new Map<string, Profile | null>();
  const newOrders: Order[] = [];

  for (const { row, data: raw } of rawRows) {
    const agentName = String(raw.agent_name ?? "").trim();
    const key = leadDedupeKey({
      agent: agentName,
      customer_name: String(raw.customer_name ?? ""),
      customer_phone: String(raw.customer_phone ?? ""),
      purok: String(raw.purok ?? ""),
      barangay: String(raw.barangay ?? ""),
      city: String(raw.city ?? ""),
      province: String(raw.province ?? ""),
      landmark: String(raw.landmark ?? ""),
      previous_order_date: String(raw.previous_order_date ?? ""),
      previous_order_product: String(raw.previous_order_product ?? ""),
      previous_order_amount: String(raw.previous_order_amount ?? ""),
    });

    const parsed = leadImportRowSchema.safeParse(raw);
    if (!parsed.success) {
      results.push({ row, category: "invalid", reason: parsed.error.issues[0]?.message || "Invalid row", data: raw });
      continue;
    }
    const data = parsed.data;

    if (!data.customer_name.trim() || !data.customer_phone.trim()) {
      results.push({ row, category: "missing_info", reason: "Customer Name and Phone Number are required", data: raw });
      continue;
    }
    if (!agentName) {
      results.push({ row, category: "missing_info", reason: "Agent username is required", data: raw });
      continue;
    }
    if (existingKeys.has(key) || seenInFile.has(key)) {
      results.push({ row, category: "duplicate", reason: "Identical to an existing lead or another row in this file", data: raw });
      continue;
    }
    let match = agentCache.get(agentName);
    if (match === undefined) {
      match = matchAgentByCallName(agentName, db.profiles) || null;
      agentCache.set(agentName, match);
    }
    if (!match || !allowedIds.has(match.id)) {
      results.push({
        row,
        category: "unrecognized_agent",
        reason: `No agent has the Call Name (or username) '${agentName}'`,
        data: raw,
      });
      continue;
    }

    seenInFile.add(key);
    // Previous Note and Previous Status are deliberately absent from
    // leadDedupeKey above: two rows that differ only in what was noted, or in
    // how the last order ended, are still the same lead typed twice.
    const hasProvidedPreviousInfo =
      data.previous_order_date ||
      data.previous_order_product ||
      data.previous_order_amount != null ||
      data.previous_order_note ||
      data.previous_order_status;
    const previousInfo = hasProvidedPreviousInfo ? null : previousOrderFor(previousIndex, data.customer_phone);

    const order: Order = {
      id: uuid(),
      order_number: nextOrderNumber(db),
      customer_name: data.customer_name,
      customer_phone: restoreTrunkZero(data.customer_phone),
      purok: data.purok || "",
      barangay: data.barangay || "",
      city: data.city || "",
      province: data.province || "",
      landmark: data.landmark || "",
      previous_order_date: data.previous_order_date || previousInfo?.date || null,
      previous_order_product: data.previous_order_product || previousInfo?.product || null,
      previous_order_amount: data.previous_order_amount ?? previousInfo?.amount ?? null,
      previous_order_note: data.previous_order_note || previousInfo?.note || null,
      previous_order_status: normalizePreviousStatus(data.previous_order_status) || previousInfo?.status || null,
      product_id: null,
      product_name: "",
      quantity: 1,
      unit_price: null,
      total_amount: 0,
      // Imported leads start at New. A file is not allowed to dictate status
      // unless Management turns on allow_status_import: a status column could
      // otherwise push rows straight into the sale pipeline, stamping order
      // dates and firing Pancake forwards for orders nobody has called yet.
      status: importedStatus(raw, db.operations.allow_status_import),
      order_date: null,
      source: "import",
      ...ORDER_PANCAKE_DEFAULTS,
      notes: "",
      created_by: user.id,
      updated_by: null,
      agent_id: match.id,
      assigned_agent_email: match.email,
      created_at: now,
      updated_at: now,
    };
    order.system_order_id = order.order_number;
    // Collected, not pushed into db.orders: these are inserted directly below.
    // Pushing them would hand them to writeDb(), which rewrites every order in
    // the table — the cost this batching exists to avoid.
    newOrders.push(order);
    results.push({ row, category: "imported", reason: "", data: raw });
  }

  const summary: LeadImportSummary = {
    total: rawRows.length,
    imported: results.filter((r) => r.category === "imported").length,
    duplicates: results.filter((r) => r.category === "duplicate").length,
    invalid: results.filter((r) => r.category === "invalid").length,
    missingInfo: results.filter((r) => r.category === "missing_info").length,
    unrecognizedAgents: results.filter((r) => r.category === "unrecognized_agent").length,
    results,
  };

  const tLoop = Date.now();
  await insertImportedOrders(newOrders, db.order_seq);

  const info = await getRequestInfo();
  // Written straight to the table for the same reason the orders are: this
  // must not drag the whole-database write back in. Same shape logActivity()
  // would have produced.
  await supabaseAdmin.from("activity_log").insert({
    id: uuid(),
    user_id: user.id,
    user_email: user.email,
    action: "LEADS_IMPORTED",
    entity_type: "order",
    entity_id: null,
    details: {
      file_name: fileName,
      total: summary.total,
      imported: summary.imported,
      duplicates: summary.duplicates,
      invalid: summary.invalid,
      missing_info: summary.missingInfo,
      unrecognized_agents: summary.unrecognizedAgents,
    },
    module: "orders",
    ip_address: info.ip_address,
    device_info: info.device_info,
    created_at: nowIso(),
  });

  console.log(
    `[import] rows=${rawRows.length} loop=${tLoop - t0}ms write=${Date.now() - tLoop}ms total=${Date.now() - t0}ms`
  );
  return summary;
}

/**
 * Writes the batch: the orders themselves, then the day's order-number counter.
 *
 * Chunked because one request carrying thousands of ~50-column rows is a
 * multi-megabyte body and a single enormous statement — the measured
 * difference was 67 seconds against 14.
 *
 * The counter is saved AFTER the rows. If the insert fails, the numbers this
 * batch reserved are simply never used, which leaves a gap in the sequence;
 * saving it first and then failing would hand the same numbers to the next
 * batch, and two orders sharing a number is worse than a gap.
 */
async function insertImportedOrders(orders: Order[], orderSeq: Record<string, number>): Promise<void> {
  const CHUNK = 500;
  for (let i = 0; i < orders.length; i += CHUNK) {
    const chunk = orders.slice(i, i + CHUNK) as unknown as Record<string, unknown>[];
    const { error } = await supabaseAdmin.from("orders").insert(chunk);
    if (error) throw new Error(`Could not save the imported leads: ${error.message}`);
  }

  const rows = Object.entries(orderSeq).map(([seq_date, last_seq]) => ({ seq_date, last_seq }));
  if (rows.length > 0) {
    const { error } = await supabaseAdmin.from("order_sequences").upsert(rows, { onConflict: "seq_date" });
    if (error) throw new Error(`Could not update the order counter: ${error.message}`);
  }
}
