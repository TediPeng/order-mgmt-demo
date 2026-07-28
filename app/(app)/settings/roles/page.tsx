import { redirect } from "next/navigation";
import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { ACTIONS, MODULE_ACTIONS, MODULE_LABELS, ACTION_LABELS, permissionGrid, isFullAccess } from "@/lib/permissions";
import { MODULES } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Textarea } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { createRoleAction, deleteRoleAction, resetRolePermissionsAction, updatePermissionAction } from "@/lib/actions/roles";
import type { ActionKey, ModuleKey } from "@/lib/types";

export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; reset?: string; created?: string; deleted?: string; error?: string; role?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  if (!isFullAccess(user.role)) redirect("/dashboard");

  const db = await readDb();
  const activeRoleKey = sp.role || "team_lead";
  const activeRole = db.roles.find((r) => r.key === activeRoleKey) || db.roles.find((r) => r.key === "team_lead")!;
  const grid = permissionGrid(activeRole.key, db.role_permissions);
  const userCountByRole = new Map<string, number>();
  db.profiles.forEach((p) => userCountByRole.set(p.role, (userCountByRole.get(p.role) || 0) + 1));

  const boundReset = async () => {
    "use server";
    await resetRolePermissionsAction(activeRole.key as "team_lead" | "agent");
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-page-title text-slate-900">Roles &amp; Permissions</h1>
      </div>

      {sp.saved && <Alert kind="success">Permission updated — takes effect immediately, no redeploy needed.</Alert>}
      {sp.reset && <Alert kind="success">Role permissions reset to defaults.</Alert>}
      {sp.created && <Alert kind="success">Role created.</Alert>}
      {sp.deleted && <Alert kind="success">Role deleted.</Alert>}
      {sp.error && <Alert kind="error">{sp.error}</Alert>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Roles</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-slate-100">
              {db.roles.map((r) => (
                <li key={r.key}>
                  <a
                    href={`/settings/roles?role=${r.key}`}
                    className={`flex items-center justify-between px-4 py-3 text-sm hover:bg-slate-50 ${
                      activeRole.key === r.key ? "bg-[var(--brand-primary-10)] font-medium text-[var(--brand-primary)]" : "text-slate-700"
                    }`}
                  >
                    <span>{r.name}</span>
                    <Badge>{userCountByRole.get(r.key) || 0} users</Badge>
                  </a>
                </li>
              ))}
            </ul>
            <form action={createRoleAction} className="space-y-2 border-t border-slate-100 p-4">
              <p className="text-xs font-semibold uppercase text-slate-400">Create custom role</p>
              <Input name="name" placeholder="Role name" required />
              <Textarea name="description" placeholder="Description (optional)" rows={2} />
              <Button type="submit" size="sm" className="w-full">
                Create Role
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader className="flex items-center justify-between">
            <div>
              <CardTitle>{activeRole.name}</CardTitle>
              <p className="text-xs text-slate-500">{activeRole.description || "No description."}</p>
            </div>
            <div className="flex gap-2">
              {(activeRole.key === "team_lead" || activeRole.key === "agent") && (
                <ConfirmButton
                  action={boundReset}
                  label="Reset to defaults"
                  variant="outline"
                  size="sm"
                  confirmTitle={`Reset ${activeRole.name} permissions?`}
                  confirmBody="This restores the default permission matrix for this system role."
                />
              )}
              {!activeRole.is_system && (
                <ConfirmButton
                  action={async () => {
                    "use server";
                    await deleteRoleAction(activeRole.key);
                  }}
                  label="Delete role"
                  variant="danger"
                  size="sm"
                  confirmTitle={`Delete ${activeRole.name}?`}
                  confirmBody="Users must be reassigned to another role first. This cannot be undone."
                />
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isFullAccess(activeRole.key) ? (
              <div className="p-6 text-sm text-slate-500">
                {activeRole.name} always has full access to every module and action. This cannot be reduced.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Module</th>
                      {ACTIONS.map((a) => (
                        <th key={a} className="px-2 py-2 text-center">
                          {ACTION_LABELS[a]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {MODULES.map((m) => (
                      <tr key={m}>
                        <td className="px-4 py-2 font-medium text-slate-700">{MODULE_LABELS[m]}</td>
                        {ACTIONS.map((a) => {
                          const applicable = (MODULE_ACTIONS[m as ModuleKey] as ActionKey[]).includes(a);
                          if (!applicable) {
                            return (
                              <td key={a} className="px-2 py-2 text-center text-slate-200">
                                ·
                              </td>
                            );
                          }
                          return (
                            <td key={a} className="px-2 py-2 text-center">
                              <PermissionToggle role={activeRole.key} moduleKey={m} action={a} checked={grid[m][a]} />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PermissionToggle({
  role,
  moduleKey,
  action,
  checked,
}: {
  role: string;
  moduleKey: ModuleKey;
  action: ActionKey;
  checked: boolean;
}) {
  const formAction = async (formData: FormData) => {
    "use server";
    await updatePermissionAction(role, moduleKey, action, formData.get("allowed") === "true");
  };

  return (
    <form action={formAction} className="inline-flex">
      <input type="hidden" name="allowed" value={(!checked).toString()} />
      <button
        type="submit"
        aria-pressed={checked}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          checked ? "bg-[var(--brand-primary)]" : "bg-slate-200"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-4" : "translate-x-1"
          }`}
        />
      </button>
    </form>
  );
}
