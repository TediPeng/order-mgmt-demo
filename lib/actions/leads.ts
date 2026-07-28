"use server";

import { redirect } from "next/navigation";
import { writeDb, uuid, nowIso, nextOrderNumber } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { orderInScope, allowedAssigneeIds } from "@/lib/order-access";
import { getActiveSessionForOrder, endSession } from "@/lib/call-sessions";
import { isFullAccess } from "@/lib/permissions";
import { requireUser, requirePermission } from "./guards";
import { leadFormSchema, leadImportRowSchema, PACKAGING_STATUS, PRE_SALE_STATUSES } from "@/lib/validation";
import { matchAgentByCallName } from "@/lib/agent-match";
import { todayInTz, restoreTrunkZero } from "@/lib/utils";
import {
  validatePackaging,
  restrictedStatusBlockReason,
  pipelineBlockReason,
  computeOrderDate,
  findPreviousOrderInfo,
  fulfillmentOverrideBlockReason,
} from "@/lib/lead-workflow";
import { forwardOrderToPancake } from "@/lib/pancake/forward";
import { computeOrderTotal, validateForPancake } from "@/lib/pancake/validate";
import { validateAddressCodes } from "@/lib/psgc";
import { insertSyncLog } from "@/lib/pancake/store";
import type { DbShape, Order, Profile } from "@/lib/types";
import { ORDER_PANCAKE_DEFAULTS } from "@/lib/types";

function buildLeadFieldErrors(formData: FormData): Record<string, unknown> {
  return {
    customer_name: formData.get("customer_name"),
    customer_phone: formData.get("customer_phone"),
    purok: formData.get("purok"),
    barangay: formData.get("barangay"),
    city: formData.get("city"),
    province: formData.get("province"),
    landmark: formData.get("landmark"),
    previous_order_date: formData.get("previous_order_date"),
    previous_order_product: formData.get("previous_order_product"),
    previous_order_amount: formData.get("previous_order_amount") || null,
    product_id: formData.get("product_id"),
    unit_price: formData.get("unit_price") || null,
    status: formData.get("status") || "new",
    notes: formData.get("notes"),
    agent_id: formData.get("agent_id"),
    shipping_fee: formData.get("shipping_fee") || null,
    courier: formData.get("courier"),
    payment_method: formData.get("payment_method"),
    order_source: formData.get("order_source"),
    province_code: formData.get("province_code"),
    city_code: formData.get("city_code"),
    barangay_code: formData.get("barangay_code"),
    discount: formData.get("discount") || null,
    variant: formData.get("variant"),
  };
}

export async function createLeadAction(formData: FormData) {
  const { user, db } = await requireUser();
  requirePermission(user, "orders", "create", db, "/leads/new");

  const raw = buildLeadFieldErrors(formData);
  const allowed = allowedAssigneeIds(user, db);
  if (!raw.agent_id || !allowed.includes(String(raw.agent_id))) raw.agent_id = user.id;

  const parsed = leadFormSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message || "Invalid input.";
    redirect(`/leads/new?error=${encodeURIComponent(msg)}`);
  }
  const data = parsed.data;

  const blocked = pipelineBlockReason({ order_date: null }, data.status);
  if (blocked) redirect(`/leads/new?error=${encodeURIComponent(blocked)}`);

  if (data.status === PACKAGING_STATUS) {
    const missing = validatePackaging({ ...data, product_id: data.product_id || null });
    if (missing.length > 0) {
      redirect(`/leads/new?error=${encodeURIComponent(`Missing required fields for Packaging: ${missing.join(", ")}`)}`);
    }
  }

  const now = nowIso();
  const today = todayInTz();
  const assignedAgent = db.profiles.find((p) => p.id === data.agent_id);
  const product = data.product_id ? db.products.find((p) => p.id === data.product_id) : undefined;

  const hasProvidedPreviousInfo = data.previous_order_date || data.previous_order_product || data.previous_order_amount != null;
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
    product_id: data.product_id || null,
    product_name: product?.name || "",
    quantity: 1,
    unit_price: data.unit_price ?? null,
    total_amount: computeOrderTotal({
      unit_price: data.unit_price ?? null,
      quantity: 1,
      discount: data.discount ?? 0,
      shipping_fee: data.shipping_fee ?? null,
    }),
    status: data.status,
    order_date: data.status === PACKAGING_STATUS ? today : null,
    source: "manual",
    ...ORDER_PANCAKE_DEFAULTS,
    shipping_fee: data.shipping_fee ?? null,
    courier: data.courier || null,
    payment_method: data.payment_method || null,
    order_source: assignedAgent?.call_name || null,
    discount: data.discount ?? 0,
    variant: data.variant || null,
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
  db.orders.push(order);
  const info = await getRequestInfo();
  logActivity(db, user.id, "LEAD_CREATED", "order", order.id, { order_number: order.order_number }, {
    module: "orders",
    ...info,
  });
  await writeDb(db);
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
  raw: Record<string, unknown>
): Promise<ApplyLeadUpdateResult> {
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, code: "not_found", error: "Lead not found." };
  if (!orderInScope(user, order, db)) {
    return { ok: false, code: "forbidden", error: "You do not have access to that lead." };
  }

  const requestedAgentId = String(raw.agent_id || order.agent_id);
  raw.agent_id = isFullAccess(user.role) ? requestedAgentId : order.agent_id;

  // Previous-order fields are informational-only for non-full-access roles.
  if (!isFullAccess(user.role)) {
    raw.previous_order_date = order.previous_order_date || "";
    raw.previous_order_product = order.previous_order_product || "";
    raw.previous_order_amount = order.previous_order_amount ?? null;
  }

  const parsed = leadFormSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "validation", error: parsed.error.issues[0]?.message || "Invalid input." };
  }
  const data = parsed.data;

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
    const missing = validatePackaging({ ...data, product_id: data.product_id || null });
    if (missing.length > 0) {
      return {
        ok: false,
        code: "validation",
        error: `Missing required fields for Packaging: ${missing.join(", ")}`,
      };
    }
    const address = await validateAddressCodes({
      province_code: data.province_code || null,
      city_code: data.city_code || null,
      barangay_code: data.barangay_code || null,
    });
    if (!address.ok) {
      return {
        ok: false,
        code: "validation",
        error: `Invalid address: ${Object.values(address.errors).join(" ")}`,
      };
    }
    // Trust the codes over the submitted names, so a stale or edited label
    // cannot disagree with the location actually chosen.
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
      quantity: order.quantity,
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

  // Quantity is hidden on the full-page form (always order.quantity); the
  // Order Details modal is the only place it's surfaced as an editable field.
  const rawQuantity = raw.quantity;
  const parsedQuantity = rawQuantity != null && rawQuantity !== "" ? Number(rawQuantity) : NaN;
  const quantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : order.quantity;

  order.customer_name = data.customer_name;
  order.customer_phone = data.customer_phone || "";
  order.purok = data.purok || "";
  order.barangay = data.barangay || "";
  order.city = data.city || "";
  order.province = data.province || "";
  order.province_code = data.province_code || null;
  order.city_code = data.city_code || null;
  order.barangay_code = data.barangay_code || null;
  // A freshly picked address is by definition resolved.
  if (data.province_code && data.city_code && data.barangay_code) order.address_needs_review = false;
  order.landmark = data.landmark || "";
  order.previous_order_date = data.previous_order_date || null;
  order.previous_order_product = data.previous_order_product || null;
  order.previous_order_amount = data.previous_order_amount ?? null;
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

  const info = await getRequestInfo();
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
  };
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
      payload_summary: { note: "Manual status change by Management on a forwarded order" },
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
  const result = await applyLeadUpdate(user, db, orderId, raw);
  if (!result.ok) {
    const target = result.code === "not_found" ? "/leads" : `/leads/${orderId}`;
    redirect(`${target}?error=${encodeURIComponent(result.error)}`);
  }
  await writeDb(db);
  await afterLeadUpdatePersisted(user, result);
  redirect(`/leads/${orderId}?updated=1`);
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

/** Re-validates every row server-side (never trusts client parsing) and returns
 * a full categorized summary the client can render and turn into a CSV error report. */
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
    const match = matchAgentByCallName(agentName, db.profiles);
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
    const hasProvidedPreviousInfo = data.previous_order_date || data.previous_order_product || data.previous_order_amount != null;
    const previousInfo = hasProvidedPreviousInfo ? null : findPreviousOrderInfo(db, data.customer_phone);

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
    db.orders.push(order);
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

  const info = await getRequestInfo();
  logActivity(
    db,
    user.id,
    "LEADS_IMPORTED",
    "order",
    null,
    {
      file_name: fileName,
      total: summary.total,
      imported: summary.imported,
      duplicates: summary.duplicates,
      invalid: summary.invalid,
      missing_info: summary.missingInfo,
      unrecognized_agents: summary.unrecognizedAgents,
    },
    { module: "orders", ...info }
  );
  await writeDb(db);
  return summary;
}
