import type { Order } from "@/lib/types";

// Auto-retry backoff (Section 7): after a failed forward attempt N (1-based),
// the next retry is due DELAYS[N-1] minutes after the last attempt. Max 5
// total attempts (1 initial + 4 auto-retries), then needs_review.
export const RETRY_DELAYS_MINUTES = [1, 5, 30, 120] as const;
export const MAX_ATTEMPTS = 5;

/** Last-attempt time is approximated by updated-at of the failure — we use the
 * latest failed sync-log request_at passed in by the cron. Returns the ISO
 * time the next auto-retry is due, or null when attempts are exhausted. */
export function nextRetryDueAt(order: Pick<Order, "pancake_sync_attempts">, lastAttemptAt: string): string | null {
  const attempts = order.pancake_sync_attempts;
  if (attempts >= MAX_ATTEMPTS) return null;
  const delayMin = RETRY_DELAYS_MINUTES[Math.min(attempts - 1, RETRY_DELAYS_MINUTES.length - 1)];
  return new Date(new Date(lastAttemptAt).getTime() + delayMin * 60_000).toISOString();
}
