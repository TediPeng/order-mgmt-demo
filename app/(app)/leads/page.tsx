import { Download } from "lucide-react";
import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { scopeOrders } from "@/lib/order-access";
import { normalizePhone, isValidPhoneQuery } from "@/lib/utils";
import { Button, LinkButton } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";
import { LeadsTable } from "@/components/LeadsTable";
import { StatusBadge } from "@/components/ui/Badge";
import { LEAD_STATUSES, LEAD_STATUS_LABELS, PRE_SALE_STATUSES } from "@/lib/validation";
import type { OrderStatus } from "@/lib/types";

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
  }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDb();
  const isAgent = user.role === "agent";
  const canImport = can(user.role, "orders", "upload", db.role_permissions);
  const canExport = can(user.role, "orders", "export", db.role_permissions);

  let orders = scopeOrders(user, db.orders, db).sort((a, b) => b.created_at.localeCompare(a.created_at));

  // Dashboard cards deep-link agents into a pre-filtered status view â€” that's
  // internal navigation, not a search control, so status stays honored for
  // everyone. Every other filter param is Agent-only-rejected per Section 3.
  if (sp.status) orders = orders.filter((o) => o.status === sp.status);

  let phoneError: string | null = null;

  if (isAgent) {
    const rawPhone = (sp.phone || "").trim();
    if (rawPhone) {
      if (!isValidPhoneQuery(rawPhone)) {
        phoneError = "Please enter a valid phone number.";
        // Invalid input: do not run the query, fall back to the unfiltered list.
      } else {
        const target = normalizePhone(rawPhone);
        orders = orders.filter((o) => normalizePhone(o.customer_phone).startsWith(target));
      }
    }
  } else {
    if (sp.q) {
      const q = sp.q.toLowerCase();
      const usernameByAgentId = new Map(db.profiles.map((p) => [p.id, p.username.toLowerCase()]));
      orders = orders.filter(
        (o) =>
          o.order_number.toLowerCase().includes(q) ||
          o.customer_name.toLowerCase().includes(q) ||
          o.customer_phone.toLowerCase().includes(q) ||
          (usernameByAgentId.get(o.agent_id) || "").includes(q)
      );
    }
    if (sp.order_number) orders = orders.filter((o) => o.order_number.toLowerCase().includes(sp.order_number!.toLowerCase()));
    if (sp.date_from) orders = orders.filter((o) => (o.order_date || "") >= sp.date_from!);
    if (sp.date_to) orders = orders.filter((o) => (o.order_date || "") <= sp.date_to!);
    if (sp.agent) orders = orders.filter((o) => o.agent_id === sp.agent);
    if (sp.customer_name) orders = orders.filter((o) => o.customer_name.toLowerCase().includes(sp.customer_name!.toLowerCase()));
    if (sp.phone) orders = orders.filter((o) => o.customer_phone.toLowerCase().includes(sp.phone!.toLowerCase()));
    if (sp.city) orders = orders.filter((o) => o.city.toLowerCase().includes(sp.city!.toLowerCase()));
    if (sp.province) orders = orders.filter((o) => o.province.toLowerCase().includes(sp.province!.toLowerCase()));
    if (sp.product) orders = orders.filter((o) => o.product_id === sp.product);
    if (sp.prev_from) orders = orders.filter((o) => (o.previous_order_date || "") >= sp.prev_from!);
    if (sp.prev_to) orders = orders.filter((o) => (o.previous_order_date || "") <= sp.prev_to!);
  }

  const page = Math.max(1, parseInt(sp.page || "1", 10) || 1);
  const totalPages = Math.max(1, Math.ceil(orders.length / PAGE_SIZE));
  const pageOrders = orders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const scopedAgents = db.profiles.filter((p) => p.is_active);

  const canEdit = can(user.role, "orders", "edit", db.role_permissions);
  const canManageIntegrations = can(user.role, "integrations", "manage", db.role_permissions);
  const agentUsernameById = Object.fromEntries(db.profiles.map((p) => [p.id, p.username]));
  const agentFullNameById = Object.fromEntries(db.profiles.map((p) => [p.id, p.full_name]));
  const activeProducts = db.products.filter((p) => p.is_active).map((p) => ({ id: p.id, name: p.name, code: p.code, variants: p.variants }));
  const productNameByOrderId = Object.fromEntries(
    pageOrders.map((o) => [o.id, o.product_id ? db.products.find((p) => p.id === o.product_id)?.name || o.product_name : o.product_name])
  );

  const pageOrderIds = new Set(pageOrders.map((o) => o.id));
  const latestStatusUpdateByOrderId: Record<string, { status: OrderStatus; at: string }> = {};
  for (const e of db.activity_log) {
    if (e.action !== "LEAD_STATUS_CHANGED" || e.module !== "orders" || !e.entity_id || !pageOrderIds.has(e.entity_id)) continue;
    const existing = latestStatusUpdateByOrderId[e.entity_id];
    if (!existing || e.created_at > existing.at) {
      const updatedStatus = (e.updated_value as { status?: OrderStatus } | null)?.status;
      if (updatedStatus) latestStatusUpdateByOrderId[e.entity_id] = { status: updatedStatus, at: e.created_at };
    }
  }

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
        <h1 className="text-xl font-semibold text-slate-900">Leads</h1>
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
          <LinkButton href="/leads/new">New Lead</LinkButton>
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
      {phoneError && (
        <Alert kind="error" className="mb-4">
          {phoneError}
        </Alert>
      )}

      {isAgent ? (
        <form className="mb-4 flex gap-3 rounded-lg border border-slate-200 bg-white p-4">
          <input type="hidden" name="status" value={sp.status || ""} />
          <div className="flex-1">
            <Input name="phone" placeholder="Search customer using phone number" defaultValue={sp.phone} />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
      ) : (
        <form className="mb-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Input name="q" placeholder="Search order #, customer, phone, or agent username" defaultValue={sp.q} />
          </div>
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

          <Input name="order_number" placeholder="Order Number" defaultValue={sp.order_number} />
          <Input name="customer_name" placeholder="Customer Name" defaultValue={sp.customer_name} />
          <Input name="phone" placeholder="Phone Number" defaultValue={sp.phone} />
          <Select name="product" defaultValue={sp.product || ""}>
            <option value="">All products</option>
            {db.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>

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
          <div className="flex items-end">
            <Button type="submit" variant="secondary" className="w-full">
              Filter
            </Button>
          </div>
        </form>
      )}

      <div className="mb-4 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
          <span className="font-semibold uppercase tracking-wide text-slate-400">Pre-sale:</span>
          {PRE_SALE_STATUSES.map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
          <span className="font-semibold uppercase tracking-wide text-slate-400">Fulfillment (Pancake POS):</span>
          {LEAD_STATUSES.filter((s) => !(PRE_SALE_STATUSES as readonly string[]).includes(s)).map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
        </div>
      </div>

      <LeadsTable
        orders={pageOrders}
        agentUsernameById={agentUsernameById}
        agentFullNameById={agentFullNameById}
        productNameByOrderId={productNameByOrderId}
        latestStatusUpdateByOrderId={latestStatusUpdateByOrderId}
        activeProducts={activeProducts}
        canEdit={canEdit}
        canManageIntegrations={canManageIntegrations}
        fullPageHrefBase={isFullAccess(user.role) ? "/leads" : null}
        initialOpenOrderNumber={sp.open}
      />

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <span>
            Page {page} of {totalPages} ({orders.length} leads)
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
