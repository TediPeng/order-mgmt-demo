import { redirect } from "next/navigation";
import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Label, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { createUserAction, toggleActiveAction, adminResetPasswordAction } from "@/lib/actions/users";
import { RoleSelect } from "@/components/RoleSelect";
import { TeamLeadSelect } from "@/components/TeamLeadSelect";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; created?: string; updated?: string; reset_pw?: string; reset_for?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = readDb();

  if (!can(user.role, "users", "view", db.role_permissions)) redirect("/dashboard");
  const canCreate = can(user.role, "users", "create", db.role_permissions);
  const canEdit = can(user.role, "users", "edit", db.role_permissions);
  const canDeactivate = can(user.role, "users", "delete", db.role_permissions);
  const canAssign = can(user.role, "users", "assign", db.role_permissions);

  const users = [...db.profiles].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const teamLeads = db.profiles.filter((p) => p.role === "team_lead" && p.is_active);
  const roleNameByKey = new Map(db.roles.map((r) => [r.key, r.name]));

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">User Management</h1>

      {sp.error && (
        <Alert kind="error" className="mb-4">
          {sp.error}
        </Alert>
      )}
      {sp.created && (
        <Alert kind="success" className="mb-4">
          User created successfully.
        </Alert>
      )}
      {sp.updated && (
        <Alert kind="success" className="mb-4">
          User updated.
        </Alert>
      )}
      {sp.reset_pw && (
        <Alert kind="success" className="mb-4">
          Temporary password for <strong>{sp.reset_for}</strong>: <code className="font-mono">{sp.reset_pw}</code>{" "}
          (demo mode — normally emailed). They will be asked to change it on next login.
        </Alert>
      )}

      {canCreate && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Create new user</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createUserAction} className="grid grid-cols-1 gap-4 sm:grid-cols-6">
              <div>
                <Label htmlFor="username">Username</Label>
                <Input id="username" name="username" required />
              </div>
              <div>
                <Label htmlFor="full_name">Full name</Label>
                <Input id="full_name" name="full_name" required />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required />
              </div>
              <div>
                <Label htmlFor="role">Role</Label>
                <Select id="role" name="role" defaultValue="agent">
                  {db.roles.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="team_lead_id">Team lead (if Agent)</Label>
                <Select id="team_lead_id" name="team_lead_id" defaultValue="">
                  <option value="">— Unassigned —</option>
                  {teamLeads.map((tl) => (
                    <option key={tl.id} value={tl.id}>
                      {tl.full_name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="temp_password">Temporary password</Label>
                <Input id="temp_password" name="temp_password" minLength={8} required />
              </div>
              <div className="sm:col-span-6">
                <Button type="submit">Create User</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Username</th>
              <th className="px-4 py-3">Full Name</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Team Lead</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => {
              const boundToggle = async () => {
                "use server";
                await toggleActiveAction(u.id);
              };
              const boundReset = async () => {
                "use server";
                await adminResetPasswordAction(u.id);
              };
              return (
                <tr key={u.id}>
                  <td className="px-4 py-3 font-medium text-slate-800">{u.username}</td>
                  <td className="px-4 py-3">{u.full_name}</td>
                  <td className="px-4 py-3">
                    {isFullAccess(u.role) ? (
                      <Badge className="bg-[var(--brand-primary-10)] text-[var(--brand-primary)]">
                        {roleNameByKey.get(u.role) || u.role}
                      </Badge>
                    ) : canEdit ? (
                      <RoleSelect userId={u.id} role={u.role} roles={db.roles} />
                    ) : (
                      <Badge>{roleNameByKey.get(u.role) || u.role}</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {u.role === "agent" && canAssign ? (
                      <TeamLeadSelect userId={u.id} teamLeadId={u.team_lead_id} teamLeads={teamLeads} />
                    ) : u.role === "agent" ? (
                      teamLeads.find((tl) => tl.id === u.team_lead_id)?.full_name || "—"
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {u.is_active ? (
                      <Badge className="bg-green-100 text-green-700">Active</Badge>
                    ) : (
                      <Badge className="bg-slate-200 text-slate-600">Deactivated</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(u.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {canEdit && (
                        <ConfirmButton
                          action={boundReset}
                          label="Reset PW"
                          variant="outline"
                          size="sm"
                          confirmTitle="Reset this user's password?"
                          confirmBody={`A new temporary password will be generated for ${u.username}.`}
                        />
                      )}
                      {canDeactivate && u.id !== user.id && (
                        <ConfirmButton
                          action={boundToggle}
                          label={u.is_active ? "Deactivate" : "Reactivate"}
                          variant={u.is_active ? "danger" : "secondary"}
                          size="sm"
                          confirmTitle={`${u.is_active ? "Deactivate" : "Reactivate"} ${u.username}?`}
                          confirmBody={
                            u.is_active
                              ? "They will immediately be unable to log in."
                              : "They will be able to log in again."
                          }
                        />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
