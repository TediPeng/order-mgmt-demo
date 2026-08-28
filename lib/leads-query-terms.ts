import { normalizePhone } from "@/lib/utils";

/**
 * Splitting the Leads search box, and the two ceilings on what it may look for.
 *
 * Its own module because both sides need it: the query builder enforces these
 * and the box has to say when one has been hit. Importing them from
 * leads-query.ts would pull supabaseAdmin — and the service-role key — into the
 * client bundle.
 */

/** How many things one Leads search may look for at once.
 *
 * Each term becomes four or five OR conditions inside a single PostgREST query
 * string, so the ceiling here is the length of a URL rather than anything about
 * the data. Measured against this project: fifty terms is a 9KB URL, three
 * hundred is 55KB and still answered, four hundred is 74KB and comes back 414.
 *
 * Fifty keeps a wide margin, and a list longer than this is almost always a
 * column of phone numbers — which has its own way through, below.
 */
export const MAX_SEARCH_TERMS = 50;

/** How many phone numbers one pasted list may look for at once.
 *
 * A list of complete numbers does not need the OR-across-every-column shape at
 * all: it is matched on the phone key in the database, with the numbers sent in
 * the request body where length stops mattering. What comes back is a list of
 * ids, and THAT goes into a URL — so this is sized by the ids, not the numbers.
 * Five hundred matches is about 21KB, well inside the 55KB that answers.
 */
export const MAX_PHONE_TERMS = 500;

/** PostgREST's or() takes a comma-separated list, so a term containing a comma
 * or a parenthesis would be read as more conditions. Those characters never
 * carry meaning in a name or a reference, so they are dropped rather than
 * escaped. */
export function safeTerm(value: string): string {
  return value.replace(/[(),*]/g, " ").trim();
}

/**
 * The search box, split into the separate things being looked for.
 *
 * Split on commas, semicolons and line breaks — never on spaces. A column
 * copied out of Excel arrives one item per line and a hand-typed list arrives
 * comma-separated, so both have to work. But "Jesslyn Del Castillo" is one
 * customer, not three terms: splitting on spaces would turn a name into an OR
 * matching every Del and every Castillo in the table, and the search would get
 * less useful the more precisely you typed.
 *
 * Uncapped. The caller decides which ceiling applies, because that depends on
 * what the terms turn out to be.
 */
export function splitTerms(value: string | undefined | null): string[] {
  const parts = (value || "")
    .split(/[,;\r\n]+/)
    .map((t) => safeTerm(t))
    .filter(Boolean);
  // Deduplicated: pasting the same id twice must not double the conditions.
  return Array.from(new Set(parts));
}

/**
 * A complete PH mobile number, as opposed to a fragment of one.
 *
 * normalizePhone strips the trunk prefix and the country code, so 09171234567,
 * +639171234567 and 9171234567 all arrive here as the same ten digits starting
 * with 9 — which is what lead_phone_key() produces in SQL, and what the phone
 * key index is built on.
 *
 * Deliberately strict about being COMPLETE. "0917" normalises to 917 and is a
 * fragment: somebody typing that wants a substring search across every column,
 * which is what the ordinary path does. Matching it as a key would find
 * nothing and look like the lead had vanished.
 */
function phoneKeyOf(term: string): string | null {
  const key = normalizePhone(term);
  return /^9\d{9}$/.test(key) ? key : null;
}

/**
 * The phone keys for a list of terms — but only if EVERY term is one.
 *
 * Null the moment something is not a complete number, because a mixed list is
 * a question the phone-key path cannot answer: it would silently drop the order
 * number or the customer name pasted in among the phones. Mixed lists take the
 * ordinary route and its lower ceiling.
 */
export function phoneListKeys(terms: string[]): string[] | null {
  if (!terms.length) return null;
  const keys: string[] = [];
  for (const term of terms) {
    const key = phoneKeyOf(term);
    if (!key) return null;
    keys.push(key);
  }
  return Array.from(new Set(keys));
}

/** What this particular search is allowed to look for — the higher ceiling
 * applies only to a list that is all phone numbers. */
export function limitFor(terms: string[]): number {
  return phoneListKeys(terms) ? MAX_PHONE_TERMS : MAX_SEARCH_TERMS;
}
