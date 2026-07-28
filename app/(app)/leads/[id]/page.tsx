import { notFound, redirect } from "next/navigation";
import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { orderInScope } from "@/lib/order-access";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { StatusBadge, SyncStatusChip, LEAD_STATUS_STYLES } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/utils";
import { deleteLeadAction, updateLeadAction } from "@/lib/actions/leads";
import { LeadEditForm } from "@/components/LeadEditForm";
import { listSyncLogs, getAccount } from "@/lib/pancake/store";
import { MAX_ATTEMPTS } from "@/lib/pancake/retry";

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
  if (!orderInScope(user, order, db)) redirect("/forbidden");

  const canEdit = can(user.role, "orders", "edit", db.role_permissions);
  const canDelete = can(user.role, "orders", "delete", db.role_permissions);
  const canReassign = isFullAccess(user.role);
  const creator = db.profiles.find((p) => p.id === order.created_by);
  const updater = order.updated_by ? db.profiles.find((p) => p.id === order.updated_by) : null;
  const agents = db.profiles.filter((p) => p.is_active).map((p) => ({ id: p.id, full_name: p.full_name, username: p.username }));
  const activeProducts = db.products
    .filter((p) => p.is_active)
    .map((p) => ({ id: p.id, name: p.name, code: p.code, variants: p.variants }));
  const currentProductName = order.product_id ? db.products.find((p) => p.id === order.product_id)?.name || order.product_name : order.product_name;

  const byId = new Map(db.profiles.map((p) => [p.id, p.full_name]));
  const history = db.activity_log
    .filter((e) => e.entity_id === order.id && e.module === "orders")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const canSeeFulfillment = isFullAccess(user.role) || user.role === "team_lead";
  const wasForwarded =
    canSeeFulfillment &&
    (order.status === "packaging" ||
    Boolean(order.pancake_order_id || order.forwarded_to_pancake_at) ||
      order.pancake_sync_status !== "not_synced");
  const syncLogs = wasForwarded ? await listSyncLogs({ order_id: order.id, limit: 25 }) : [];
  const pancakeAccount = order.pancake_pos_account_id ? await getAccount(order.pancake_pos_account_id) : null;

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
              <h1 className="text-page-title text-slate-900">{order.order_number}</h1>
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
            canSetFulfillmentStatus={isFullAccess(user.role)}
            productName={currentProductName}
            agents={agents}
            activeProducts={activeProducts}
          />
        </CardContent>
      </Card>

      {wasForwarded && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Pancake POS</CardTitle>
            <SyncStatusChip
              status={order.pancake_sync_status}
              needsReview={order.pancake_sync_status === "sync_failed" && order.pancake_retry_count >= MAX_ATTEMPTS}
            />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs uppercase text-slate-400">Pancake Account</p>
                <p className="text-slate-800">{pancakeAccount?.account_name || "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-400">Pancake POS Order ID</p>
                {order.pancake_order_id ? (
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-800">{order.pancake_order_id}</code>
                ) : (
                  <p className="text-slate-400">—</p>
                )}
              </div>
              <div>
                <p className="text-xs uppercase text-slate-400">Pancake Status</p>
                <p className="text-slate-800">{order.pancake_status || "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-400">Last Sync Attempt</p>
                <p className="text-slate-800">
                  {order.pancake_last_sync_attempt_at ? formatDateTime(order.pancake_last_sync_attempt_at) : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-400">Forwarded At</p>
                <p className="text-slate-800">{order.forwarded_to_pancake_at ? formatDateTime(order.forwarded_to_pancake_at) : "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-400">Synced At</p>
                <p className="text-slate-800">{order.pancake_synced_at ? formatDateTime(order.pancake_synced_at) : "—"}</p>
              </div>
            </div>
            {order.pancake_sync_error && <Alert kind="error">Last sync error: {order.pancake_sync_error}</Alert>}
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Sync History</p>
              <ul className="max-h-56 space-y-1.5 overflow-y-auto text-xs text-slate-600">
                {syncLogs.map((h) => (
                  <li key={h.id} className="rounded border border-slate-100 px-2 py-1.5">
                    <span className={h.result === "failed" ? "font-medium text-red-600" : "font-medium text-green-700"}>
                      {h.action.replaceAll("_", " ")}
                    </span>{" "}
                    · {h.source ? h.source.replaceAll("_", " ") : "—"} · {formatDateTime(h.request_at)}
                    {h.old_status || h.new_status ? <> · {h.old_status || "—"} → {h.new_status || "—"}</> : null}
                    {h.error_message && <p className="mt-0.5 text-red-500">{h.error_message}</p>}
                  </li>
                ))}
                {syncLogs.length === 0 && <li className="text-slate-400">No sync history yet.</li>}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

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
