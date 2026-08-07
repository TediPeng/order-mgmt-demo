"use server";

import { redirect } from "next/navigation";
import { v4 as uuid } from "uuid";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCurrentUser, verifyPassword } from "@/lib/auth";
import { isFullAccess } from "@/lib/permissions";
import { getRequestInfo } from "@/lib/request-info";
import { CLEAR_DATA_PHRASE, CLEAR_PLAN } from "@/lib/clear-data";

/**
 * Company data reset, from the UI. The same job as
 * scripts/reset-company-data.mjs, and deliberately the same shape: transactional
 * and user-generated records go, reference data / configuration / integrations /
 * accounts stay.
 *
 * The script guards itself with RESET_COMPANY_DATA=CONFIRM and prints the target
 * project before touching it, because local development and production share ONE
 * Supabase project — there is no second database to fall back on. A button has
 * no command line to put a guard on, so the equivalent friction is enforced
 * here: administrator only, the exact phrase typed out, and the caller's own
 * password re-entered. None of that is validated in the browser alone; a crafted
 * request has to satisfy every one of these checks too.
 */

const SETTINGS_PATH = "/settings/system";

function back(message: string): never {
  redirect(`${SETTINGS_PATH}?error=${encodeURIComponent(message)}`);
}

/** Orders already forwarded to Pancake. Deleting one here would not cancel a
 * parcel already with a courier, so it has to stay reconcilable. */
async function syncedOrderIds(): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("id")
    .or("pancake_order_id.not.is.null,forwarded_to_pancake_at.not.is.null");
  if (error) throw new Error(`Could not check for synced orders: ${error.message}`);
  return ((data || []) as { id: string }[]).map((o) => o.id);
}

/** The customers those preserved orders belong to. They have to survive too:
 * orders.customer_id is ON DELETE NO ACTION, so deleting one out from under a
 * kept order fails the whole step. */
async function customerIdsOf(orderIds: string[]): Promise<string[]> {
  if (orderIds.length === 0) return [];
  const { data, error } = await supabaseAdmin.from("orders").select("customer_id").in("id", orderIds);
  if (error) throw new Error(`Could not check preserved customers: ${error.message}`);
  return Array.from(
    new Set(((data || []) as { customer_id: string | null }[]).map((o) => o.customer_id).filter(Boolean) as string[])
  );
}

async function countRows(table: string): Promise<number> {
  const { count, error } = await supabaseAdmin.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`Could not count ${table}: ${error.message}`);
  return count ?? 0;
}

export async function clearCompanyDataAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Administrator only — not "management", not a custom role that happens to
  // hold settings.manage.
  if (!isFullAccess(user!.role)) back("Administrator access required.");

  const phrase = String(formData.get("confirm_phrase") || "").trim();
  if (phrase !== CLEAR_DATA_PHRASE) {
    back(`Type ${CLEAR_DATA_PHRASE} exactly to confirm. Nothing was deleted.`);
  }

  const password = String(formData.get("password") || "");
  if (!password || !verifyPassword(password, user!.password_hash)) {
    back("Password incorrect. Nothing was deleted.");
  }

  const keptOrderIds = await syncedOrderIds();
  const keptCustomerIds = await customerIdsOf(keptOrderIds);

  const before: Record<string, number> = {};
  for (const step of CLEAR_PLAN) before[step.table] = await countRows(step.table);

  let cleared = 0;
  for (const step of CLEAR_PLAN) {
    let q = supabaseAdmin.from(step.table).delete();
    if (step.scope === "except_kept_orders" && keptOrderIds.length > 0) {
      // Rows belonging to a preserved order stay; rows with no order are cleared.
      q = q.or(`${step.column}.is.null,${step.column}.not.in.(${keptOrderIds.join(",")})`);
    } else if (step.scope === "except_kept_customers" && keptCustomerIds.length > 0) {
      q = q.not("id", "in", `(${keptCustomerIds.join(",")})`);
    } else {
      q = q.not(step.idColumn || "id", "is", null);
    }
    const { error } = await q;
    // Stop at the first failure rather than carrying on through the remaining
    // tables — a partial clear is recoverable, a half-torn-down one is not.
    if (error) back(`Stopped while clearing ${step.table}: ${error.message}. Earlier tables were already cleared.`);
    cleared += before[step.table] - (await countRows(step.table));
  }

  // Logged after the wipe, since activity_log is one of the tables cleared.
  // Inserted directly rather than through the DbShape outbox: this runs
  // immediately after a destructive operation and should not depend on a full
  // read/write cycle succeeding.
  const info = await getRequestInfo();
  await supabaseAdmin.from("activity_log").insert({
    id: uuid(),
    user_id: user!.id,
    user_email: user!.email,
    action: "COMPANY_DATA_CLEARED",
    entity_type: "system",
    entity_id: null,
    details: { rows_deleted: cleared, orders_preserved: keptOrderIds.length, tables: CLEAR_PLAN.map((s) => s.table) },
    module: "settings",
    previous_value: before,
    updated_value: null,
    ip_address: info.ip_address,
    device_info: info.device_info,
    created_at: new Date().toISOString(),
  });

  redirect(`${SETTINGS_PATH}?cleared=${cleared}&kept=${keptOrderIds.length}`);
}
