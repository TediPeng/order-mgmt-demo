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
  allCustomers,
  createRegularCustomer,
  findDuplicates,
  findRegularCustomerByPhone,
  regularCustomersOnPhoneElsewhere,
  recordDuplicates,
  replaceCustomerShares,
  shareTargetsFor,
  upsertRegularCustomer,
} from "@/lib/customers";
import { canonicalPhone, restoreTrunkZero } from "@/lib/utils";
import { allowedAssigneeIds } from "@/lib/order-access";
import { regularCustomerFormSchema } from "@/lib/validation";
import { describeParseFailure } from "@/lib/zod-error";
import { requireUserLite } from "./guards";
import { displayUserName } from "@/lib/types";
import type { Customer, DuplicateStatus, Profile } from "@/lib/types";

const PATH = "/regular-customers";
const NEW_PATH = "/regular-customers/new";

/**
 * Why this number may not be filed as this agent's regular customer, or null.
 *
 * One number, one owner. The Add form has warned for a while that a number is
 * already held somewhere else, but a warning is not a rule: both records got
 * made anyway, and the collision surfaced weeks later on somebody's Save, in
 * the duplicate dialog, after two agents had each worked the person.
 *
 * Applied to every way in — the form, the spreadsheet, and tagging a lead —
 * because a guard on one of the three is not a guard: the other two write the
 * same row.
 *
 * The reason names the owner only for a role that can already see across
 * agents. An Agent is told the number is taken and to raise it with their Team
 * Lead, and nothing more: naming the owner here would turn this into a lookup —
 * type any number, learn whose customer it is — which is precisely what
 * regularCustomerOwnersElsewhereAction above is written to avoid.
 */
async function foreignRegularOwnerReason(
  actor: Profile,
  profiles: Profile[],
  phone: string,
  ownerAgentId: string,
  /** A batch's already-loaded customer list, so an import does not make a round
   * trip per row. Omitted, the question goes to the database. */
  existing?: Customer[]
): Promise<string | null> {
  const key = canonicalPhone(phone);
  if (!key) return null;

  const others = existing
    ? existing.filter((c) => c.is_regular_customer && c.phone_normalized === key && c.owner_agent_id !== ownerAgentId)
    : await regularCustomersOnPhoneElsewhere(phone, ownerAgentId);
  if (others.length === 0) return null;

  if (isFullAccess(actor.role) || actor.role === "team_lead") {
    const owner = profiles.find((p) => p.id === others[0].owner_agent_id);
    return (
      `${others[0].full_name} is already ${owner ? displayUserName(owner) : "another agent"}'s regular customer ` +
      `on that number. Share or reassign that record rather than creating a second one.`
    );
  }
  return "That number is already another agent's regular customer. Please contact your Team Lead for this concern.";
}

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

  // And one per person across the floor — the warning this form already shows
  // on the number, made into the rule it was always describing.
  const foreign = await foreignRegularOwnerReason(user, db.profiles, data.phone, ownerAgentId);
  if (foreign) redirect(`${NEW_PATH}?error=${encodeURIComponent(foreign)}`);

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

  // The assigned agent is who the record would be filed under, so they are who
  // the number has to be free for — not whoever is pressing the button.
  const foreign = await foreignRegularOwnerReason(user, db.profiles, order!.customer_phone, order!.agent_id);
  if (foreign) redirect(`/leads?error=${encodeURIComponent(foreign)}`);

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

/** One row of a regular-customer upload, as the client parsed it. */
export interface RegularCustomerImportRow {
  /** 1-based row number in the sheet, so a rejection can name the line. */
  row: number;
  data: Record<string, unknown>;
}

export type RegularCustomerImportCategory = "imported" | "duplicate" | "missing_info" | "invalid";

export interface RegularCustomerImportResult {
  row: number;
  category: RegularCustomerImportCategory;
  reason: string;
  data: Record<string, unknown>;
}

export interface RegularCustomerImportSummary {
  total: number;
  imported: number;
  duplicates: number;
  missingInfo: number;
  invalid: number;
  /** Leads that moved out of the active list onto a customer record. */
  ordersMoved: number;
  results: RegularCustomerImportResult[];
}

/**
 * Bulk-adds regular customers from an uploaded sheet.
 *
 * The owner is always the uploader. A regular customer is that person's own
 * repeat buyer — `owner_agent_id` is what every scoping rule on the module keys
 * off — so there is no Agent column to get wrong and no way to fill somebody
 * else's list from a spreadsheet. Status is not a column either: an imported
 * customer is active.
 *
 * Ends where the single-record path ends, deliberately. `createRegularCustomer`
 * writes the row, the uploader's existing orders on that number are adopted
 * onto it (which takes them out of the active Leads list, exactly as Add
 * Regular Customer does), and the duplicate scan is recorded. Two ways in, one
 * end state.
 *
 * Called a batch at a time by the client. The whole-table reads that the
 * single-record path can afford once — the customer list for the duplicate
 * check — are done ONCE per batch here and reused, since at five hundred rows
 * they would otherwise be five hundred full reads of the customers table.
 */
export async function importRegularCustomersAction(
  rows: RegularCustomerImportRow[],
  fileName: string
): Promise<RegularCustomerImportSummary> {
  const { user, db } = await requireUserLite();
  if (!can(user.role, "regular_customers", "create", db.role_permissions)) {
    throw new Error("You do not have permission to add regular customers.");
  }

  const ownerAgentId = user.id;
  const summary: RegularCustomerImportSummary = {
    total: rows.length,
    imported: 0,
    duplicates: 0,
    missingInfo: 0,
    invalid: 0,
    ordersMoved: 0,
    results: [],
  };

  // Read once, compared against for every row, and kept up to date as rows are
  // created so that two identical numbers inside the same file cannot both be
  // written.
  const existingCustomers = await allCustomers();
  // Keyed the way `phone_normalized` is actually stored — canonicalPhone, so
  // "+639171234567". This was normalizePhone ("9171234567"), which is a
  // different string and therefore matched nothing: the check read as a
  // duplicate guard and was never once true, and the summary's duplicate count
  // was always zero however many collisions the file held.
  const takenByUploader = new Set(
    existingCustomers.filter((c) => c.owner_agent_id === ownerAgentId).map((c) => c.phone_normalized)
  );

  for (const { row, data } of rows) {
    const fullName = String(data.full_name ?? "").trim();
    // Excel stores 09175550101 as a number and drops the trunk zero before the
    // file ever reaches us. normalizePhone would still match it, but phone_raw
    // is what the agent reads off the customer's row and dials, so it is put
    // back — the same thing the lead import does.
    const phoneRaw = restoreTrunkZero(String(data.phone ?? "").trim());
    const reject = (category: RegularCustomerImportCategory, reason: string) => {
      summary.results.push({ row, category, reason, data });
      if (category === "duplicate") summary.duplicates += 1;
      else if (category === "missing_info") summary.missingInfo += 1;
      else summary.invalid += 1;
    };

    if (!fullName || !phoneRaw) {
      reject("missing_info", !fullName && !phoneRaw ? "Customer Name and Phone Number are both blank." : !fullName ? "Customer Name is blank." : "Phone Number is blank.");
      continue;
    }

    const phoneKey = canonicalPhone(phoneRaw);
    if (!phoneKey) {
      reject("invalid", `"${phoneRaw}" has no digits in it.`);
      continue;
    }
    if (takenByUploader.has(phoneKey)) {
      reject("duplicate", `You already keep a regular customer on ${phoneRaw}.`);
      continue;
    }
    // Compared against the batch's own list rather than the database, so a
    // five-hundred-row file stays one read instead of five hundred.
    const foreign = await foreignRegularOwnerReason(user, db.profiles, phoneRaw, ownerAgentId, existingCustomers);
    if (foreign) {
      reject("duplicate", foreign);
      continue;
    }

    try {
      const customer = await createRegularCustomer(
        {
          full_name: fullName,
          phone: phoneRaw,
          purok: String(data.purok ?? "").trim(),
          barangay: String(data.barangay ?? "").trim(),
          city: String(data.city ?? "").trim(),
          province: String(data.province ?? "").trim(),
          landmark: String(data.landmark ?? "").trim(),
          pancake_province_id: "",
          pancake_district_id: "",
          pancake_commune_id: "",
          customer_status: "active",
        },
        ownerAgentId
      );

      // Same move the manual path makes: orders this agent already holds on the
      // number belong to the customer record now, and therefore leave the
      // active Leads list.
      let moved = 0;
      for (const o of adoptOrders(db, await orderRowsForPhoneAndAgent(phoneRaw, ownerAgentId))) {
        o.is_regular_customer = true;
        o.regular_customer_since = o.regular_customer_since || customer.regular_since;
        o.customer_id = customer.id;
        markOrderDirty(db, o.id);
        moved++;
      }
      if (moved > 0) await supabaseAdmin.from("customers").update({ total_orders: moved }).eq("id", customer.id);
      summary.ordersMoved += moved;

      const findings = await findDuplicates(
        {
          id: customer.id,
          full_name: customer.full_name,
          phone_normalized: customer.phone_normalized,
          purok: customer.purok,
          barangay: customer.barangay,
          city: customer.city,
          province: customer.province,
        },
        existingCustomers
      );
      await recordDuplicates(customer.id, findings);

      // Kept in step so a later row in the same file matches against it.
      existingCustomers.push(customer);
      takenByUploader.add(customer.phone_normalized);

      summary.imported += 1;
      summary.results.push({ row, category: "imported", reason: "", data });
    } catch (e) {
      // One bad row must not take the batch down: the rows before it are
      // already written, and the uploader gets it back in the error report.
      reject("invalid", (e as Error).message);
    }
  }

  const info = await getRequestInfo();
  logActivity(db, user.id, "REGULAR_CUSTOMERS_IMPORTED", "customer", null, {
    file_name: fileName,
    total: summary.total,
    imported: summary.imported,
    duplicates: summary.duplicates,
    missing_info: summary.missingInfo,
    invalid: summary.invalid,
    orders_moved: summary.ordersMoved,
    owner_agent_id: ownerAgentId,
  }, { module: "regular_customers", ...info });
  await writeDb(db);

  return summary;
}

// ── Sharing ─────────────────────────────────────────────────────────────────

/**
 * Sets who a regular customer is shared with.
 *
 * Ownership is untouched. A share is read access plus the ability to work the
 * customer; it never moves owner_agent_id, so one person stays accountable and
 * un-sharing cannot orphan the record.
 */
export async function shareCustomerAction(formData: FormData) {
  const { user, db } = await requireUserLite();
  const customerId = String(formData.get("customer_id") || "");
  const back = (message: string) =>
    redirect(`${PATH}/${customerId}?error=${encodeURIComponent(message)}`);

  if (!can(user.role, "regular_customers", "assign", db.role_permissions)) {
    back("You do not have permission to share regular customers.");
  }

  const { data: row } = await supabaseAdmin
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .maybeSingle();
  if (!row) back("That customer no longer exists.");
  const customer = row as unknown as Customer;

  // Only the owner, or somebody with full access acting on their behalf. A
  // teammate who was shared the customer cannot pass it on further — otherwise
  // one share becomes a chain nobody is watching.
  if (!isFullAccess(user.role) && customer.owner_agent_id !== user.id) {
    back("Only the agent who owns this customer can share it.");
  }

  const owner = db.profiles.find((p) => p.id === customer.owner_agent_id);
  if (!owner) back("This customer's owner account no longer exists.");

  // The submitted list is checked against the owner's team rather than trusted:
  // the picker is a form field, and a form field is a suggestion.
  const allowed = new Set(shareTargetsFor(db, owner!).map((p) => p.id));
  const requested = formData.getAll("agent_ids").map(String).filter(Boolean);
  const rejected = requested.filter((id) => !allowed.has(id));
  if (rejected.length > 0) {
    back("You can only share a customer with the owner's own team.");
  }

  const { added, removed } = await replaceCustomerShares(customerId, requested, user.id);
  if (added.length === 0 && removed.length === 0) {
    redirect(`${PATH}/${customerId}?shared=0`);
  }

  // The number stops being an active lead for the people just added.
  //
  // Without this the one-lead-per-number rule breaks in plain sight: the record
  // is a regular customer for the owner while the same number sits in a
  // teammate's Leads list as an open lead. createRegularCustomer does exactly
  // this for the owner at creation time; a share is the same event for somebody
  // else, so it does the same thing.
  let moved = 0;
  for (const agentId of added) {
    for (const o of adoptOrders(db, await orderRowsForPhoneAndAgent(customer.phone_raw, agentId))) {
      o.is_regular_customer = true;
      o.regular_customer_since = o.regular_customer_since || customer.regular_since;
      o.customer_id = customer.id;
      markOrderDirty(db, o.id);
      moved++;
    }
  }

  const nameById = new Map(db.profiles.map((p) => [p.id, displayUserName(p)]));
  const info = await getRequestInfo();
  logActivity(
    db,
    user.id,
    "REGULAR_CUSTOMER_SHARED",
    "customer",
    customer.id,
    {
      customer_name: customer.full_name,
      owner_agent_id: customer.owner_agent_id,
      // Names as well as ids: an audit entry read a year from now should say who
      // was given access without needing another query to find out.
      added: added.map((id) => ({ id, name: nameById.get(id) || "unknown" })),
      removed: removed.map((id) => ({ id, name: nameById.get(id) || "unknown" })),
      shared_with_total: requested.length,
      orders_moved: moved,
    },
    { module: "regular_customers", ...info }
  );
  await writeDb(db);

  redirect(`${PATH}/${customerId}?shared=1`);
}
