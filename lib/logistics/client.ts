import type { LogisticsConnection } from "@/lib/types";
import type { PancakeCredentials } from "@/lib/pancake/client";
import { probeShop } from "@/lib/pancake/client";
import { logisticsMockMode } from "./config";

/**
 * A logistics connection in the shape the shared Pancake transport wants.
 *
 * The two tables name the shop differently on purpose: `pancake_accounts` calls
 * it `shop_or_page_id` because that field has held Facebook page IDs as well as
 * POS shop IDs, and the wrong one there is the single most common cause of the
 * 404 the connection test explains. A logistics connection accepts the POS shop
 * ID only, so the column says so.
 */
export function credentialsFor(conn: LogisticsConnection): PancakeCredentials {
  return {
    api_endpoint: conn.api_endpoint,
    shop_or_page_id: conn.shop_id,
    api_key_encrypted: conn.api_key_encrypted,
  };
}

/**
 * Verifies the credentials decrypt and the shop answers.
 *
 * Reuses the outbound adapter's probe, which already translates Pancake's
 * Vietnamese 401/403/404/429 replies into something an administrator on this
 * floor can act on. It deliberately calls `probeShop` rather than
 * `testConnection`: PANCAKE_MOCK_MODE simulates the OUTBOUND integration, and a
 * simulated success there must never be reported as proof that a logistics
 * shop's own credentials work. LOGISTICS_MOCK_MODE is the only switch that can
 * fake this one.
 */
export async function testLogisticsConnection(conn: LogisticsConnection): Promise<{ ok: boolean; message: string }> {
  const mode = logisticsMockMode();
  if (mode === "fail") {
    return { ok: false, message: "LOGISTICS_MOCK_MODE=fail: connection simulated as failed." };
  }
  if (mode === "success") {
    return { ok: true, message: "LOGISTICS_MOCK_MODE: connection simulated as successful." };
  }
  return probeShop(credentialsFor(conn));
}
