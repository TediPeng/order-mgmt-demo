import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { Order, PancakeSyncSource } from "@/lib/types";
import { buildForwardPayload, type ForwardItem } from "./types";
import { listItems } from "@/lib/order-items";

/**
 * Previous-order statuses that leave nothing in flight, so the next parcel may
 * go without a person looking first.
 *
 * The hold exists to stop ONE customer receiving TWO live parcels with the
 * floor paying for both. That risk needs a parcel that is out, or one that is
 * coming back — so the test is not "did the last one succeed" but "is the last
 * one finished with".
 *
 *   delivered — it arrived and was kept. Nothing outstanding.
 *   cancelled — it never shipped. There is no parcel, so there cannot be a
 *               second one. Holding these was the rule being stricter than its
 *               own reason: an agent had to go into Pancake, look at an order
 *               that had already been called off, and press retry to confirm
 *               what the status already said.
 *   deleted   — the order was removed in Pancake, so there is even less in
 *               flight than a cancellation: not merely called off, gone. Same
 *               reasoning, same answer.
 *
 * Returned is deliberately NOT here. A parcel that came back cost the floor
 * shipping twice and may mean a customer who refuses deliveries; that is a
 * judgement, and a person should make it.
 *
 * Matched against the MAPPED status, not Pancake's label, so this follows the
 * editable pancake_status_map like everything else — an Administrator who maps
 * another code to `cancelled` gets this behaviour with it, and no code here
 * needs to know that Pancake spells it "canceled".
 */
const SETTLED_PREVIOUS_STATUSES = new Set(["delivered", "cancelled", "deleted"]);
import { createOrder } from "./createOrder";
import { CREATE_STATUS_PACKAGING_LABEL, LOOKUP_REFRESH_ON_MISS_AFTER_MS } from "./config";
import { validateForPancake } from "./validate";
import { verifyAddressIds } from "./address";
import { latestPancakeOrder } from "./customerHistory";
import { findRecentOrderForRetry } from "./findExisting";
import { MAX_ATTEMPTS } from "./retry";
import {
  fetchOrderSources,
  fetchStaffList,
  matchOrderSource,
  matchStaffByEmail,
  noOrderSourceMessage,
  noStaffMessage,
  type LookupResult,
} from "./lookups";
import { PACKAGING_STATUS } from "@/lib/validation";
import {
  claimOrderForSync,
  getOrderRow,
  hasSuccessfulForward,
  listAccounts,
  markSyncFailed,
  resolveAccount,
  updateOrderSyncFields,
  insertSyncLog,
  notifyAdministrators,
  logActivityDirect,
} from "./store";

/** Sources that describe a status Pancake told US about. Nothing carrying one of
 * these may trigger an outbound create — see the loop guard below. */
const PANCAKE_DRIVEN_SOURCES: ReadonlySet<PancakeSyncSource> = new Set<PancakeSyncSource>([
  "webhook",
  "api_polling",
  "tag_rule",
]);

export interface ForwardResult {
  ok: boolean;
  skipped: boolean;
  message: string;
  /** Present when the order already had one — lets callers echo it back. */
  pancakeOrderId?: string | null;
  /** Per-field problems from the pre-send validation, when that is what failed. */
  fieldErrors?: { field: string; message: string }[];
}

/** Records a terminal failure: internal status stays Packaging, only the
 * sync state moves. Shared by every failure path so none of them can leave an
 * order stranded in `syncing`. */
/**
 * Matches against a lookup list, re-reading it once if the list is stale.
 *
 * A miss is the one moment the cached list is worth doubting, and it is nearly
 * always the same story: the agent was added to Pancake after we last read it,
 * so the order kept failing on a day-old list until an Administrator thought to
 * press Refresh on the mappings page. Retry Sync did not help — it read the same
 * cache. Now the failure re-reads it itself, and an order recovers on its own
 * once the person exists on the Pancake side.
 *
 * A list read moments ago is not re-read: the first miss in a sweep refreshes
 * it, and the rest of that sweep is matching against something already current.
 * A refetch that fails leaves the original miss standing, which is the right
 * answer — we could not prove the value exists, so the order is not sent.
 */
async function matchOrRefetch<T>(
  first: LookupResult<T>,
  target: string | null,
  match: (items: T[], target: string | null) => T | null,
  refetch: (opts: { force: true }) => Promise<LookupResult<T>>
): Promise<T | null> {
  const hit = match(first.items, target);
  if (hit || first.ageMs <= LOOKUP_REFRESH_ON_MISS_AFTER_MS) return hit;

  const again = await refetch({ force: true });
  return again.ok ? match(again.items, target) : null;
}

async function failSync(
  order: Order,
  reason: string,
  opts: { source: PancakeSyncSource; triggeredBy?: string | null; allowRetry?: boolean },
  extra: {
    accountId?: string | null;
    httpStatus?: number | null;
    requestAt?: string;
    responseAt?: string | null;
    requestPayload?: Record<string, unknown> | null;
    responsePayload?: Record<string, unknown> | null;
    notify?: boolean;
  } = {}
): Promise<void> {
  // Refused when the order has since succeeded. The checks that reject an order
  // run before the claim, so a rejection can still be on its way while a forward
  // that already worked lands — and this write used to overwrite it, leaving a
  // live Pancake ID under a red "Sync Failed" and putting an order that exists
  // back in the retry queue. The predicate travels with the update, so there is
  // no window between deciding and writing.
  const recorded = await markSyncFailed(order.id, {
    pancake_sync_status: "sync_failed",
    pancake_sync_error: reason,
    ...(extra.requestPayload !== undefined ? { pancake_request_payload: extra.requestPayload } : {}),
    ...(extra.responsePayload !== undefined ? { pancake_response_payload: extra.responsePayload } : {}),
  });

  await insertSyncLog({
    order_id: order.id,
    pancake_account_id: extra.accountId ?? null,
    action: opts.allowRetry ? "retry" : "forward",
    old_status: order.status,
    request_at: extra.requestAt ?? new Date().toISOString(),
    response_at: extra.responseAt ?? null,
    http_status: extra.httpStatus ?? null,
    result: "failed",
    error_message: reason,
    triggered_by: opts.triggeredBy ?? null,
    source: opts.source,
    payload_summary: {
      order_number: order.order_number,
      system_order_id: order.system_order_id,
      // The attempt did fail and the log says so — but if the order was already
      // in Pancake by the time this landed, the failure is a race, not a state.
      ...(recorded ? {} : { superseded_by_a_successful_sync: true }),
    },
  });
  // Nothing to tell anyone about an order that is already in Pancake.
  if (recorded && extra.notify !== false) {
    await notifyAdministrators(
      "pancake_sync_failed",
      `Pancake sync failed: ${order.order_number}`,
      reason,
      `/leads?open=${encodeURIComponent(order.order_number)}`
    );
  }
}

/** Sends a Ready-to-Ship order to Pancake POS. Also used by Retry Sync.
 *
 * The Ready-to-Ship check lives HERE, not only in the callers: this service is
 * the single place an order can leave for Pancake, so no other status can ever
 * be sent regardless of who calls it.
 *
 * Exactly-once rests on three things: the pre-send duplicate check, the
 * atomic claim (only one caller can flip an order to `syncing`), and
 * `system_order_id` travelling as the external reference on every create. */
export async function forwardOrderToPancake(
  orderId: string,
  opts: { source: PancakeSyncSource; triggeredBy?: string | null; allowRetry?: boolean }
): Promise<ForwardResult> {
  // --- Loop prevention ------------------------------------------------------
  // A status that Pancake itself gave us must never travel back to Pancake.
  // Pancake's code 8 maps to Packaging, so an inbound update can legitimately
  // leave an order sitting in the one status this function forwards — without
  // this guard, a future caller carrying an inbound source could bounce it
  // straight back and the two systems would talk in circles.
  if (PANCAKE_DRIVEN_SOURCES.has(opts.source)) {
    return {
      ok: true,
      skipped: true,
      message: `Refusing to forward an order whose status came from Pancake (source: ${opts.source}).`,
    };
  }

  const order = await getOrderRow(orderId);
  if (!order) return { ok: false, skipped: true, message: "Order not found." };

  // Hard guard: only Packaging is ever sent.
  if (order.status !== PACKAGING_STATUS) {
    return { ok: false, skipped: true, message: "Only Packaging orders are sent to Pancake POS." };
  }

  // --- Duplicate prevention -------------------------------------------------
  if (order.pancake_order_id) {
    return {
      ok: true,
      skipped: true,
      message: `This order has already been synced to Pancake POS (Order ID: ${order.pancake_order_id}).`,
      pancakeOrderId: order.pancake_order_id,
    };
  }
  if (order.pancake_sync_status === "synced") {
    return { ok: true, skipped: true, message: "This order has already been synced to Pancake POS." };
  }
  if (order.pancake_sync_status === "syncing") {
    return { ok: true, skipped: true, message: "A sync is already in progress for this order." };
  }
  if (order.pancake_sync_status === "sync_failed" && !opts.allowRetry) {
    return { ok: false, skipped: true, message: "Previous sync failed — use Retry Sync, or wait for the automatic retry." };
  }
  if (await hasSuccessfulForward(order.id)) {
    return { ok: true, skipped: true, message: "A successful sync is already recorded for this order — not sending again." };
  }

  // --- Pre-send validation --------------------------------------------------
  const validation = validateForPancake(order);
  if (!validation.ok) {
    const reason = `Missing required Pancake fields: ${validation.errors.map((e) => e.message).join(", ")}`;
    await failSync(order, reason, opts, { notify: false });
    return { ok: false, skipped: false, message: reason, fieldErrors: validation.errors };
  }

  // --- Account resolution ---------------------------------------------------
  const { data: agentProfile } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, username, team_lead_id, call_name, email")
    .eq("id", order.agent_id)
    .maybeSingle();
  const accounts = await listAccounts();
  const account = resolveAccount(accounts, order, (agentProfile?.team_lead_id as string) || null);

  if (!account) {
    const reason =
      "No Pancake account resolved for this order. Assign an account to the agent/team/order source, or mark exactly one active account as Default (Settings → Integrations).";
    await failSync(order, reason, opts);
    return { ok: false, skipped: false, message: reason };
  }

  // --- Repeat-buyer gate ----------------------------------------------------
  //
  // A regular customer is somebody who has bought before, so Pancake already
  // holds their record — and what happened to their last parcel decides whether
  // the next one should go out at all. If the previous order came back, or is
  // still in flight, sending another is how a customer ends up with two parcels
  // and the floor ends up paying for both.
  //
  // Only regular customers. A fresh lead has no history to judge and is not
  // what this rule is about.
  //
  // Three answers, three outcomes:
  //   settled        — the last one is finished with: it arrived and was kept,
  //                    or it was cancelled or deleted and never went. Send.
  //   no orders yet  — new to Pancake. Nothing to hold against them. Send.
  //   anything else  — hold it, and say which status and which order, so the
  //                    agent can look it up rather than guess.
  //
  // Pancake being unreachable is NOT a refusal. The order waits for the retry
  // queue instead of being judged on an answer nobody got.
  if (order.is_regular_customer) {
    const latest = await latestPancakeOrder(account, order.customer_phone || "");
    if (latest.error) {
      const reason = `Could not check this customer's last Pancake order: ${latest.error}`;
      await failSync(order, reason, opts, { accountId: account.id });
      return { ok: false, skipped: false, message: reason };
    }
    if (latest.found && !SETTLED_PREVIOUS_STATUSES.has(latest.status || "")) {
      const label = latest.statusName || latest.status || "an unknown status";
      // Short on purpose. The Sync Failed page groups by this string and shows
      // it as the group's heading, so the sentence has to read as a title; the
      // reasoning and the instruction live in that page's `detail`, written
      // once rather than repeated on every held order.
      const reason = `Held: last Pancake order ${latest.id || "(no id)"} is ${label}, not delivered.`;
      await failSync(order, reason, opts, { accountId: account.id });
      return { ok: false, skipped: false, message: reason };
    }
  }

  // --- Product lines --------------------------------------------------------
  // Every line of the order becomes its own Pancake item, and every line is
  // mapped on its own. This used to resolve one product — the order's first —
  // and send the order's TOTAL quantity under it, so the rest of a multi-product
  // order silently became extra units of the first product.
  const lines = await listItems(order.id);
  const productIds = Array.from(new Set(lines.map((l) => l.product_id).filter((id): id is string => Boolean(id))));
  if (!productIds.includes(order.product_id || "") && order.product_id) productIds.push(order.product_id);

  const { data: productRows } = await supabaseAdmin
    .from("products")
    .select("id, name, pancake_variation_id")
    .in("id", productIds.length > 0 ? productIds : ["00000000-0000-0000-0000-000000000000"]);
  const productById = new Map(
    (productRows || []).map((p) => [p.id as string, p as { id: string; name: string; pancake_variation_id: string | null }])
  );

  const resolveLine = (productId: string | null, fallbackName: string) => {
    const product = productId ? productById.get(productId) : undefined;
    const variationId = (product?.pancake_variation_id || "").trim();
    return {
      name: product?.name || fallbackName,
      variationId,
      oneTimeProduct: !variationId && account.use_one_time_products,
    };
  };

  // An unmapped product is refused rather than quietly folded in — unless the
  // account is deliberately set to send quick-add products, which is a switch
  // somebody turned on. The message names the product so it is clear which one
  // needs mapping.
  const unmappable = (lines.length > 0 ? lines : [{ product_id: order.product_id, product_name: order.product_name }])
    .map((l) => resolveLine(l.product_id ?? null, l.product_name || ""))
    .find((r) => !r.variationId && !r.oneTimeProduct);
  if (unmappable) {
    const reason = `Product "${unmappable.name}" has no Pancake variation ID. Map it under Products, or enable quick-add products on the ${account.account_name} account.`;
    await failSync(order, reason, opts, { accountId: account.id });
    return { ok: false, skipped: false, message: reason };
  }

  const orderLevel = resolveLine(order.product_id ?? null, order.product_name);
  const variationId = orderLevel.variationId;
  const oneTimeProduct = orderLevel.oneTimeProduct;
  const forwardItems: ForwardItem[] = lines.map((line) => {
    const resolved = resolveLine(line.product_id ?? null, line.product_name);
    return {
      product_name: resolved.name,
      variant: line.variant,
      variation_id: resolved.variationId,
      one_time_product: resolved.oneTimeProduct,
      quantity: line.quantity,
      unit_price: line.unit_price,
      discount: line.discount,
    };
  });

  // --- Address verification -------------------------------------------------
  // Last check before submitting: the three Pancake address IDs must still
  // exist and still nest under one another. Refusing here means an order never
  // lands in Pancake with a silently empty location.
  const address = await verifyAddressIds(account, {
    provinceId: order.pancake_province_id,
    districtId: order.pancake_district_id,
    communeId: order.pancake_commune_id,
  });
  if (!address.ok) {
    const reason = `Address not valid in Pancake POS: ${address.error}`;
    await failSync(order, reason, opts, { accountId: account.id });
    return { ok: false, skipped: false, message: reason };
  }

  // --- Order Source + Care Staff resolution --------------------------------
  // Pancake takes IDs from its own lists here, not free text. Resolved BEFORE
  // the claim so an unmatched value fails cheaply without burning a retry slot
  // or leaving the order stuck in `syncing`.
  const agentCallName = (agentProfile?.call_name as string) || order.order_source || null;
  const agentEmail = (agentProfile?.email as string) || order.assigned_agent_email || null;

  const sources = await fetchOrderSources(account);
  if (!sources.ok) {
    const reason = `Could not read Order Sources from Pancake POS: ${sources.error}`;
    await failSync(order, reason, opts, { accountId: account.id });
    return { ok: false, skipped: false, message: reason };
  }
  const matchedSource = await matchOrRefetch(sources, agentCallName, matchOrderSource, (o) =>
    fetchOrderSources(account, o)
  );
  if (!matchedSource) {
    const reason = noOrderSourceMessage(agentCallName);
    await failSync(order, reason, opts, { accountId: account.id });
    return { ok: false, skipped: false, message: reason };
  }

  const staff = await fetchStaffList(account);
  if (!staff.ok) {
    const reason = `Could not read the Staff list from Pancake POS: ${staff.error}`;
    await failSync(order, reason, opts, { accountId: account.id });
    return { ok: false, skipped: false, message: reason };
  }
  const matchedStaff = await matchOrRefetch(staff, agentEmail, matchStaffByEmail, (o) => fetchStaffList(account, o));
  if (!matchedStaff) {
    const reason = noStaffMessage(agentEmail);
    await failSync(order, reason, opts, { accountId: account.id });
    return { ok: false, skipped: false, message: reason };
  }

  // --- Duplicate recovery before any re-send --------------------------------
  // A previous attempt exists, so this send might be a retry of one that
  // actually reached Pancake and only failed on the way back (a timeout leaves
  // us unable to tell). Without `custom_id` there is no external reference to
  // ask about, so we search Pancake for an order matching this phone and total
  // in the window since the first attempt, and adopt it rather than creating a
  // second real order — a duplicate here means a duplicate shipment.
  if (order.pancake_retry_count > 0) {
    const since = order.pancake_last_sync_attempt_at || order.updated_at;
    const existing = await findRecentOrderForRetry(account, order, since);

    if (existing.found && existing.pancakeOrderId) {
      const now = new Date().toISOString();
      await updateOrderSyncFields(order.id, {
        pancake_order_id: existing.pancakeOrderId,
        pancake_status: existing.pancakeStatus,
        pancake_sync_status: "synced",
        pancake_synced_at: now,
        pancake_event_at: existing.eventTimestamp,
        pancake_sync_error: null,
        forwarded_to_pancake_at: order.forwarded_to_pancake_at || now,
      });
      await insertSyncLog({
        order_id: order.id,
        pancake_order_id: existing.pancakeOrderId,
        pancake_account_id: account.id,
        action: "retry",
        old_status: order.status,
        new_status: order.status,
        request_at: new Date().toISOString(),
        result: "success",
        triggered_by: opts.triggeredBy ?? null,
        source: opts.source,
        payload_summary: {
          note: "Adopted an order Pancake had already created for an earlier attempt; no second order was sent.",
        },
      });
      return {
        ok: true,
        skipped: true,
        message: `Pancake had already created this order (Order ID: ${existing.pancakeOrderId}) — adopted it instead of sending a duplicate.`,
        pancakeOrderId: existing.pancakeOrderId,
      };
    }

    // Either the lookup failed or it matched more than one order. Both mean we
    // cannot prove a duplicate would not be created, so the order is held for a
    // human rather than risking a second shipment.
    if (existing.error) {
      // A held retry must still cost an attempt. It did not: pancake_retry_count
      // is raised only by claimOrderForSync(), which this path returns before
      // reaching, so the count stayed at 1 for ever. The backoff is computed
      // from the count, so it stayed on its first step, and the budget was never
      // spent — the sweep re-ran this roughly once a minute, indefinitely. On
      // 2026-08-11 that was 546 notifications for five orders in four hours,
      // each one another call to the Pancake API, and it buried every other
      // notification an administrator had.
      //
      // An ambiguous match is not a transient failure: retrying re-runs the same
      // query against the same rows and gets the same answer. Only a person
      // looking at Pancake can say which order is ours, so the budget is spent
      // at once and the sweep surfaces it as needs-review — its own guard then
      // notifies exactly once and leaves it alone. A lookup that merely failed
      // (a timeout, a 500) is transient and keeps its remaining attempts.
      const spent = existing.ambiguous ? MAX_ATTEMPTS : order.pancake_retry_count + 1;
      await updateOrderSyncFields(order.id, { pancake_retry_count: spent });

      const reason = `Retry held for review: ${existing.error}`;
      await failSync(order, reason, opts, {
        accountId: account.id,
        // Only a hold that says something new is worth telling anyone about.
        notify: (order.pancake_sync_error || "") !== reason,
      });
      return { ok: false, skipped: true, message: reason };
    }
  }

  // --- Claim (concurrency guard) -------------------------------------------
  // Fill the fields the agent cannot see from the account's defaults. Done
  // here rather than at save time so a later change to the defaults applies to
  // anything not yet forwarded, and so the agent's action is never blocked by
  // a field they have no control over.
  const effective = {
    payment_method: order.payment_method || account.default_payment_method || null,
    shipping_fee: order.shipping_fee ?? account.default_shipping_fee ?? null,
    courier: order.courier || account.default_courier || null,
  };
  if (
    effective.payment_method !== order.payment_method ||
    effective.shipping_fee !== order.shipping_fee ||
    effective.courier !== order.courier
  ) {
    await updateOrderSyncFields(order.id, effective);
    Object.assign(order, effective);
  }

  const requestAt = new Date().toISOString();
  const claimed = await claimOrderForSync(order.id, {
    pancake_pos_account_id: account.id,
    pancake_retry_count: order.pancake_retry_count + 1,
    attemptAt: requestAt,
  });
  if (!claimed) {
    return { ok: true, skipped: true, message: "Another sync for this order is already in progress — skipped." };
  }
  const attempt = claimed.pancake_retry_count;

  // --- Send -----------------------------------------------------------------
  const payload = buildForwardPayload(
    order,
    (agentProfile?.full_name as string) || "",
    (agentProfile?.username as string) || order.assigned_agent_email,
    variationId,
    oneTimeProduct,
    { orderSourceId: matchedSource.id, careStaffId: matchedStaff.id },
    forwardItems
  );
  const result = await createOrder(account, payload);
  const responseAt = new Date().toISOString();

  if (result.ok && result.pancakeOrderId) {
    // Pancake should report the order as Packaging. If it reports something
    // else, the order IS created (id stored verbatim) but the discrepancy is
    // flagged rather than silently accepted.
    const pancakeStatus = result.pancakeStatus || CREATE_STATUS_PACKAGING_LABEL;
    const mismatchReason = result.statusMismatch
      ? `Order created, but Pancake reported status "${pancakeStatus}" instead of ${CREATE_STATUS_PACKAGING_LABEL}.`
      : null;

    await updateOrderSyncFields(order.id, {
      pancake_order_id: result.pancakeOrderId,
      pancake_status: pancakeStatus,
      pancake_sync_status: mismatchReason ? "sync_failed" : "synced",
      pancake_synced_at: responseAt,
      // Anchor the event clock to Pancake's own timestamp, so the first status
      // change they report is not mistaken for an out-of-order event.
      pancake_event_at: result.eventTimestamp,
      pancake_sync_error: mismatchReason,
      forwarded_to_pancake_at: responseAt,
      pancake_request_payload: result.requestPayload,
      pancake_response_payload: result.responsePayload,
    });
    await insertSyncLog({
      order_id: order.id,
      pancake_order_id: result.pancakeOrderId,
      pancake_account_id: account.id,
      action: opts.allowRetry ? "retry" : "forward",
      old_status: order.status,
      new_status: order.status,
      request_at: requestAt,
      response_at: responseAt,
      http_status: result.httpStatus,
      result: mismatchReason ? "failed" : "success",
      error_message: mismatchReason,
      triggered_by: opts.triggeredBy ?? null,
      source: opts.source,
      payload_summary: {
        system_order_id: payload.system_order_id,
        order_number: order.order_number,
        account: account.account_name,
        pancake_status: pancakeStatus,
      },
    });
    await logActivityDirect(opts.triggeredBy ?? null, "PANCAKE_ORDER_SYNCED", "order", order.id, {
      order_number: order.order_number,
      pancake_order_id: result.pancakeOrderId,
      pancake_status: pancakeStatus,
      account: account.account_name,
    });

    if (mismatchReason) {
      await notifyAdministrators(
        "pancake_sync_failed",
        `Pancake status unexpected: ${order.order_number}`,
        mismatchReason,
        `/leads?open=${encodeURIComponent(order.order_number)}`
      );
      return { ok: false, skipped: false, message: mismatchReason, pancakeOrderId: result.pancakeOrderId };
    }
    return {
      ok: true,
      skipped: false,
      message: `Synced to Pancake POS (Order ID: ${result.pancakeOrderId}).`,
      pancakeOrderId: result.pancakeOrderId,
    };
  }

  const errorMsg = result.error || "Unknown Pancake API error";
  await failSync(order, errorMsg, opts, {
    accountId: account.id,
    httpStatus: result.httpStatus,
    requestAt,
    responseAt,
    requestPayload: result.requestPayload,
    responsePayload: result.responsePayload,
    notify: false,
  });
  await notifyAdministrators(
    "pancake_sync_failed",
    `Pancake sync failed: ${order.order_number}`,
    `Attempt ${attempt}: ${errorMsg}. An automatic retry is scheduled; Retry Sync is also available.`,
    `/leads?open=${encodeURIComponent(order.order_number)}`
  );
  return { ok: false, skipped: false, message: `Sync failed: ${errorMsg}` };
}
