import { createHmac, timingSafeEqual } from "crypto";
import { WEBHOOK, readTags } from "./config";
import type { IncomingUpdate } from "./types";

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export interface WebhookProof {
  /** Value of the secret request header (Pancake "Request Headers", e.g. X-API-KEY). */
  secretHeader: string | null;
  /** HMAC-SHA256 signature header, if the sender ever provides one. */
  signatureHeader: string | null;
  /** `?token=` query parameter on the registered webhook URL. */
  tokenParam: string | null;
}

/** Verifies an incoming webhook against the account's stored secret. Pancake
 * does not sign payloads but does support custom request headers, so any one
 * of three proofs authenticates the request (see WEBHOOK in config.ts). All
 * comparisons are timing-safe. */
export function verifyWebhookRequest(rawBody: string, proof: WebhookProof, webhookSecret: string): boolean {
  if (proof.secretHeader && safeEqual(webhookSecret, proof.secretHeader.trim())) return true;
  if (proof.signatureHeader) {
    const expected = createHmac(WEBHOOK.algorithm, webhookSecret).update(rawBody, "utf8").digest("hex");
    if (safeEqual(expected, proof.signatureHeader.replace(/^sha256=/i, "").trim())) return true;
  }
  if (proof.tokenParam && safeEqual(webhookSecret, proof.tokenParam)) return true;
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
      statusName: s("status_name"),
      eventTimestamp: s(f.event_timestamp),
      shopId: s(f.shop_id),
      tags: readTags(inner[f.tags]),
    },
  };
}
