import { Copy as CopyIcon, Download } from "lucide-react";
import { readDbLite } from "@/lib/db";
import { latestStatusChangeByOrder } from "@/lib/audit-log";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { allowedAssigneeIds } from "@/lib/order-access";
import { listItemsFor } from "@/lib/order-items";
import { canonicalPhone, todayInTz } from "@/lib/utils";
import { BreakControls } from "@/components/BreakControls";
import { getActiveBioBreak } from "@/lib/bio-breaks";
import { findDuplicates } from "@/lib/customers";
import { leadScopeFor, leadStatusCounts, duplicatePhoneCount, regularCustomerOrderCount, queryLeads, orderForScope } from "@/lib/leads-query";
import { Button, LinkButton } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";
import { LeadsTable } from "@/components/LeadsTable";
import { AgentLeadsTable } from "@/components/AgentLeadsTable";
import { LeadStatusCards, QUICK_FILTER_STATUSES } from "@/components/LeadStatusCards";

import { LEAD_STATUSES, LEAD_STATUS_LABELS } from "@/lib/validation";
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

  const [countsByStatus, duplicateCount, regularOrderCount, leadPage] = await Promise.all([
    leadStatusCounts(scope, includeRegular),
    duplicatePhoneCount(scope),
    regularCustomerOrderCount(scope),
    queryLeads({
      scope,
      includeRegular,
      // Dashboard cards deep-link into a pre-filtered status view — that is
      // internal navigation, not a search control, so status is honoured for
      // everyone. Every other filter stays Agent-rejected (Section 3).
      filters: isAgent
        ? { status: sp.status, q: sp.q, phone: sp.phone }
        : {
            status: sp.status,
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
    }),
  ]);

  // Status-card counts come from the viewer's whole scoped set, before the
  // status filter is applied, so selecting a card doesn't zero the others.
  const totalLeads = Array.from(countsByStatus.values()).reduce((n, c) => n + c, 0);
  const statusCounts = QUICK_FILTER_STATUSES.map((s) => ({ status: s, count: countsByStatus.get(s) ?? 0 }));
  const statusHref = (status?: string) => qs({ status, page: undefined });

  // Any advanced filter already in play keeps that panel open on load, so a
  // filtered list never looks unfiltered.
  const advancedFilterActive = Boolean(
    sp.order_number || sp.agent || sp.customer_name || sp.phone || sp.city || sp.province ||
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

  // The agent filter must list only agents the viewer is allowed to see. It used
  // to list every active profile, so a Team Lead's dropdown named agents outside
  // their team — selecting one returned nothing, but the roster still leaked.
  const allowedAgentIds = new Set(allowedAssigneeIds(user, db));
  const scopedAgents = db.profiles.filter((p) => p.is_active && !p.is_deleted && allowedAgentIds.has(p.id));

  const canEdit = can(user.role, "orders", "edit", db.role_permissions);
  const canManageIntegrations = can(user.role, "integrations", "manage", db.role_permissions);
  // Call Name, not username: ROMA_jamie is how the account signs in, JAMIE is
  // how the floor and the call-log files name the same person. displayCallName
  // falls back to the full name for anyone without one.
  const agentCallNameById = Object.fromEntries(db.profiles.map((p) => [p.id, displayCallName(p)]));
  const agentFullNameById = Object.fromEntries(db.profiles.map((p) => [p.id, p.full_name]));
  const careStaffById = Object.fromEntries(db.profiles.map((p) => [p.id, { name: p.full_name, email: p.email }]));
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

  // Duplicate warnings are computed for Management/Team Lead only. Agents are
  // never given them: the detector spans every agent's customers by design, so
  // surfacing a match would leak exactly what their scoping withholds.
  const canSeeDuplicateWarnings = seesBeyondOwnLeads;
  const duplicateWarningsByOrderId: Record<
    string,
    { name: string; phone: string; agent: string; fields: string[]; confidence: string }[]
  > = {};
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
      if (findings.length > 0) {
        duplicateWarningsByOrderId[o.id] = findings.map((d) => ({
          name: d.matched.full_name,
          phone: d.matched.phone_raw,
          agent: agentFullNameById[d.matched.owner_agent_id] || "—",
          fields: d.fields,
          confidence: d.confidence,
        }));
      }
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

      {/* One layout for every role: a single search box, then the status cards.
          The wide filter grid that used to sit here for Administrators and Team
          Leads is still available, collapsed, so the wider scoping those roles
          need is not lost — it just stops being the first thing on the page. */}
      <form className="sticky top-0 z-30 mb-4 flex gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <input type="hidden" name="status" value={sp.status || ""} />
        <div className="flex-1">
          <Input
            name="q"
            placeholder={
              isAgent
                ? "Search order ID, customer name, phone number, or tracking number"
                : "Search order ID, customer, phone, or agent username"
            }
            defaultValue={sp.q || sp.phone}
          />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
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

      <LeadStatusCards counts={statusCounts} total={totalLeads} selected={sp.status} hrefFor={statusHref} />

      {!isAgent && (
        <details open={advancedFilterActive} className="mb-4 rounded-lg border border-slate-200 bg-white">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
            More filters
            {advancedFilterActive && (
              <span className="ml-2 rounded-full bg-[var(--brand-primary-10)] px-2 py-0.5 text-xs text-[var(--brand-primary)]">
                active
              </span>
            )}
          </summary>
          <form className="grid grid-cols-1 gap-3 border-t border-slate-100 p-4 sm:grid-cols-4">
            <input type="hidden" name="q" value={sp.q || ""} />
            <Select name="status" defaultValue={sp.status || ""}>
              <option value="">All statuses</option>
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {LEAD_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
            <Select name="agent" defaultValue={sp.agent || ""}>
              <option value="">All agents</option>
              {scopedAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.full_name} ({a.username})
                </option>
              ))}
            </Select>
            <Input name="order_number" placeholder="Order ID" defaultValue={sp.order_number} />
            <Select name="product" defaultValue={sp.product || ""}>
              <option value="">All products</option>
              {db.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>

            <Input name="customer_name" placeholder="Customer Name" defaultValue={sp.customer_name} />
            <Input name="phone" placeholder="Phone Number" defaultValue={sp.phone} />
            <Input name="city" placeholder="City" defaultValue={sp.city} />
            <Input name="province" placeholder="Province" defaultValue={sp.province} />

            <div>
              <label className="mb-1 block text-xs text-slate-400">Order Date from</label>
              <Input type="date" name="date_from" defaultValue={sp.date_from} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Order Date to</label>
              <Input type="date" name="date_to" defaultValue={sp.date_to} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Previous Order Date from</label>
              <Input type="date" name="prev_from" defaultValue={sp.prev_from} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Previous Order Date to</label>
              <Input type="date" name="prev_to" defaultValue={sp.prev_to} />
            </div>

            <div className="flex items-end gap-2 sm:col-span-4">
              <Button type="submit" variant="secondary">
                Apply filters
              </Button>
              <LinkButton href="/leads" variant="outline">
                Clear
              </LinkButton>
            </div>
          </form>
        </details>
      )}

      {isAgent ? (
        <AgentLeadsTable
          orders={pageOrders}
          careStaffById={careStaffById}
          productNameByOrderId={productNameByOrderId}
          activeProducts={activeProducts}
          linesByOrder={linesByOrder}
          canEdit={canEdit}
          callSessionsByOrderId={callSessionsByOrderId}
          agentNameById={agentFullNameById}
          latestStatusUpdateByOrderId={latestStatusUpdateByOrderId}
          initialOpenOrderNumber={sp.open}
          initialOpenOrderId={sp.open_id}
        />
      ) : (
      <LeadsTable
        orders={pageOrders}
        agentCallNameById={agentCallNameById}
        agentFullNameById={agentFullNameById}
        productNameByOrderId={productNameByOrderId}
        latestStatusUpdateByOrderId={latestStatusUpdateByOrderId}
        activeProducts={activeProducts}
        linesByOrder={linesByOrder}
        canEdit={canEdit}
        canManageIntegrations={canManageIntegrations}
        canSetFulfillmentStatus={isFullAccess(user.role)}
        duplicateWarningsByOrderId={duplicateWarningsByOrderId}
        requiresCallSession={!isFullAccess(user.role)}
        callSessionsByOrderId={callSessionsByOrderId}
        agentNameById={agentFullNameById}
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
