import { NextRequest, NextResponse } from "next/server";
import { forwardOrderToPancake } from "@/lib/pancake/forward";
import { applyIncomingUpdate } from "@/lib/pancake/receive";
import { getOrder } from "@/lib/pancake/getOrder";
import { MAX_ATTEMPTS, nextRetryDueAt } from "@/lib/pancake/retry";
import {
  getAccount,
  listOrdersForPolling,
  listOrdersWithFailedSync,
  listSyncLogs,
  updateOrderSyncFields,
  insertSyncLog,
  notifyManagement,
} from "@/lib/pancake/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const POLL_BATCH_LIMIT = 20;

/** Background worker (Vercel Cron, every 10 min — see vercel.json):
 *  1. Retry queue: failed forwards get auto-retried with backoff
 *     (1m → 5m → 30m → 2h, max 5 attempts) then land in Needs Review.
 *  2. Polling fallback: for accounts WITHOUT a webhook secret configured,
 *     poll Pancake for orders in non-terminal fulfillment states.
 * Protected by CRON_SECRET (Vercel sends it as a Bearer token automatically). */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const summary = { retried: 0, movedToNeedsReview: 0, polled: 0, pollApplied: 0, errors: [] as string[] };

  // --- 1. Retry queue -------------------------------------------------------
  try {
    const failed = await listOrdersWithFailedSync();
    for (const order of failed) {
      try {
        if (order.pancake_sync_attempts >= MAX_ATTEMPTS) {
          await updateOrderSyncFields(order.id, {
            pancake_sync_status: "needs_review",
            pancake_sync_error: `${order.pancake_sync_error || "Forward failed"} (max ${MAX_ATTEMPTS} attempts reached)`,
          });
          await insertSyncLog({
            order_id: order.id,
            action: "retry",
            source: "auto_retry",
            request_at: new Date().toISOString(),
            result: "failed",
            error_message: `Max ${MAX_ATTEMPTS} attempts reached — moved to Needs Review.`,
          });
          await notifyManagement(
            "pancake_needs_review",
            `Pancake sync needs review: ${order.order_number}`,
            `Forwarding failed ${MAX_ATTEMPTS} times. Manual attention required (Retry Sync stays available).`,
            `/leads?open=${encodeURIComponent(order.order_number)}`
          );
          summary.movedToNeedsReview++;
          continue;
        }

        const [lastFailure] = await listSyncLogs({ order_id: order.id, result: "failed", limit: 1 });
        const lastAttemptAt = lastFailure?.request_at || order.updated_at;
        const dueAt = nextRetryDueAt(order, lastAttemptAt);
        if (dueAt && dueAt <= new Date().toISOString()) {
          await forwardOrderToPancake(order.id, { source: "auto_retry", allowRetry: true });
          summary.retried++;
        }
      } catch (e) {
        summary.errors.push(`retry ${order.order_number}: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    summary.errors.push(`retry queue: ${(e as Error).message}`);
  }

  // --- 2. Polling fallback (webhook-less accounts only) ---------------------
  try {
    const candidates = await listOrdersForPolling();
    for (const order of candidates.slice(0, POLL_BATCH_LIMIT)) {
      try {
        if (!order.pancake_pos_account_id) continue;
        const account = await getAccount(order.pancake_pos_account_id);
        if (!account || !account.is_active) continue;
        if (account.webhook_secret_encrypted) continue; // webhooks configured — they're the source of truth

        summary.polled++;
        const res = await getOrder(account, order);
        if (!res.ok) {
          await insertSyncLog({
            order_id: order.id,
            pancake_order_id: order.pancake_order_id,
            pancake_account_id: account.id,
            action: "poll",
            source: "api_polling",
            request_at: new Date().toISOString(),
            http_status: res.httpStatus,
            result: "failed",
            error_message: res.error,
          });
          continue;
        }
        const applied = await applyIncomingUpdate(
          {
            pancakeOrderId: order.pancake_order_id,
            externalReference: order.id,
            orderNumber: order.order_number,
            phone: null,
            rawStatus: res.rawStatus,
            eventTimestamp: res.eventTimestamp,
            shopId: account.shop_or_page_id,
          },
          "api_polling",
          account.id
        );
        if (applied.applied) summary.pollApplied++;
      } catch (e) {
        summary.errors.push(`poll ${order.order_number}: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    summary.errors.push(`polling: ${(e as Error).message}`);
  }

  return NextResponse.json({ ok: true, ...summary });
}
