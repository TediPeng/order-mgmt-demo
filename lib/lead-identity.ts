import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizePhone } from "@/lib/utils";

/**
 * The same person arriving on a second number.
 *
 * The upload compares phone numbers, so a duplicate carrying a different number
 * walks straight in. Measured over the live leads, 422 name-and-address groups
 * hold more than one number — and the numbers tell you what kind of collision
 * each one is:
 *
 *   144  are within two digits of each other. That is one number, mistyped.
 *   198  are different numbers at an exact house or lot address. Nobody shares
 *        a name AND "Block 28 lot 2 phase 1 south square village" by accident.
 *    80  are different numbers where the address is only a barangay and a city.
 *        In the Philippines that is a real possibility of two different people,
 *        so those are let through.
 *
 * The asymmetry matters: an imported row is visible in the list, a refused one
 * is a line in a summary nobody reads twice. Wrongly letting a duplicate in
 * costs a duplicate; wrongly refusing costs a lead the floor never learns it
 * lost. So the doubtful third is admitted on purpose.
 */

/** Mirrors nameKey() in lib/actions/regular-customers.ts and lead_identity_key() in SQL. */
function normKey(value: string): string {
  return (value || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

export interface IdentityFields {
  customer_name?: unknown;
  purok?: unknown;
  barangay?: unknown;
  city?: unknown;
  province?: unknown;
}

/** The key a row collides on, or null when it has no name or no address to
 * collide with — those can never be judged and are never refused. */
export function identityKey(row: IdentityFields): string | null {
  const name = normKey(String(row.customer_name ?? ""));
  const address = normKey(
    [row.purok, row.barangay, row.city, row.province].filter(Boolean).map(String).join(" ")
  );
  if (!name || !address) return null;
  return `${name}|${address}`;
}

/** An address carrying a house, block or lot number is specific enough that a
 * name match on top of it is a person, not a coincidence. */
export function addressIsSpecific(purok: unknown): boolean {
  return /[0-9]/.test(String(purok ?? ""));
}

/**
 * Edit distance, capped — only "are these two numbers nearly the same" is being
 * asked, so anything past the cap is simply "no".
 */
export function digitsClose(a: string, b: string, max = 2): boolean {
  const x = normalizePhone(a);
  const y = normalizePhone(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.abs(x.length - y.length) > max) return false;
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
    if (Math.min(...cur) > max) return false;
  }
  return prev[y.length] <= max;
}

export interface IdentityMatch {
  order_number: string;
  customer_phone: string;
  purok: string;
}

/**
 * Existing leads sharing a name and address with any row in this batch.
 *
 * One round trip for the whole batch, over an index on the same key — the
 * phone-based lookup beside it exists because reading every order per import is
 * what used to time the function out, and this must not undo that.
 */
export async function leadsByIdentity(rows: IdentityFields[]): Promise<Map<string, IdentityMatch[]>> {
  const keys = Array.from(new Set(rows.map(identityKey).filter((k): k is string => Boolean(k))));
  const out = new Map<string, IdentityMatch[]>();
  if (keys.length === 0) return out;

  const CHUNK = 500;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const { data, error } = await supabaseAdmin.rpc("leads_by_identity", { p_keys: keys.slice(i, i + CHUNK) });
    if (error) throw new Error(`leads_by_identity failed: ${error.message}`);
    for (const r of (data || []) as Record<string, unknown>[]) {
      const key = String(r.identity_key ?? "");
      if (!key) continue;
      const bucket = out.get(key);
      const match: IdentityMatch = {
        order_number: String(r.order_number ?? ""),
        customer_phone: String(r.customer_phone ?? ""),
        purok: String(r.purok ?? ""),
      };
      if (bucket) bucket.push(match);
      else out.set(key, [match]);
    }
  }
  return out;
}

/**
 * Why this row is the same person as an existing lead, or null to let it in.
 *
 * Only the two confident cases refuse. A different number at a vague address is
 * deliberately admitted — see the note at the top of this file.
 */
export function identityBlockReason(row: IdentityFields & { customer_phone?: unknown }, matches: IdentityMatch[]): string | null {
  const phone = String(row.customer_phone ?? "");
  for (const m of matches) {
    if (digitsClose(phone, m.customer_phone)) {
      return `Same name and address as ${m.order_number}, on a number one or two digits away — this looks like the same person mistyped`;
    }
  }
  if (addressIsSpecific(row.purok)) {
    const at = matches.find((m) => addressIsSpecific(m.purok)) ?? matches[0];
    return `Same name and exact address as ${at.order_number}, on a different number`;
  }
  const specific = matches.find((m) => addressIsSpecific(m.purok));
  if (specific) {
    return `Same name and exact address as ${specific.order_number}, on a different number`;
  }
  return null;
}
