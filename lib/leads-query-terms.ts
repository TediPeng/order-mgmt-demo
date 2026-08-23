/** How many things one Leads search may look for at once.
 *
 * Its own module because both sides need it: the query builder enforces it and
 * the search box has to say when it has been hit. Importing it from
 * leads-query.ts would pull supabaseAdmin — and the service-role key — into
 * the client bundle.
 *
 * Each term becomes four or five OR conditions inside a single PostgREST query
 * string, so a pasted column of five hundred ids would build a URL longer than
 * any server accepts, and the failure would arrive as a blank list rather than
 * as an explanation. Fifty is well inside the limit and well past what anybody
 * pastes by hand.
 */
export const MAX_SEARCH_TERMS = 50;
