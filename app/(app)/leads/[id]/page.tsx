import { notFound } from "next/navigation";
import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { orderInScope } from "@/lib/order-access";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { StatusBadge, LEAD_STATUS_STYLES } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/utils";
import { deleteLeadAction, updateLeadAction } from "@/lib/actions/leads";
import { LeadEditForm } from "@/components/LeadEditForm";

function summarizeValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") {
    const json = JSON.stringify(v);
    return json.length > 140 ? json.slice(0, 140) + "…" : json;
  }
  return String(v);
}

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; created?: string; updated?: string }>;
}) {
  const { id } = await params;
  const { error, created, updated } = await searchParams;
  const db = await readDb();
  const order = db.orders.find((o) => o.id === id);
  if (!order) notFound();

  const user = (await getCurrentUser())!;
  if (!orderInScope(user, order, db)) notFound();

  const canEdit = can(user.role, "orders", "edit", db.role_permissions);
  const canDelete = can(user.role, "orders", "delete", db.role_permissions);
  const canReassign = isFullAccess(user.role);
  const creator = db.profiles.find((p) => p.id === order.created_by);
  const updater = order.updated_by ? db.profiles.find((p) => p.id === order.updated_by) : null;
  const agents = db.profiles.filter((p) => p.is_active).map((p) => ({ id: p.id, full_name: p.full_name, username: p.username }));
  const activeProducts = db.products.filter((p) => p.is_active).map((p) => ({ id: p.id, name: p.name, code: p.code }));
  const currentProductName = order.product_id ? db.products.find((p) => p.id === order.product_id)?.name || order.product_name : order.product_name;

  const byId = new Map(db.profiles.map((p) => [p.id, p.full_name]));
  const history = db.activity_log
    .filter((e) => e.entity_id === order.id && e.module === "orders")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const boundUpdate = updateLeadAction.bind(null, order.id);
  const boundDelete = async () => {
    "use server";
    await deleteLeadAction(order.id);
  };

  const style = LEAD_STATUS_STYLES[order.status];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className={`rounded-t-xl ${style.header} h-2 w-full`} />
      <div className={`-mt-6 rounded-b-xl ${style.row} p-4`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-900">{order.order_number}</h1>
              <StatusBadge status={order.status} />
            </div>
            <p className="text-sm text-slate-500">
              Created by {creator?.full_name || "—"} on {formatDateTime(order.created_at)}
              {updater && (
                <>
                  {" "}
                  · Last updated by {updater.full_name} on {formatDateTime(order.updated_at)}
                </>
              )}
            </p>
          </div>
          {canDelete && (
            <ConfirmButton
              action={boundDelete}
              variant="danger"
              label="Delete"
              confirmTitle="Delete this lead?"
              confirmBody="This permanently removes the lead record. A full snapshot is kept in the audit log for recovery reference."
            />
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lead details</CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert kind="error" className="mb-4">
              {error}
            </Alert>
          )}
          {created && (
            <Alert kind="success" className="mb-4">
              Lead created successfully.
            </Alert>
          )}
          {updated && (
            <Alert kind="success" className="mb-4">
              Lead updated successfully.
            </Alert>
          )}
          <LeadEditForm
            order={order}
            action={boundUpdate}
            canEdit={canEdit}
            canReassign={canReassign}
            canSeePreviousOrderFields={isFullAccess(user.role)}
            productName={currentProductName}
            agents={agents}
            activeProducts={activeProducts}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-slate-100">
            {history.map((e) => (
              <li key={e.id} className="px-5 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-700">{e.user_id ? byId.get(e.user_id) || "Unknown" : "System"}</span>
                  <span className="text-xs text-slate-400">{formatDateTime(e.created_at)}</span>
                </div>
                <p>
                  <span className="inline-flex rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{e.action}</span>
                </p>
                {Boolean(e.previous_value || e.updated_value) && (
                  <p className="mt-1 text-xs text-slate-400">
                    {e.previous_value ? `Previous: ${summarizeValue(e.previous_value)}` : ""}
                    {e.previous_value && e.updated_value ? " · " : ""}
                    {e.updated_value ? `Updated: ${summarizeValue(e.updated_value)}` : ""}
                  </p>
                )}
              </li>
            ))}
            {history.length === 0 && <li className="px-5 py-6 text-center text-sm text-slate-400">No history yet.</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
