import { NextRequest, NextResponse } from "next/server";
import { decryptSecret } from "@/lib/pancake/crypto";
import { verifyWebhookRequest, parseWebhookPayload } from "@/lib/pancake/verifyWebhook";
import { applyIncomingUpdate } from "@/lib/pancake/receive";
import { listAccounts, insertSyncLog } from "@/lib/pancake/store";
import { WEBHOOK } from "@/lib/pancake/config";

export const dynamic = "force-dynamic";

/** Pancake POS webhook receiver (Section 4). Exempt from session auth
 * (middleware PUBLIC_PATHS) but protected by secret verification: the request
 * must carry either an HMAC-SHA256 signature of the raw body or the account's
 * webhook secret as the `?token=` query parameter (register the webhook in
 * Pancake as https://<domain>/api/webhooks/pancake?token=<secret>). The
 * matching account also identifies the sender, so nothing in the
 * (unauthenticated) payload is trusted for account identity. */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get(WEBHOOK.signature_header);
  const token = req.nextUrl.searchParams.get(WEBHOOK.token_query_param);

  // Identify the sending account by which stored secret validates the request.
  const accounts = (await listAccounts()).filter((a) => a.is_active && a.webhook_secret_encrypted);
  let matchedAccount = null;
  for (const account of accounts) {
    let secret: string;
    try {
      secret = decryptSecret(account.webhook_secret_encrypted!);
    } catch {
      continue; // undecryptable secret (rotated key) — skip
    }
    if (verifyWebhookRequest(rawBody, signature, token, secret)) {
      matchedAccount = account;
      break;
    }
  }

  if (!matchedAccount) {
    await insertSyncLog({
      action: "status_update",
      source: "webhook",
      request_at: new Date().toISOString(),
      result: "failed",
      error_message:
        accounts.length === 0
          ? "Webhook received but no active account has a webhook secret configured."
          : "Invalid webhook signature/token — rejected.",
      payload_summary: { signature_present: Boolean(signature), token_present: Boolean(token), body_bytes: rawBody.length },
    });
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { update } = parseWebhookPayload(payload);
  const result = await applyIncomingUpdate(update, "webhook", matchedAccount.id);
  return NextResponse.json({ ok: true, applied: result.applied, reason: result.reason });
}
