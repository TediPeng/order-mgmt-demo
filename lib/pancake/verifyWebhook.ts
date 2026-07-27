import { createHmac, timingSafeEqual } from "crypto";
import { WEBHOOK } from "./config";
import type { IncomingUpdate } from "./types";

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Verifies an incoming webhook against the account's stored secret.
 * Pancake's public docs describe no payload signing, so two proofs are
 * accepted (either passes):
 *  1. HMAC-SHA256 hex of the raw body in the signature header (future-proof,
 *     also what a signing-capable sender would use), or
 *  2. the secret itself as the `?token=` query parameter of the registered
 *     webhook URL — the standard shared-token pattern for unsigned senders.
 * Both comparisons are timing-safe. */
export function verifyWebhookRequest(
  rawBody: string,
  signatureHeader: string | null,
  tokenParam: string | null,
  webhookSecret: string
): boolean {
  if (signatureHeader) {
    const expected = createHmac(WEBHOOK.algorithm, webhookSecret).update(rawBody, "utf8").digest("hex");
    const provided = signatureHeader.replace(/^sha256=/i, "").trim();
    if (safeEqual(expected, provided)) return true;
  }
  if (tokenParam) {
    if (safeEqual(webhookSecret, tokenParam)) return true;
  }
  return false;
}

/** Maps the raw webhook JSON onto the adapter-neutral IncomingUpdate using the
 * documented Pancake Order schema field names (config.ts). Pancake sends the
 * order object either bare or wrapped (e.g. { data: {...} } / { order: {...} });
 * all three shapes are handled. Missing fields become null — the receiver
 * treats unmatchable updates as needs_review, never guesses. */
export function parseWebhookPayload(payload: Record<string, unknown>): { event: string | null; update: IncomingUpdate } {
  const f = WEBHOOK.fields;
  let inner: Record<string, unknown> = payload;
  if (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
    inner = payload.data as Record<string, unknown>;
  } else if (payload.order && typeof payload.order === "object" && !Array.isArray(payload.order)) {
    inner = payload.order as Record<string, unknown>;
  }
  const s = (k: string) => (inner[k] != null && inner[k] !== "" ? String(inner[k]) : null);
  return {
    event: payload.event != null ? String(payload.event) : null,
    update: {
      pancakeOrderId: s(f.order_id),
      externalReference: s(f.external_reference),
      orderNumber: s(f.display_id),
      phone: s(f.phone),
      rawStatus: s(f.status),
      eventTimestamp: s(f.event_timestamp),
      shopId: s(f.shop_id),
    },
  };
}
