import { listAccounts } from "./store";
import { verifyAddressIds } from "./address";

/**
 * Checks an order's Pancake address IDs against Pancake's live hierarchy.
 *
 * Address data is shop-independent, so any active account's credentials serve.
 * Wrapped separately from lib/pancake/address.ts so the lead actions don't have
 * to know how an account is resolved.
 */
export async function verifyOrderAddress(ids: {
  provinceId: string | null;
  districtId: string | null;
  communeId: string | null;
}): Promise<{ ok: boolean; error: string | null; names: { province: string; city: string; barangay: string } }> {
  const blank = { province: "", city: "", barangay: "" };

  if (!ids.provinceId || !ids.districtId || !ids.communeId) {
    return {
      ok: false,
      error: "Select the Province, City/Municipality and Barangay from the address picker.",
      names: blank,
    };
  }

  const accounts = (await listAccounts()).filter((a) => a.is_active);
  const account = accounts.find((a) => a.is_default) || accounts[0];
  if (!account) {
    return {
      ok: false,
      error: "No active Pancake POS account is configured, so the address cannot be verified.",
      names: blank,
    };
  }

  return verifyAddressIds(account, ids);
}
