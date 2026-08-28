import { Copy as CopyIcon, Download, ArrowLeftRight } from "lucide-react";
import { readDbLite } from "@/lib/db";
import { latestStatusChangeByOrder } from "@/lib/audit-log";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { listItemsFor } from "@/lib/order-items";
import { canonicalPhone, todayInTz } from "@/lib/utils";
import { BreakControls } from "@/components/BreakControls";
import { BackToCallButton } from "@/components/BackToCallButton";
import { getActiveBioBreak } from "@/lib/bio-breaks";
import { findDuplicates, latestOrderDateByCustomer, sharedCustomerIdsForAgent } from "@/lib/customers";
import { canAssignLeads } from "@/lib/order-access";
import { guardExemptRole, isBlockingMatch } from "@/lib/regular-customer-guard";
import { leadScopeFor, leadStatusCounts, previousStatusCounts, duplicatePhoneCount, regularCustomerOrderCount, queryLeads, orderForScope } from "@/lib/leads-query";
import { Button, LinkButton } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";
import { LeadsTable } from "@/components/LeadsTable";
import { LeadSearchBox } from "@/components/LeadSearchBox";
import { AgentLeadsTable } from "@/components/AgentLeadsTable";
import { LeadStatusCards, QUICK_FILTER_STATUSES } from "@/components/LeadStatusCards";

import { displayCallName } from "@/lib/types";
import type { CallSession, OrderStatus } from "@/lib/types";
import { listSessionsForOrder } from "@/lib/call-sessions";

const PAGE_SIZE = 25;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    order_number?: string;
    status?: string;
    date_from?: string;
    date_to?: string;
    agent?: string;
    customer_name?: string;
    phone?: string;
    city?: string;
    province?: string;
    product?: string;
    prev_status?: string;
    prev_from?: string;
    prev_to?: string;
    page?: string;
    imported?: string;
    deleted?: string;
    error?: string;
    open?: string;
    open_id?: string;
    include_regular?: string;
  }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  // Lite: the orders this page shows come from bounded queries below, not from
  // the whole-table read. Loading 57,000 rows to display twenty-five was what
  // made this page take twenty seconds.
  const db = await readDbLite();

  // The page was previously reachable by direct URL for any signed-in role: the
  // sidebar hid the link but nothing here checked the permission, so whether a
  // Team Lead could open Leads depended on how they navigated. Gate it like
  // every other module page.
  if (!can(user.role, "orders", "view", db.role_permissions)) {
    return <Alert kind="error">You do not have permission to view Leads.</Alert>;
  }

  // Which Leads UI you get is decided by SCOPE, not by the role's name: anyone
  // restricted to their own leads gets the identical agent view. Keying this off
  // `role === "agent"` meant an agent placed on a custom role silently got the
  // wide management filter panel instead — the same account type, two different
  // UIs. One predicate, one UI, no per-account drift.
  const seesBeyondOwnLeads = isFullAccess(user.role) || user.role === "team_lead";
  const isAgent = !seesBeyondOwnLeads;
  const canImport = can(user.role, "orders", "upload", db.role_permissions);
  const canExport = can(user.role, "orders", "export", db.role_permissions);
  // Everything below is asked of the database. The whole scoped set never
  // reaches this process any more — only the page being shown, plus counts.
  const scope = leadScopeFor(user, db);
  const usernameToIds = new Map<string, string[]>();
  for (const p of db.profiles) {
    const key = p.username.toLowerCase();
    usernameToIds.set(key, [...(usernameToIds.get(key) || []), p.id]);
  }

  const page = Math.max(1, parseInt(sp.page || "1", 10) || 1);

  // Off by default: Regular Customers stay their own section. On, the list and
  // the cards both include them, because a count that disagrees with the rows
  // beneath it is worse than either answer.
  const includeRegular = sp.include_regular === "1";

  const [countsByStatus, prevStatusOptions, duplicateCount, regularOrderCount, leadResult] = await Promise.all([
    leadStatusCounts(scope, includeRegular),
    previousStatusCounts(scope, includeRegular),
    duplicatePhoneCount(scope),
    regularCustomerOrderCount(scope),
    // Resolved either way, never rejected.
    //
    // A search is the one thing on this page a person can make arbitrarily
    // expensive, and until 2026-08-24 an expensive one took the whole page
    // with it: a twenty-term paste ran 9.2s against 103,000 leads, the
    // database cancelled it at 8, queryLeads threw, and the agent got a white
    // screen reading "a server-side exception has occurred". Trigram indexes
    // brought that query to 234ms, but the shape of the failure was the real
    // fault — a search too heavy to finish is a thing to say, not a thing to
    // crash on. Only this call is wrapped: the counts beside it take no search
    // term, so they cannot fail this way.
    queryLeads({
      scope,
      includeRegular,
      // Dashboard cards deep-link into a pre-filtered status view — that is
      // internal navigation, not a search control, so status is honoured for
      // everyone. Every other filter stays Agent-rejected (Section 3).
      filters: isAgent
        ? { status: sp.status, prev_status: sp.prev_status, q: sp.q, phone: sp.phone }
        : {
            status: sp.status,
            prev_status: sp.prev_status,
            q: sp.q,
            order_number: sp.order_number,
            agent: sp.agent,
            customer_name: sp.customer_name,
            phone: sp.phone,
            city: sp.city,
            province: sp.province,
            product: sp.product,
            date_from: sp.date_from,
            date_to: sp.date_to,
            prev_from: sp.prev_from,
            prev_to: sp.prev_to,
          },
      isAgentView: isAgent,
      page,
      pageSize: PAGE_SIZE,
      usernameToIds,
    }).then(
      (page) => ({ ok: true as const, page }),
      (e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) })
    ),
  ]);

  const leadPage = leadResult.ok ? leadResult.page : { rows: [], total: 0 };
  // Postgres cancels at the statement timeout and says so; anything else is
  // shown as it came, because a message nobody can act on is worse than a
  // technical one somebody can quote.
  const searchFailed = leadResult.ok
    ? null
    : /timeout|canceling statement/i.test(leadResult.message)
      ? "That search was too heavy for the database to finish. Use fewer items, or longer ones — a one or two character search has to read every lead there is."
      : leadResult.message;

  // Status-card counts come from the viewer's whole scoped set, before the
  // status filter is applied, so selecting a card doesn't zero the others.
  const totalLeads = Array.from(countsByStatus.values()).reduce((n, c) => n + c, 0);
  const statusCounts = QUICK_FILTER_STATUSES.map((s) => ({ status: s, count: countsByStatus.get(s) ?? 0 }));
  const statusHref = (status?: string) => qs({ status, page: undefined });
  const prevStatusHref = (prev_status?: string) => qs({ prev_status, page: undefined });

  // Whether this list is narrowed by anything, which is what decides if Clear
  // is worth offering. The old filter names stay in the check: the query layer
  // still honours them, so a bookmarked or emailed link from before the panel
  // was removed keeps working — and a list narrowed by one of them would
  // otherwise have no way back.
  const searchNarrowed = Boolean(
    sp.q || sp.prev_status || sp.order_number || sp.agent || sp.customer_name || sp.phone || sp.city || sp.province ||
      sp.product || sp.date_from || sp.date_to || sp.prev_from || sp.prev_to
  );

  const totalPages = Math.max(1, Math.ceil(leadPage.total / PAGE_SIZE));

  // "Return to active call" asks for one specific order, and the modal that
  // ends the call only exists inside this table. That order may be on another
  // page, behind a filter, or — as it was for a stuck four-hour session on
  // 2026-08-10 — a regular customer's, which this list excludes outright. So
  // it is fetched and put on the page rather than left unreachable: without
  // it, an agent whose call is on such an order can neither return to it nor
  // start another one.
  const pageOrders = [...leadPage.rows];
  if (sp.open_id && !pageOrders.some((o) => o.id === sp.open_id)) {
    const pinned = await orderForScope(sp.open_id, scope);
    if (pinned) pageOrders.unshift(pinned);
  }

  const canEdit = can(user.role, "orders", "edit", db.role_permissions);
  const canDelete = can(user.role, "orders", "delete", db.role_permissions);
  const canManageIntegrations = can(user.role, "integrations", "manage", db.role_permissions);
  // Call Name, not username: ROMA_jamie is how the account signs in, JAMIE is
  // how the floor and the call-log files name the same person. displayCallName
  // falls back to the full name for anyone without one.
  const agentCallNameById = Object.fromEntries(db.profiles.map((p) => [p.id, displayCallName(p)]));
  const careStaffById = Object.fromEntries(db.profiles.map((p) => [p.id, { name: displayCallName(p), email: p.email }]));
  const activeProducts = db.products
    .filter((p) => p.status === "active")
    .map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      variants: p.variants,
      selling_price: p.selling_price,
      pancake_variation_id: p.pancake_variation_id,
    }));

  // Lines for the page's orders in one query, not one per row — the modal
  // opens on whichever order is clicked, and fetching per order would mean a
  // round trip on every open.
  const itemsByOrder = await listItemsFor(pageOrders.map((o) => o.id));
  const linesByOrder = Object.fromEntries(
    pageOrders.map((o) => [
      o.id,
      (itemsByOrder.get(o.id) || []).map((item) => ({
        product_id: item.product_id || "",
        product_name: item.product_name,
        variant: item.variant || "",
        quantity: String(item.quantity),
        // Empty stays empty rather than becoming a zero someone has to clear.
        unit_price: item.unit_price ? String(item.unit_price) : "",
        discount: item.discount ? String(item.discount) : "",
      })),
    ])
  );
  const productNameByOrderId = Object.fromEntries(
    pageOrders.map((o) => [o.id, o.product_id ? db.products.find((p) => p.id === o.product_id)?.name || o.product_name : o.product_name])
  );

  // Scoped to the orders actually on this page, so the query stays small no
  // matter how long the trail gets.
  const latestStatusUpdateByOrderId = (await latestStatusChangeByOrder(pageOrders.map((o) => o.id))) as Record<
    string,
    { status: OrderStatus; from: string | null; at: string }
  >;

  // The agent's open call (if any) and the call history for the rows on this
  // page. Loaded here so a reopened popup restores its timer from the server
  // rather than restarting the count.
  const canViewRegularCustomers = can(user.role, "regular_customers", "view", db.role_permissions);
  // Same grant as the Add Regular Customer button — tagging from a lead and
  // adding one outright both create a regular customer.
  const canTagRegular = can(user.role, "regular_customers", "create", db.role_permissions);

  // Shown to the agent too now. The scoping argument against it was real — the
  // detector spans every agent's customers — but the agent is the one person
  // who can still stop before working somebody else's customer, and being told
  // to raise it with a Team Lead is no use to the people who already knew.
  const canSeeDuplicateWarnings = true;
  const duplicateWarningsByOrderId: Record<
    string,
    {
      name: string;
      phone: string;
      agent: string;
      lastOrderAt: string | null;
      fields: string[];
      confidence: string;
      /** Whether the server would refuse a save over this one. See below. */
      blocking: boolean;
    }[]
  > = {};
  const findingsByOrderId = new Map<string, Awaited<ReturnType<typeof findDuplicates>>>();
  if (canSeeDuplicateWarnings) {
    for (const o of pageOrders) {
      if (!o.customer_phone.trim()) continue;
      const findings = await findDuplicates({
        full_name: o.customer_name,
        phone_normalized: canonicalPhone(o.customer_phone),
        purok: o.purok,
        barangay: o.barangay,
        city: o.city,
        province: o.province,
      });
      if (findings.length > 0) findingsByOrderId.set(o.id, findings);
    }

    // When the other agent last sold to them, in one query for every match on
    // the page rather than one per row. A match from eight months ago and one
    // from yesterday are not the same conversation, and that is the whole
    // reason the date is worth showing.
    const matchedIds = Array.from(
      new Set(Array.from(findingsByOrderId.values()).flat().map((d) => d.matched.id))
    );
    const lastOrderByCustomerId = await latestOrderDateByCustomer(matchedIds);

    /**
     * Which of these matches would actually stop a save, as opposed to being
     * worth knowing about.
     *
     * The two are not the same thing, and this page used to say they were:
     * Save Changes refused whenever there was ANY match, on the stated grounds
     * that the server would refuse it too. It would not, and an agent on a call
     * was held behind a record that had been untagged minutes earlier.
     *
     * The verdict is not decided here any more. It comes from the same function
     * the two server actions ask, so the dialog and the save it stands in front
     * of cannot drift apart again. What is still decided here is only what to
     * MATCH on, which the warnings panel needs anyway.
     */
    const sharedToMe = new Set(
      guardExemptRole(user.role) ? [] : await sharedCustomerIdsForAgent(matchedIds, user.id)
    );

    for (const [orderId, findings] of findingsByOrderId) {
      duplicateWarningsByOrderId[orderId] = findings.map((d) => ({
        name: d.matched.full_name,
        phone: d.matched.phone_raw,
        agent: agentCallNameById[d.matched.owner_agent_id] || "—",
        lastOrderAt: lastOrderByCustomerId.get(d.matched.id) ?? null,
        fields: d.fields,
        confidence: d.confidence,
        blocking: isBlockingMatch(d.matched, user, sharedToMe),
      }));
    }
  }

  // The active session is provided app-wide by CallSessionProvider (mounted in
  // the layout), so this page no longer fetches or forwards it.
  const callSessionsByOrderId: Record<string, CallSession[]> = {};
  if (isAgent && pageOrders.length > 0) {
    for (const o of pageOrders) {
      const sessions = await listSessionsForOrder(o.id);
      if (sessions.length > 0) callSessionsByOrderId[o.id] = sessions;
    }
  }

  // Break controls in the header: agents work out of this page all day, so
  // sending them to the clock page to start a break meant losing their place.
  const ownAttendance = db.attendance.find((a) => a.user_id === user.id && a.work_date === todayInTz());
  const ownBioBreak = ownAttendance?.time_in && !ownAttendance.time_out ? await getActiveBioBreak(user.id) : null;
  // The end of shift is worked out in the app layout now, once, for every page —
  // see ShiftWatcher. This page keeps only the break buttons.

  const qs = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { ...sp, ...overrides };
    Object.entries(merged).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    return `?${params.toString()}`;
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-page-title text-slate-900">Leads</h1>
        <div className="flex gap-2">
          {canExport && (
            <a href={`/api/leads/export${qs({})}`}>
              <Button variant="outline">
                <Download className="h-4 w-4" /> Export CSV
              </Button>
            </a>
          )}
          {canImport && (
            <LinkButton href="/leads/import" variant="outline">
              Import Excel
            </LinkButton>
          )}
          {/* Surfaced with a count so a bad import is visible from the Leads
              page itself rather than only to whoever thinks to look. */}
          {duplicateCount > 0 && (
            <LinkButton href="/leads/duplicates" variant="outline">
              <CopyIcon className="h-4 w-4" /> Duplicates {duplicateCount}
            </LinkButton>
          )}
          <BreakControls
            breakStart={ownAttendance?.break_start ?? null}
            breakEnd={ownAttendance?.break_end ?? null}
            allowanceMinutes={db.work_schedule.break_minutes}
            bioStartedAt={ownBioBreak?.started_at ?? null}
            canBreak={!!ownAttendance?.time_in && !ownAttendance.time_out}
            redirectTo="/leads"
          />
          {/* Here too, and not redundantly: the order holding the call may be on
              another page of this list, or behind whatever filter is on, or a
              regular customer's — which this list leaves out entirely. Being on
              the leads page is not the same as being able to find the lead. */}
          <BackToCallButton />
          {/* Moving a queue between callers. Full access only, the same rule the
              Agent field on a single lead already follows. */}
          {canAssignLeads(user, db) && (
            <LinkButton href="/leads/transfer" variant="outline" size="sm">
              <ArrowLeftRight className="h-4 w-4" /> Transfer Leads
            </LinkButton>
          )}
          {/* The primary action here is now ordering for someone the agent
              already keeps: pick them by phone number, then the order form
              opens on their saved details. A role that cannot see Regular
              Customers keeps the plain New Lead button, so it is never left
              with no way to create anything. */}
          {canViewRegularCustomers ? (
            <LinkButton href="/regular-customers/order">Create Order from Regular Customer</LinkButton>
          ) : (
            <LinkButton href="/leads/new">New Lead</LinkButton>
          )}
        </div>
      </div>

      {sp.error && (
        <Alert kind="error" className="mb-4">
          {sp.error}
        </Alert>
      )}
      {searchFailed && (
        <Alert kind="error" className="mb-4">
          {searchFailed}
        </Alert>
      )}
      {sp.imported && (
        <Alert kind="success" className="mb-4">
          Imported {sp.imported} lead(s) successfully.
        </Alert>
      )}
      {sp.deleted && (
        <Alert kind="success" className="mb-4">
          Lead deleted.
        </Alert>
      )}

      {/* One box, for every role.

          The "More filters" grid that used to sit under this — status, agent,
          order id, product, customer name, phone, city, province and four date
          ranges — is gone. Fourteen controls, each needing to be found, filled
          and then remembered to be cleared, in front of a list somebody is
          working through while a customer talks. What it did that mattered, the
          box already did: an id, a name, a number, an agent.

          Status is the one thing it could do that the box could not, so the box
          does it now — typing "delivered" narrows to the delivered leads. The
          status cards and the Status dropdown beside them are still there for
          picking one exactly.

          The date ranges have no replacement here. They are a reporting
          question, and Reports is where a date range belongs. */}
      <form className="sticky top-0 z-30 mb-4 flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <input type="hidden" name="status" value={sp.status || ""} />
        {/* The box takes a list as well as a term now — paste a column of
            order ids out of a spreadsheet and every one of them comes back in
            a single list. See LeadSearchBox for why an <input> alone cannot. */}
        <div className="flex-1">
          <LeadSearchBox
            defaultValue={sp.q || sp.phone}
            placeholder={
              isAgent
                ? "Search order ID, customer, phone, tracking number, or status"
                : "Search order ID, customer, phone, agent username, or status"
            }
          />
        </div>
        {/* Previous order date. The range has been filtered on since the query
            layer was written — prev_from / prev_to reach `previous_order_date`
            — but there was no way to set it without typing the parameters into
            the address bar, so the filter existed and nobody could use it.
            Kept as a pair of plain date inputs in the same GET form as the
            search, so one Search press applies both. */}
        <div className="flex shrink-0 items-center gap-2">
          <label htmlFor="prev_from" className="whitespace-nowrap text-xs font-medium text-slate-500">
            Prev. order
          </label>
          <Input
            id="prev_from"
            name="prev_from"
            type="date"
            aria-label="Previous order date from"
            className="w-[9.5rem]"
            defaultValue={sp.prev_from}
          />
          <span className="text-xs text-slate-400">to</span>
          <Input
            id="prev_to"
            name="prev_to"
            type="date"
            aria-label="Previous order date to"
            className="w-[9.5rem]"
            defaultValue={sp.prev_to}
          />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
        {searchNarrowed && (
          <LinkButton href="/leads" variant="outline">
            Clear
          </LinkButton>
        )}
      </form>

      {/* Their orders are out of this list by design, and on 2026-08-10 that
          meant every card read 0 while the floor had worked eleven orders.
          Saying how many are over there — and offering to fold them in — is
          the difference between a rule and a disappearance. */}
      {regularOrderCount > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">
            {includeRegular ? (
              <>Counting {regularOrderCount} regular-customer order{regularOrderCount === 1 ? "" : "s"} in the figures below.</>
            ) : (
              <>
                {regularOrderCount} order{regularOrderCount === 1 ? "" : "s"} for regular customers {regularOrderCount === 1 ? "is" : "are"} not
                counted below.
              </>
            )}
          </span>
          <LinkButton href={qs({ include_regular: includeRegular ? undefined : "1", page: undefined })} variant="outline" size="sm">
            {includeRegular ? "Hide regular customers" : "Include regular customers"}
          </LinkButton>
          <LinkButton href="/regular-customers" variant="outline" size="sm">
            Regular Customers {regularOrderCount}
          </LinkButton>
        </div>
      )}

      <LeadStatusCards
        counts={statusCounts}
        total={totalLeads}
        selected={sp.status}
        hrefFor={statusHref}
        prevStatusCounts={prevStatusOptions}
        prevSelected={sp.prev_status}
        prevHrefFor={prevStatusHref}
      />


      {isAgent ? (
        <AgentLeadsTable
          orders={pageOrders}
          careStaffById={careStaffById}
          duplicateWarningsByOrderId={duplicateWarningsByOrderId}
          canTagRegular={canTagRegular}
          productNameByOrderId={productNameByOrderId}
          activeProducts={activeProducts}
          linesByOrder={linesByOrder}
          canEdit={canEdit}
          callSessionsByOrderId={callSessionsByOrderId}
          dialScheme={db.operations.dial_scheme}
        agentNameById={agentCallNameById}
          latestStatusUpdateByOrderId={latestStatusUpdateByOrderId}
          initialOpenOrderNumber={sp.open}
          initialOpenOrderId={sp.open_id}
        />
      ) : (
      <LeadsTable
        orders={pageOrders}
        agentCallNameById={agentCallNameById}
        productNameByOrderId={productNameByOrderId}
        latestStatusUpdateByOrderId={latestStatusUpdateByOrderId}
        activeProducts={activeProducts}
        linesByOrder={linesByOrder}
        canEdit={canEdit}
        canDelete={canDelete}
        canManageIntegrations={canManageIntegrations}
        canSetFulfillmentStatus={isFullAccess(user.role)}
        duplicateWarningsByOrderId={duplicateWarningsByOrderId}
        canTagRegular={canTagRegular}
        requiresCallSession={!isFullAccess(user.role)}
        callSessionsByOrderId={callSessionsByOrderId}
        dialScheme={db.operations.dial_scheme}
        agentNameById={agentCallNameById}
        canSeeFulfillment={!isAgent}
        fullPageHrefBase={isFullAccess(user.role) ? "/leads" : null}
        initialOpenOrderNumber={sp.open}
        initialOpenOrderId={sp.open_id}
      />
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <span>
            Page {page} of {totalPages} ({leadPage.total} leads)
          </span>
          <div className="flex gap-2">
            <LinkButton
              href={qs({ page: String(Math.max(1, page - 1)) })}
              variant="outline"
              size="sm"
              className={page <= 1 ? "pointer-events-none opacity-50" : ""}
            >
              Previous
            </LinkButton>
            <LinkButton
              href={qs({ page: String(Math.min(totalPages, page + 1)) })}
              variant="outline"
              size="sm"
              className={page >= totalPages ? "pointer-events-none opacity-50" : ""}
            >
              Next
            </LinkButton>
          </div>
        </div>
      )}
    </div>
  );
}
