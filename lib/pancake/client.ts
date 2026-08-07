import type { PancakeAccount } from "@/lib/types";
import { decryptSecret } from "./crypto";
import { AUTH_QUERY_PARAM, DEFAULT_API_BASE_URL, REQUEST_TIMEOUT_MS, mockMode } from "./config";

export interface PancakeHttpResult {
  ok: boolean;
  httpStatus: number | null;
  body: unknown;
  error: string | null;
}

/** Compact, human-readable form of a Pancake error response for sync logs. */
function summarizeErrorBody(body: unknown, rawText: string): string {
  const b = body as Record<string, unknown> | null;
  const candidate =
    (b && (b.message || b.error || b.error_message || b.errors || b.detail)) ?? (rawText ? rawText.trim() : "");
  const text = typeof candidate === "string" ? candidate : JSON.stringify(candidate);
  if (!text) return "(no error details returned)";
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

function baseUrl(account: PancakeAccount): string {
  return (account.api_endpoint || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

export function resolvePath(template: string, account: PancakeAccount, orderId?: string): string {
  return template
    .replace("{shopId}", encodeURIComponent(account.shop_or_page_id))
    .replace("{orderId}", encodeURIComponent(orderId || ""));
}

/** Authenticated HTTP call to the account's Pancake endpoint. Pancake takes
 * the API key as an `api_key` QUERY PARAMETER (per the official OpenAPI spec)
 * — the key is appended here, server-side only, and never logged. MOCK_MODE is
 * short-circuited by the callers (createOrder/getOrder/testConnection). */
export async function pancakeFetch(
  account: PancakeAccount,
  path: string,
  init: { method: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number }
): Promise<PancakeHttpResult> {
  const timeoutMs = init.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let apiKey: string;
  try {
    apiKey = decryptSecret(account.api_key_encrypted);
  } catch (e) {
    return { ok: false, httpStatus: null, body: null, error: `Cannot decrypt API key: ${(e as Error).message}` };
  }

  const url = new URL(`${baseUrl(account)}${path}`);
  url.searchParams.set(AUTH_QUERY_PARAM, apiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      method: init.method,
      headers: { "Content-Type": "application/json", ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON body */
    }
    return {
      ok: res.ok,
      httpStatus: res.status,
      body,
      // Pancake explains rejections in the response body, so surface it —
      // without it a 4xx is undiagnosable. The body is Pancake's own output
      // and never contains our credentials.
      error: res.ok ? null : `Pancake API responded ${res.status}: ${summarizeErrorBody(body, text)}`,
    };
  } catch (e) {
    const msg = (e as Error).name === "AbortError" ? `Request timed out after ${timeoutMs}ms` : (e as Error).message;
    return { ok: false, httpStatus: null, body: null, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/** Unwraps Pancake responses that arrive as `{ success, data: {...} }` as well
 * as bare objects. */
export function unwrapData(body: unknown): Record<string, unknown> {
  const b = (body || {}) as Record<string, unknown>;
  if (b.data && typeof b.data === "object" && !Array.isArray(b.data)) return b.data as Record<string, unknown>;
  return b;
}

/** Turns a Pancake rejection into something an Administrator here can act on.
 *
 * Pancake answers in Vietnamese — a 404 arrives as "Cửa hàng không tồn tại",
 * which is accurate, unreadable on this floor, and does not say which of the
 * two fields is wrong. The guidance is prepended rather than substituted:
 * Pancake's own words stay attached, because they are what matches their
 * documentation and what their support will ask for.
 *
 * Keyed on status rather than on the Vietnamese text, which is theirs to
 * change without warning.
 */
function explainConnectionFailure(httpStatus: number | null, raw: string): string {
  const advice: Record<number, string> = {
    // The shop endpoint resolved but Pancake has no such shop for this key.
    // Almost always the wrong kind of id: Pancake Pages is keyed by Facebook
    // page id (a long number beginning 10…), Pancake POS by a short shop id,
    // and the field here has historically been filled with the former.
    404: "Shop ID not found. Check that it is the Pancake POS shop ID — the number in the POS URL — and not a Facebook page ID. If the ID is right, the API key may belong to a different shop.",
    401: "API key rejected. Regenerate it in Pancake under Setting → Advance → Third-party connection, from inside the shop you are connecting.",
    403: "API key accepted but not permitted for this shop. It was most likely created in a different shop.",
    429: "Pancake is rate-limiting this account. Wait a moment and try again.",
  };

  // `raw` already reads "Pancake API responded 404: …", so it is appended
  // plainly rather than introduced again.
  const hint = httpStatus !== null ? advice[httpStatus] : null;
  if (hint) return `${hint} — ${raw}`;
  if (httpStatus !== null && httpStatus >= 500) {
    return `Pancake's server is failing, so this is unlikely to be a configuration problem here — ${raw}`;
  }
  return raw;
}

/** Test Connection button: verifies credentials decrypt and the shop endpoint
 * responds. In MOCK_MODE it only checks decryptability. */
export async function testConnection(account: PancakeAccount): Promise<{ ok: boolean; message: string }> {
  if (mockMode() !== "off") {
    try {
      decryptSecret(account.api_key_encrypted);
      return mockMode() === "success"
        ? { ok: true, message: "MOCK_MODE: credentials decrypt OK; connection simulated as successful." }
        : { ok: false, message: "MOCK_MODE=fail: connection simulated as failed." };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }
  // A shop id has to be there before there is any point asking Pancake about
  // it — an empty one makes the path `/shops/`, which comes back as the same
  // 404 as a wrong id and sends you looking in the wrong place.
  if (!account.shop_or_page_id?.trim()) {
    return { ok: false, message: "No Shop ID is set for this account. Add the Pancake POS shop ID and try again." };
  }

  // GET /shops/{SHOP_ID} — cheap authenticated call that also validates the shop id.
  const res = await pancakeFetch(account, resolvePath("/shops/{shopId}", account), { method: "GET" });
  return res.ok
    ? { ok: true, message: `Connected (HTTP ${res.httpStatus}).` }
    : { ok: false, message: explainConnectionFailure(res.httpStatus, res.error || "Connection failed.") };
}
