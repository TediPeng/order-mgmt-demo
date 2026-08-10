"use server";

import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { writeDb, markOrderDirty, loadOrderInto, adoptOrders } from "@/lib/db";
import { orderRowsForPhoneAndAgent, orderRowsForCustomer } from "@/lib/orders-lookup";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { orderInScope } from "@/lib/order-access";
import { can, isFullAccess } from "@/lib/permissions";
import {
  createRegularCustomer,
  findDuplicates,
  findRegularCustomerByPhone,
  recordDuplicates,
  upsertRegularCustomer,
} from "@/lib/customers";
import { allowedAssigneeIds } from "@/lib/order-access";
import { regularCustomerFormSchema } from "@/lib/validation";
import { describeParseFailure } from "@/lib/zod-error";
import { requireUserLite } from "./guards";
import type { DuplicateStatus } from "@/lib/types";

const PATH = "/regular-customers";
const NEW_PATH = "/regular-customers/new";

/** Adds a Regular Customer directly — the Add Regular Customer button.
 *
 * This is NOT the lead form and must not become it: no product, no status, no
 * order is created, so nothing from here can turn up in the Leads list. What
 * is created is a person the agent owns.
 *
 * Agents create for themselves; only a role that may assign leads (Team Lead,
 * Administrator) can file one under another agent, and `allowedAssigneeIds`
 * is what decides that — the same rule Leads uses, so ownership cannot be
 * widened here by posting a different agent_id. */
export async function createRegularCustomerAction(formData: FormData) {
  const { user, db } = await requireUserLite();
  if (!can(user.role, "regular_customers", "create", db.role_permissions)) {
    redirect(`${PATH}?error=${encodeURIComponent("You do not have permission to add regular customers.")}`);
  }

  const parsed = regularCustomerFormSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    redirect(`${NEW_PATH}?error=${encodeURIComponent(describeParseFailure(parsed.error))}`);
  }
  const data = parsed.data;

  const allowed = allowedAssigneeIds(user, db);
  const ownerAgentId = data.agent_id && allowed.includes(data.agent_id) ? data.agent_id : user.id;

  // One record per person per agent: a second entry for the same number would
  // split their order history across two rows.
  const existing = await findRegularCustomerByPhone(data.phone, ownerAgentId);
  if (existing) {
    redirect(
      `${NEW_PATH}?error=${encodeURIComponent(
        `${existing.full_name} is already a regular customer on that phone number.`
      )}`
    );
  }

  const customer = await createRegularCustomer(
    {
      full_name: data.full_name,
      phone: data.phone,
      purok: data.purok,
      barangay: data.barangay,
      city: data.city,
      province: data.province,
      landmark: data.landmark,
      pancake_province_id: data.pancake_province_id,
      pancake_district_id: data.pancake_district_id,
      pancake_commune_id: data.pancake_commune_id,
      customer_status: data.customer_status,
    },
    ownerAgentId
  );

  // Orders this agent already holds for the same number belong to the customer
  // record now, and therefore leave the active Leads list — the same move
  // tagging performs, so both routes in end in the same state.
  // Asked of the database rather than filtered out of every order in memory —
  // this is at most a handful of rows on one number.
  let moved = 0;
  for (const o of adoptOrders(db, await orderRowsForPhoneAndAgent(data.phone, ownerAgentId))) {
    o.is_regular_customer = true;
    o.regular_customer_since = o.regular_customer_since || customer.regular_since;
    o.customer_id = customer.id;
    markOrderDirty(db, o.id);
    moved++;
  }
  if (moved > 0) await supabaseAdmin.from("customers").update({ total_orders: moved }).eq("id", customer.id);

  const findings = await findDuplicates({
    id: customer.id,
    full_name: customer.full_name,
    phone_normalized: customer.phone_normalized,
    purok: customer.purok,
    barangay: customer.barangay,
    city: customer.city,
    province: customer.province,
  });
  await recordDuplicates(customer.id, findings);

  const info = await getRequestInfo();
  logActivity(db, user.id, "REGULAR_CUSTOMER_CREATED", "customer", customer.id, {
    customer_name: customer.full_name,
    owner_agent_id: ownerAgentId,
    orders_moved: moved,
    potential_duplicates: findings.length,
  }, { module: "regular_customers", ...info });
  await writeDb(db);

  redirect(`${PATH}?created=1`);
}

/** Tags the customer behind a lead as Regular.
 *
 * The lead is flagged, never removed: Leads views filter on the flag so the
 * record leaves the active list while its orders, calls and audit trail stay
 * exactly where they were.
 *
 * Duplicate detection runs across every agent, since the case worth catching
 * is two agents unknowingly working the same person. Findings are only
 * recorded — merging or reassigning is a human decision, and an Agent is never
 * told a match exists, because that would turn the warning into a way to
 * discover another agent's customers. */
export async function tagRegularCustomerAction(orderId: string) {
  const { user, db } = await requireUserLite();
  // Same grant as the Add Regular Customer button: both create a regular
  // customer, they only differ in whether a lead already exists.
  if (!can(user.role, "regular_customers", "create", db.role_permissions)) {
    redirect(`/leads?error=${encodeURIComponent("You do not have permission to add regular customers.")}`);
  }

  const order = await loadOrderInto(db, orderId);
  if (!order) redirect(`/leads?error=${encodeURIComponent("Lead not found.")}`);
  if (!orderInScope(user, order!, db)) {
    redirect(`/leads?error=${encodeURIComponent("You do not have access to that lead.")}`);
  }
  if (!order!.customer_phone.trim()) {
    redirect(`/leads?error=${encodeURIComponent("A phone number is required before tagging a Regular Customer.")}`);
  }

  const customer = await upsertRegularCustomer(order!, order!.agent_id);
  const now = new Date().toISOString();

  // Flag every order for this customer, so the whole history moves together
  // rather than leaving earlier orders behind in the Leads list.
  let moved = 0;
  for (const o of adoptOrders(db, await orderRowsForPhoneAndAgent(order!.customer_phone, order!.agent_id))) {
    o.is_regular_customer = true;
    o.regular_customer_since = o.regular_customer_since || now;
    o.customer_id = customer.id;
    markOrderDirty(db, o.id);
    moved++;
  }

  const findings = await findDuplicates({
    id: customer.id,
    full_name: customer.full_name,
    phone_normalized: customer.phone_normalized,
    purok: customer.purok,
    barangay: customer.barangay,
    city: customer.city,
    province: customer.province,
  });
  await recordDuplicates(customer.id, findings);

  await supabaseAdmin.from("customers").update({ total_orders: moved }).eq("id", customer.id);

  const info = await getRequestInfo();
  logActivity(db, user.id, "REGULAR_CUSTOMER_TAGGED", "customer", customer.id, {
    customer_name: customer.full_name,
    orders_moved: moved,
    potential_duplicates: findings.length,
  }, { module: "regular_customers", ...info });
  await writeDb(db);

  redirect(`${PATH}?tagged=1`);
}

/** Returns a customer to the active Leads list. */
export async function untagRegularCustomerAction(customerId: string) {
  const { user, db } = await requireUserLite();
  if (!can(user.role, "regular_customers", "manage", db.role_permissions)) {
    redirect(`${PATH}?error=${encodeURIComponent("You do not have permission to do that.")}`);
  }

  const { data: customer } = await supabaseAdmin.from("customers").select("*").eq("id", customerId).maybeSingle();
  if (!customer) redirect(`${PATH}?error=${encodeURIComponent("Customer not found.")}`);

  await supabaseAdmin.from("customers").update({ is_regular_customer: false, updated_at: new Date().toISOString() }).eq("id", customerId);
  for (const o of adoptOrders(db, await orderRowsForCustomer(customerId))) {
    o.is_regular_customer = false;
    o.regular_customer_since = null;
    markOrderDirty(db, o.id);
  }

  const info = await getRequestInfo();
  logActivity(db, user.id, "REGULAR_CUSTOMER_UNTAGGED", "customer", customerId, {
    customer_name: customer.full_name,
  }, { module: "regular_customers", ...info });
  await writeDb(db);

  redirect(`${PATH}?untagged=1`);
}

/** Records a decision on a potential duplicate. Nothing merges automatically;
 * this is the human judgement the detector deliberately defers to. */
export async function reviewDuplicateAction(matchId: string, decision: DuplicateStatus) {
  const { user, db } = await requireUserLite();
  // Deciding on duplicates is a Management/Team Lead action — the same reason
  // Agents never see the warning at all.
  if (!isFullAccess(user.role) && !can(user.role, "regular_customers", "manage", db.role_permissions)) {
    redirect(`${PATH}/duplicates?error=${encodeURIComponent("You do not have permission to review duplicates.")}`);
  }

  const { data: before } = await supabaseAdmin
    .from("customer_duplicate_matches")
    .select("*")
    .eq("id", matchId)
    .maybeSingle();

  const { error } = await supabaseAdmin
    .from("customer_duplicate_matches")
    .update({ status: decision, reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq("id", matchId);
  if (error) {
    redirect(`${PATH}/duplicates?error=${encodeURIComponent(error.message)}`);
  }

  const info = await getRequestInfo();
  logActivity(db, user.id, "DUPLICATE_REVIEWED", "customer", before?.customer_id ?? null, {
    match_id: matchId,
    decision,
  }, {
    module: "regular_customers",
    previous_value: before ? { status: before.status } : null,
    updated_value: { status: decision },
    ...info,
  });
  await writeDb(db);

  redirect(`${PATH}/duplicates?reviewed=1`);
}
