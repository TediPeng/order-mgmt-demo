import { waitUntil } from "@vercel/functions";
import { forwardOrderToPancake } from "./forward";
import { applyIncomingUpdate } from "./receive";
import { getOrder } from "./getOrder";
import { MAX_ATTEMPTS, nextRetryDueAt } from "./retry";
import {
  getAccount,
  listOrdersForPolling,
  listOrdersStuckSyncing,
  listOrdersWithFailedSync,
  listSyncLogs,
  updateOrderSyncFields,
  insertSyncLog,
  notifyAdministrators,
} from "./store";

export interface SweepSummary {
  released: number;
  retried: number;
  movedToNeedsReview: number;
  polled: number;
  pollApplied: number;
  errors: string[];
}

export interface SweepOptions {
  /** Cap on forwards retried in one run, so a lazy in-request sweep stays short. */
  maxRetries?: number;
  /** Cap on orders polled in one run. */
  maxPolls?: number;
}

const POLL_BATCH_LIMIT = 20;
/** A sync stuck in `syncing` this long was killed mid-flight. */
const SYNCING_STALE_MINUTES = 10;
/** Don't re-poll an order that synced more recently than this. */
const MIN_POLL_INTERVAL_MINUTES = 10;

function minutesAgoIso(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/** The background half of the integration, safe to run from anywhere:
 *  1. release forwards stuck in `processing`
 *  2. auto-retry failed forwards on the backoff schedule, then Needs Review
 *  3. poll Pancake for orders on accounts with no webhook configured
 *
 * Every step is idempotent and guarded by its own due-time check, so running
 * it more often than necessary is cheap and harmless — that's what lets the
 * lazy in-app sweep and the Vercel cron share it without coordinating. */
export async function runPancakeSync(opts: SweepOptions = {}): Promise<SweepSummary> {
  const maxRetries = opts.maxRetries ?? Number.POSITIVE_INFINITY;
  const maxPolls = opts.maxPolls ?? POLL_BATCH_LIMIT;
  const summary: SweepSummary = { released: 0, retried: 0, movedToNeedsReview: 0, polled: 0, pollApplied: 0, errors: [] };

  // --- 1. Release stuck `syncing` orders ------------------------------------
  try {
    for (const order of await listOrdersStuckSyncing(minutesAgoIso(SYNCING_STALE_MINUTES))) {
      // Never release one that actually reached Pancake — that would risk a
      // second order. Those are left alone for manual inspection.
      if (order.pancake_order_id) continue;
      const reason = `Sync did not complete within ${SYNCING_STALE_MINUTES} minutes — released for retry.`;
      await updateOrderSyncFields(order.id, { pancake_sync_status: "sync_failed", pancake_sync_error: reason });
      await insertSyncLog({
        order_id: order.id,
        pancake_account_id: order.pancake_pos_account_id,
        action: "retry",
        source: "auto_retry",
        request_at: new Date().toISOString(),
        result: "failed",
        error_message: reason,
      });
      summary.released++;
    }
  } catch (e) {
    summary.errors.push(`stuck-syncing sweep: ${(e as Error).message}`);
  }

  // --- 2. Retry queue -------------------------------------------------------
  try {
    for (const order of await listOrdersWithFailedSync()) {
      try {
        if (order.pancake_retry_count >= MAX_ATTEMPTS) {
          // The order stays sync_failed: "needs review" is that state plus an
          // exhausted retry budget, not a status of its own. Mark and notify
          // once, the first time the budget runs out.
          if (/needs review/i.test(order.pancake_sync_error || "")) continue;
          await updateOrderSyncFields(order.id, {
            pancake_sync_error: `${order.pancake_sync_error || "Sync failed"} — needs review (max ${MAX_ATTEMPTS} attempts reached)`,
          });
          await insertSyncLog({
            order_id: order.id,
            action: "retry",
            source: "auto_retry",
            request_at: new Date().toISOString(),
            result: "failed",
            error_message: `Max ${MAX_ATTEMPTS} attempts reached — needs review.`,
          });
          await notifyAdministrators(
            "pancake_needs_review",
            `Pancake sync needs review: ${order.order_number}`,
            `Syncing failed ${MAX_ATTEMPTS} times. Manual attention required (Retry Sync stays available).`,
            `/leads?open=${encodeURIComponent(order.order_number)}`
          );
          summary.movedToNeedsReview++;
          continue;
        }

        const [lastFailure] = await listSyncLogs({ order_id: order.id, result: "failed", limit: 1 });
        const lastAttemptAt = lastFailure?.request_at || order.updated_at;
        const dueAt = nextRetryDueAt(order, lastAttemptAt);
        if (dueAt && dueAt <= new Date().toISOString()) {
          if (summary.retried >= maxRetries) break;
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

  // --- 3. Polling fallback (webhook-less accounts only) ---------------------
  try {
    const staleBefore = minutesAgoIso(MIN_POLL_INTERVAL_MINUTES);
    const candidates = (await listOrdersForPolling()).filter(
      (o) => !o.pancake_synced_at || o.pancake_synced_at < staleBefore
    );
    for (const order of candidates.slice(0, maxPolls)) {
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
            externalReference: order.system_order_id || order.order_number,
            orderNumber: order.order_number,
            phone: null,
            rawStatus: res.rawStatus,
            statusName: res.statusName,
            trackingNumber: res.trackingNumber,
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

  return summary;
}

// --- Lazy in-app sweep -------------------------------------------------------
// Vercel Cron frequency depends on the account's plan, so the integration must
// not rely on it: the authenticated layout kicks this off on page loads, the
// same lazy pattern lib/attendance-sweep.ts uses. The throttle is per serverless
// instance (there is no shared timer), which is fine because runPancakeSync is
// idempotent and every unit of work has its own due-time guard.

const SWEEP_THROTTLE_MS = 5 * 60_000;
/** Small budget: the sweep shares an invocation with a page render. */
const LAZY_MAX_RETRIES = 3;
const LAZY_MAX_POLLS = 5;
let lastSweepStartedAt = 0;
let sweepInFlight = false;

/** Runs the sweep alongside a page render without blocking it.
 *
 * The promise is handed to Vercel's waitUntil() so the platform keeps the
 * invocation alive until the sweep finishes. Without it, the instance is free
 * to freeze the moment the response is sent, which suspends any in-flight
 * fetch to Pancake mid-call — on thaw the abort timer fires and a perfectly
 * healthy request is recorded as "Request timed out". Work is capped so the
 * sweep can't outlive a reasonable invocation. */
export function maybeSweepPancakeSync(): void {
  const now = Date.now();
  if (sweepInFlight || now - lastSweepStartedAt < SWEEP_THROTTLE_MS) return;
  lastSweepStartedAt = now;
  sweepInFlight = true;

  const task = runPancakeSync({ maxRetries: LAZY_MAX_RETRIES, maxPolls: LAZY_MAX_POLLS })
    .catch((e) => console.error("Pancake lazy sweep failed:", (e as Error).message))
    .finally(() => {
      sweepInFlight = false;
    });

  try {
    // Only meaningful on Vercel; a no-op/throw elsewhere (e.g. local dev),
    // where nothing freezes the process anyway.
    waitUntil(task);
  } catch {
    void task;
  }
}
