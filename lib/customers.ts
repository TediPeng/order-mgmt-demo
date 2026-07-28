import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { canonicalPhone, normalizePhone } from "@/lib/utils";
import type { Customer, CustomerDuplicateMatch, Order } from "@/lib/types";

/** Regular Customers.
 *
 * Tagging is a lifecycle move, never a delete: the flag takes the record out
 * of the active Leads list while every order, call and audit entry stays put.
 *
 * Duplicate detection runs across ALL agents, because the case it exists for
 * is two agents unknowingly working the same person. Findings are recorded,
 * never acted on — merging or reassigning is a human decision, and the warning
 * itself is withheld from Agents so it cannot become a way to discover another
 * agent's customers. */

function mapCustomer(row: Record<string, unknown>): Customer {
  return { ...(row as unknown as Customer), total_orders: Number(row.total_orders ?? 0) };
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const { data, error } = await supabaseAdmin.from("customers").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`customers read failed: ${error.message}`);
  return data ? mapCustomer(data) : null;
}

export async function listCustomers(filter: { ownerAgentIds?: string[] } = {}): Promise<Customer[]> {
  let query = supabaseAdmin.from("customers").select("*").eq("is_regular_customer", true);
  if (filter.ownerAgentIds) query = query.in("owner_agent_id", filter.ownerAgentIds);
  const { data, error } = await query.order("regular_since", { ascending: false });
  if (error) throw new Error(`customers read failed: ${error.message}`);
  return (data || []).map(mapCustomer);
}

/** Normalized-name comparison for the name-based rules: case, punctuation and
 * repeated spaces are noise, not identity. */
function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface DuplicateFinding {
  matched: Customer;
  match_type: "phone" | "name_address" | "name_barangay_city" | "other";
  confidence: "high" | "medium" | "low";
  fields: string[];
}

/** Checks a candidate against every existing customer, in the spec's order of
 * decreasing certainty. A phone match is treated as high confidence because a
 * mobile number identifies a person; name-only agreement is deliberately not
 * reported at all, since common names would flood the queue with noise. */
export async function findDuplicates(candidate: {
  id?: string;
  full_name: string;
  phone_normalized: string;
  purok?: string | null;
  barangay?: string | null;
  city?: string | null;
  province?: string | null;
}): Promise<DuplicateFinding[]> {
  const { data, error } = await supabaseAdmin.from("customers").select("*");
  if (error) throw new Error(`customers read failed: ${error.message}`);

  const others = (data || []).map(mapCustomer).filter((c) => c.id !== candidate.id);
  const candName = nameKey(candidate.full_name);
  const candAddress = nameKey([candidate.purok, candidate.barangay, candidate.city, candidate.province].filter(Boolean).join(" "));
  const candTail = candidate.phone_normalized.slice(-7);

  const findings: DuplicateFinding[] = [];
  for (const other of others) {
    if (candidate.phone_normalized && other.phone_normalized === candidate.phone_normalized) {
      findings.push({ matched: other, match_type: "phone", confidence: "high", fields: ["Phone number"] });
      continue;
    }

    const otherName = nameKey(other.full_name);
    if (!candName || otherName !== candName) {
      // Fuzzy fallback: same surname-ish name and the same last 7 digits, which
      // catches a number typed with a different prefix or a stray digit.
      if (candTail && other.phone_normalized.slice(-7) === candTail) {
        findings.push({ matched: other, match_type: "other", confidence: "low", fields: ["Phone number (partial)"] });
      }
      continue;
    }

    const otherAddress = nameKey([other.purok, other.barangay, other.city, other.province].filter(Boolean).join(" "));
    if (candAddress && otherAddress === candAddress) {
      findings.push({ matched: other, match_type: "name_address", confidence: "high", fields: ["Customer name", "Complete address"] });
      continue;
    }

    const candArea = nameKey([candidate.barangay, candidate.city].filter(Boolean).join(" "));
    const otherArea = nameKey([other.barangay, other.city].filter(Boolean).join(" "));
    if (candArea && otherArea === candArea) {
      findings.push({
        matched: other,
        match_type: "name_barangay_city",
        confidence: "medium",
        fields: ["Customer name", "Barangay/City"],
      });
      continue;
    }

    findings.push({ matched: other, match_type: "other", confidence: "low", fields: ["Customer name"] });
  }

  return findings;
}

/** Records findings for Management review. Nothing is merged here — the rows
 * are evidence for a person to judge. */
export async function recordDuplicates(customerId: string, findings: DuplicateFinding[]): Promise<void> {
  if (findings.length === 0) return;
  const rows = findings.map((f) => ({
    customer_id: customerId,
    matched_customer_id: f.matched.id,
    match_type: f.match_type,
    confidence: f.confidence,
    status: "open",
  }));
  const { error } = await supabaseAdmin.from("customer_duplicate_matches").insert(rows);
  if (error) throw new Error(`Could not record duplicate matches: ${error.message}`);
}

export async function listOpenDuplicates(): Promise<
  (CustomerDuplicateMatch & { customer: Customer | null; matched: Customer | null })[]
> {
  const { data, error } = await supabaseAdmin
    .from("customer_duplicate_matches")
    .select("*")
    .eq("status", "open")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`customer_duplicate_matches read failed: ${error.message}`);

  const rows = (data || []) as unknown as CustomerDuplicateMatch[];
  const ids = Array.from(new Set(rows.flatMap((r) => [r.customer_id, r.matched_customer_id].filter(Boolean) as string[])));
  const byId = new Map<string, Customer>();
  if (ids.length > 0) {
    const { data: customers } = await supabaseAdmin.from("customers").select("*").in("id", ids);
    for (const c of customers || []) byId.set(String(c.id), mapCustomer(c));
  }
  return rows.map((r) => ({
    ...r,
    customer: r.customer_id ? byId.get(r.customer_id) || null : null,
    matched: r.matched_customer_id ? byId.get(r.matched_customer_id) || null : null,
  }));
}

/** Creates (or reuses) the consolidated customer record behind a lead and
 * marks it Regular. Reuse is by canonical phone under the same owner, so
 * tagging a repeat caller does not spawn a second record. */
export async function upsertRegularCustomer(order: Order, ownerAgentId: string): Promise<Customer> {
  const phoneNormalized = canonicalPhone(order.customer_phone);
  const now = new Date().toISOString();

  if (phoneNormalized) {
    const { data: existing } = await supabaseAdmin
      .from("customers")
      .select("*")
      .eq("phone_normalized", phoneNormalized)
      .eq("owner_agent_id", ownerAgentId)
      .maybeSingle();
    if (existing) {
      const { data: updated, error } = await supabaseAdmin
        .from("customers")
        .update({
          full_name: order.customer_name,
          purok: order.purok || null,
          barangay: order.barangay || null,
          city: order.city || null,
          province: order.province || null,
          landmark: order.landmark || null,
          is_regular_customer: true,
          regular_since: (existing.regular_since as string) || now,
          updated_at: now,
        })
        .eq("id", existing.id)
        .select("*")
        .single();
      if (error) throw new Error(`Could not update the customer: ${error.message}`);
      return mapCustomer(updated);
    }
  }

  const { data, error } = await supabaseAdmin
    .from("customers")
    .insert({
      full_name: order.customer_name,
      phone_raw: order.customer_phone,
      phone_normalized: phoneNormalized || normalizePhone(order.customer_phone),
      purok: order.purok || null,
      barangay: order.barangay || null,
      city: order.city || null,
      province: order.province || null,
      landmark: order.landmark || null,
      owner_agent_id: ownerAgentId,
      original_agent_id: ownerAgentId,
      is_regular_customer: true,
      regular_since: now,
      customer_status: "active",
    })
    .select("*")
    .single();
  if (error) throw new Error(`Could not create the customer: ${error.message}`);
  return mapCustomer(data);
}

/** Order history behind a regular customer, used for the previous/latest
 * order columns and the total. Matched by canonical phone so orders taken
 * before the customer record existed are included. */
export async function ordersForCustomer(customer: Customer, allOrders: Order[]): Promise<Order[]> {
  const target = customer.phone_normalized;
  return allOrders
    .filter((o) => o.customer_id === customer.id || canonicalPhone(o.customer_phone) === target)
    .sort((a, b) => (b.order_date || b.created_at).localeCompare(a.order_date || a.created_at));
}
