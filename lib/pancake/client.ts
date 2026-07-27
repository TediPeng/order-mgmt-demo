import type { PancakeAccount } from "@/lib/types";
import { decryptSecret } from "./crypto";
import { AUTH_QUERY_PARAM, DEFAULT_API_BASE_URL, REQUEST_TIMEOUT_MS, mockMode } from "./config";

export interface PancakeHttpResult {
  ok: boolean;
  httpStatus: number | null;
  body: unknown;
  error: string | null;
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
  init: { method: string; body?: unknown; headers?: Record<string, string> }
): Promise<PancakeHttpResult> {
  let apiKey: string;
  try {
    apiKey = decryptSecret(account.api_key_encrypted);
  } catch (e) {
    return { ok: false, httpStatus: null, body: null, error: `Cannot decrypt API key: ${(e as Error).message}` };
  }

  const url = new URL(`${baseUrl(account)}${path}`);
  url.searchParams.set(AUTH_QUERY_PARAM, apiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      method: init.method,
      headers: { "Content-Type": "application/json", ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
      cache: "no-store",
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON body */
    }
    return {
      ok: res.ok,
      httpStatus: res.status,
      body,
      error: res.ok ? null : `Pancake API responded ${res.status}`,
    };
  } catch (e) {
    const msg = (e as Error).name === "AbortError" ? `Request timed out after ${REQUEST_TIMEOUT_MS}ms` : (e as Error).message;
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
  // GET /shops/{SHOP_ID} — cheap authenticated call that also validates the shop id.
  const res = await pancakeFetch(account, resolvePath("/shops/{shopId}", account), { method: "GET" });
  return res.ok
    ? { ok: true, message: `Connected (HTTP ${res.httpStatus}).` }
    : { ok: false, message: res.error || "Connection failed." };
}
