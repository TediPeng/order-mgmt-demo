import type { Order } from "@/lib/types";

// Auto-retry backoff (Section 7): after a failed forward attempt N (1-based),
// the next retry is due DELAYS[N-1] minutes after the last attempt. Max 5
// total attempts (1 initial + 4 auto-retries); once exhausted the order stays
// sync_failed and is surfaced as "Sync Failed — needs review".
export const RETRY_DELAYS_MINUTES = [1, 5, 30, 120] as const;
export const MAX_ATTEMPTS = 5;

/** True once auto-retries are exhausted — the "needs review" condition. */
export function needsReview(order: Pick<Order, "pancake_sync_status" | "pancake_retry_count">): boolean {
  return order.pancake_sync_status === "sync_failed" && order.pancake_retry_count >= MAX_ATTEMPTS;
}

/** Returns the ISO time the next auto-retry is due, or null when exhausted. */
export function nextRetryDueAt(order: Pick<Order, "pancake_retry_count">, lastAttemptAt: string): string | null {
  const attempts = order.pancake_retry_count;
  if (attempts >= MAX_ATTEMPTS) return null;
  // Zero attempts is a real state, not an impossible one: an order that failed
  // its pre-flight checks — no matching Pancake staff for the agent's email, no
  // order source — never reached claimOrderForSync() and so never counted an
  // attempt. Indexing at attempts - 1 read RETRY_DELAYS_MINUTES[-1] there,
  // which is undefined, and new Date(NaN).toISOString() throws. The sweep
  // catches it per order, so those orders simply never retried again and said
  // nothing about it — six of them sat that way from 2026-08-09.
  const step = Math.min(Math.max(attempts - 1, 0), RETRY_DELAYS_MINUTES.length - 1);
  return new Date(new Date(lastAttemptAt).getTime() + RETRY_DELAYS_MINUTES[step] * 60_000).toISOString();
}
