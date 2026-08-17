"use server";

import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { writeDb, markOrderDirty, loadOrderInto, adoptOrders } from "@/lib/db";
import { orderRowsForPhoneAndAgent, orderRowsForCustomer } from "@/lib/orders-lookup";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { orderInScope } from "@/lib/order-access";
import { verifyPassword } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import {
  createRegularCustomer,
  findDuplicates,
  findRegularCustomerByPhone,
  regularCustomersOnPhoneElsewhere,
  recordDuplicates,
  upsertRegularCustomer,
} from "@/lib/customers";
import { allowedAssigneeIds } from "@/lib/order-access";
import { regularCustomerFormSchema } from "@/lib/validation";
import { describeParseFailure } from "@/lib/zod-error";
import { requireUserLite } from "./guards";
import { displayUserName } from "@/lib/types";
import type { DuplicateStatus } from "@/lib/types";

const PATH = "/regular-customers";
const NEW_PATH = "/regular-customers/new";

export interface ExistingRegularOwner {
  /** Null for an Agent — see the note on the action below. */
  customerName: string | null;
  agentName: string | null;
  regularSince: string | null;
}

export interface RegularDuplicateCheck {
  count: number;
  /** Empty for an Agent: they are told the number is taken, not by whom. */
  owners: ExistingRegularOwner[];
}

/**
 * Who else already keeps this number as a regular customer.
 *
 * Asked by the form before it saves, so the agent is told rather than finding
 * out later — or not at all. Two agents working the same household is the sort
 * of thing that surfaces in a complaint rather than in the system.
 *
 * It answers a question and refuses nothing. Whether a customer should move
 * between agents is a floor decision with a conversation in it, and a form is
 * the wrong place to settle it.
 *
 * WHO IS TOLD WHAT is the careful part, and it follows the rule
 * tagRegularCustomerAction already set: an Agent is never shown another agent's
 * customer. Naming them here would turn this into a lookup — type any number,
 * learn whose customer it is — which is exactly what that rule exists to
 * prevent, and a form that answers on keystroke is a faster way to abuse it
 * than the tagging path ever was.
 *
 * So an Agent is told the number is already held, and nothing else. A Team Lead
 * or Administrator sees the names, because they can already see across agents
 * everywhere else in the app and the warning is useless to them otherwise.
 */
export async function regularCustomerOwnersElsewhereAction(
  phone: string,
  agentId?: string
): Promise<RegularDuplicateCheck> {
  const { user, db } = await requireUserLite();
  if (!can(user.role, "regular_customers", "create", db.role_permissions)) return { count: 0, owners: [] };

  const allowed = allowedAssigneeIds(user, db);
  const ownerAgentId = agentId && allowed.includes(agentId) ? agentId : user.id;

  const others = await regularCustomersOnPhoneElsewhere(phone, ownerAgentId);
  if (others.length === 0) return { count: 0, owners: [] };

  const maySeeNames = isFullAccess(user.role) || user.role === "team_lead";
  if (!maySeeNames) return { count: others.length, owners: [] };

  const nameById = new Map(db.profiles.map((p) => [p.id, displayUserName(p)]));
  return {
    count: others.length,
    owners: others.map((c) => ({
      customerName: c.full_name,
      agentName: c.owner_agent_id ? nameById.get(c.owner_agent_id) || "another agent" : "another agent",
      regularSince: c.regular_since || null,
    })),
  };
}

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

/**
 * Removes a regular customer's record outright.
 *
 * Not the same thing as "Return to Leads", which is the reversible one: that
 * clears the flag and leaves the person on file. This deletes the row, and the
 * duplicate-match records that point at it, and there is no undo.
 *
 * What it does NOT delete is the orders. Business transactions are never
 * deleted in this system — an order is what was sold, to whom, by which agent,
 * and removing it would silently change sales figures and agent counts for a
 * period already reported on. The orders are released instead: their link to
 * the customer is cut and they go back to being ordinary leads, exactly as
 * Return to Leads leaves them.
 *
 * Administrator only, and gated the same way an account deletion is: the typed
 * word, the password, a reason, and a final tick. Four steps for a row that
 * cannot be brought back.
 */
export async function permanentlyDeleteRegularCustomerAction(customerId: string, formData: FormData) {
  const { user, db } = await requireUserLite();
  const back = (message: string) =>
    redirect(`${PATH}/${customerId}/delete?error=${encodeURIComponent(message)}`);

  if (!isFullAccess(user.role)) {
    redirect(`${PATH}?error=${encodeURIComponent("Administrator access is required to delete a customer.")}`);
  }

  const { data: customer } = await supabaseAdmin.from("customers").select("*").eq("id", customerId).maybeSingle();
  if (!customer) redirect(`${PATH}?error=${encodeURIComponent("That customer no longer exists.")}`);

  if (String(formData.get("confirm_text") || "").trim() !== "DELETE") back("Type DELETE exactly to confirm.");

  const reason = String(formData.get("reason") || "").trim();
  if (reason.length < 5) back("Give a reason for this deletion (at least 5 characters).");

  if (formData.get("final_confirm") !== "on") back("Tick the final confirmation to proceed.");

  // Re-authenticate. Compared against the stored hash; never stored, logged or
  // echoed back.
  const password = String(formData.get("admin_password") || "");
  if (!password) back("Enter your password to confirm this deletion.");
  const self = db.profiles.find((p) => p.id === user.id)!;
  if (!verifyPassword(password, self.password_hash)) back("That password is incorrect.");

  // The orders first: cut loose while the customer row still exists, so a
  // failure here leaves a customer with orders rather than orders pointing at
  // a customer that is gone.
  const released = adoptOrders(db, await orderRowsForCustomer(customerId));
  for (const o of released) {
    o.customer_id = null;
    o.is_regular_customer = false;
    o.regular_customer_since = null;
    markOrderDirty(db, o.id);
  }

  // …and written NOW, not at the writeDb below.
  //
  // orders.customer_id carries a foreign key to this row. The loop above only
  // changes the in-memory copy, which does not reach the database until writeDb
  // — and writeDb runs after the delete, so the delete met orders still pointing
  // here and Postgres refused it: "violates foreign key constraint
  // orders_customer_id_fkey". The customer was undeletable for as long as they
  // had ever had an order.
  //
  // Keyed on customer_id rather than on the ids above, because that column is
  // exactly the set the constraint is about: orderRowsForCustomer also matches
  // on phone, and those rows carry the flags but not the reference.
  const { error: releaseError } = await supabaseAdmin
    .from("orders")
    .update({ customer_id: null, is_regular_customer: false, regular_customer_since: null })
    .eq("customer_id", customerId);
  if (releaseError) back(`Could not release this customer's orders: ${releaseError.message}`);

  // Duplicate matches name this customer on either side of the pair, and a match
  // with a missing half renders as a blank row on the Duplicates page. Both of
  // those foreign keys are ON DELETE CASCADE, so this is not what makes the
  // delete succeed — it is done here so the intent is on the page rather than
  // resting on a constraint nobody reading this file can see.
  await supabaseAdmin.from("customer_duplicate_matches").delete().eq("customer_id", customerId);
  await supabaseAdmin.from("customer_duplicate_matches").delete().eq("matched_customer_id", customerId);

  const { error: deleteError } = await supabaseAdmin.from("customers").delete().eq("id", customerId);
  if (deleteError) back(`Could not delete this customer: ${deleteError.message}`);

  // Logged with everything the row held: once the row is gone, this entry is
  // the only remaining record that the person was ever on file.
  const info = await getRequestInfo();
  logActivity(db, user.id, "REGULAR_CUSTOMER_DELETED", "customer", customerId, {
    customer_name: customer.full_name,
    phone: customer.phone_raw,
    owner_agent_id: customer.owner_agent_id,
    orders_released: released.length,
    reason,
  }, { module: "regular_customers", ...info });
  await writeDb(db);

  redirect(`${PATH}?deleted=${encodeURIComponent(customer.full_name)}`);
}
