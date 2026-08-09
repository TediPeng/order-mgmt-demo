import Link from "next/link";
import { redirect } from "next/navigation";
import { readDb } from "@/lib/db";
import { accountCreatorIds } from "@/lib/audit-log";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { displayUserName } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { toggleActiveAction, adminResetPasswordAction } from "@/lib/actions/users";
import { CreateUserForm } from "@/components/CreateUserForm";
import { RoleSelect } from "@/components/RoleSelect";
import { TeamLeadSelect } from "@/components/TeamLeadSelect";

/**
 * Full Name and Username are frozen to the left edge: the table is 1500px wide
 * and scrolling right to reach Role or Last Time-In used to take both away, so
 * a row became a line of values with nobody's name on it.
 *
 * The widths are fixed rather than automatic because Username's `left` offset
 * has to equal Full Name's actual width — auto column widths would drift and
 * leave a gap or an overlap. Header cells sit above body cells (z-20 vs z-10)
 * so the frozen columns do not paint over their own headings.
 */
const FROZEN_COLUMN = {
  full_name: "sticky left-0 w-[14rem] min-w-[14rem]",
  username: "sticky left-[14rem] w-[10rem] min-w-[10rem]",
} as const;

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    created?: string;
    updated?: string;
    reset_pw?: string;
    reset_for?: string;
    temp_pw?: string;
    temp_for?: string;
    mail?: string;
    deleted_account?: string;
    handling?: string;
    show_deleted?: string;
    role?: string;
    sort?: string;
    dir?: string;
    q?: string;
  }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDb();

  if (!can(user.role, "users", "view", db.role_permissions)) redirect("/dashboard");
  const canCreate = can(user.role, "users", "create", db.role_permissions);
  const canEdit = can(user.role, "users", "edit", db.role_permissions);
  const canDeactivate = can(user.role, "users", "delete", db.role_permissions);
  const canAssign = can(user.role, "users", "assign", db.role_permissions);
  const canPermanentlyDelete = isFullAccess(user.role);

  // Deleted accounts are tombstones, not people: anonymized rows kept only so
  // the foreign keys pointing at them still resolve and history can render
  // "Deleted User". They accumulate forever and never need acting on, so they
  // are out of the list by default rather than padding it above the live
  // accounts. Hidden, not gone -- one click still shows them, because an
  // account that silently vanishes from User Management is worse than a
  // cluttered table.
  const showDeleted = sp.show_deleted === "1";
  const allProfiles = [...db.profiles].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const deletedCount = allProfiles.filter((p) => p.is_deleted).length;
  const notDeleted = showDeleted ? allProfiles : allProfiles.filter((p) => !p.is_deleted);

  // Search runs BEFORE the role counts, so a tab still promises exactly the
  // rows clicking it produces. Everything someone might have in front of them
  // is searchable — a name, the username on a ticket, the email they were
  // invited on, the call name heard on the floor, or a phone number.
  const query = (sp.q || "").trim();
  const needle = query.toLowerCase();
  const visible = needle
    ? notDeleted.filter((p) =>
        [p.full_name, p.username, p.email, p.call_name, p.contact_number]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(needle))
      )
    : notDeleted;

  // Role filter. Counts come from `visible` rather than every profile, so a
  // tab's number always matches how many rows clicking it produces -- a count
  // that included hidden tombstones would be a promise the table breaks.
  const roleFilter = sp.role || "";
  const countForRole = (key: string) => visible.filter((p) => p.role === key).length;
  const users = roleFilter ? visible.filter((p) => p.role === roleFilter) : visible;

  // Role, deleted and sort all live in the URL, so every control builds its
  // link from the current state of the other two. Written once rather than per
  // control: three controls each hand-assembling the others' params is three
  // chances to drop one, and dropping one reads as the page losing your place.
  const state = {
    role: roleFilter,
    show_deleted: showDeleted ? "1" : "",
    sort: sp.sort || "",
    dir: sp.dir || "",
    q: query,
  };
  const hrefWith = (overrides: Partial<typeof state>) => {
    const params = new URLSearchParams();
    Object.entries({ ...state, ...overrides }).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    const q = params.toString();
    return q ? `/users?${q}` : "/users";
  };
  const filterHref = (role: string) => hrefWith({ role });
  const deletedToggleHref = () => hrefWith({ show_deleted: showDeleted ? "" : "1" });
  const teamLeads = db.profiles.filter((p) => p.role === "team_lead" && p.is_active && !p.is_deleted);
  const roleNameByKey = new Map(db.roles.map((r) => [r.key, r.name]));
  const nameById = new Map(db.profiles.map((p) => [p.id, displayUserName(p)]));

  // Last time-in is derived from attendance rather than stored on the profile,
  // so it can never disagree with the attendance record itself.
  const lastTimeInByUser = new Map<string, string>();
  for (const a of db.attendance) {
    if (!a.time_in) continue;
    const current = lastTimeInByUser.get(a.user_id);
    if (!current || a.time_in > current) lastTimeInByUser.set(a.user_id, a.time_in);
  }

  // Who created each account, read from the audit trail (there is no
  // created_by column on profiles).
  const creatorIds = await accountCreatorIds();
  const createdByUser = new Map(
    Array.from(creatorIds, ([createdId, creatorId]) => [createdId, nameById.get(creatorId) || "Unknown"] as const)
  );

  // Sorting. Sorted here rather than in the query because several of these
  // columns are not columns at all -- Team Lead, Created By and Last Time-In
  // are resolved from other tables above, and sorting by what is displayed is
  // the only behaviour that would not look broken.
  const sortKey = sp.sort || "created_at";
  const dir = sp.dir === "desc" ? -1 : 1;

  const sortValue = (u: (typeof users)[number]): string | number | null => {
    switch (sortKey) {
      case "full_name":
        return displayUserName(u).toLowerCase();
      case "username":
        return u.username.toLowerCase();
      case "email":
        return u.is_deleted ? null : u.email.toLowerCase();
      case "call_name":
        return u.call_name?.toLowerCase() || null;
      case "role":
        return (roleNameByKey.get(u.role) || u.role).toLowerCase();
      case "team_lead":
        return u.team_lead_id ? nameById.get(u.team_lead_id)?.toLowerCase() || null : null;
      case "contact":
        return u.contact_number || null;
      case "permission_profile":
        return u.permission_profile?.toLowerCase() || null;
      case "status":
        // Ordered by how much attention the account wants, not alphabetically:
        // "Active" before "Deleted" is a coincidence of spelling, not a rank.
        return u.is_deleted ? 2 : u.is_active ? 0 : 1;
      case "created_by":
        return createdByUser.get(u.id)?.toLowerCase() || null;
      case "last_login":
        return u.last_login_at || null;
      case "last_time_in":
        return lastTimeInByUser.get(u.id) || null;
      default:
        return u.created_at;
    }
  };

  const sorted = [...users].sort((a, b) => {
    const av = sortValue(a);
    const bv = sortValue(b);
    // Blanks always sink, whichever way the column is pointing. An agent with
    // no last login is not "the earliest login" — it is an absence, and
    // floating those to the top would bury what was actually asked for.
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (typeof av === "string" && typeof bv === "string") return dir * av.localeCompare(bv);
    return dir * ((av as number) - (bv as number));
  });

  const sortHref = (key: string) => hrefWith({ sort: key, dir: sortKey === key && dir === 1 ? "desc" : "asc" });
  const caret = (key: string) => (sortKey !== key ? "" : dir === 1 ? " ↑" : " ↓");

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-page-title text-slate-900">User Management</h1>
        {deletedCount > 0 && (
          <Link href={deletedToggleHref()} className="text-xs font-medium text-[var(--brand-primary)] hover:underline">
            {showDeleted
              ? `Hide ${deletedCount} deleted account${deletedCount === 1 ? "" : "s"}`
              : `Show ${deletedCount} deleted account${deletedCount === 1 ? "" : "s"}`}
          </Link>
        )}
      </div>

      {sp.error && (
        <Alert kind="error" className="mb-4">
          {sp.error}
        </Alert>
      )}
      {sp.temp_pw && (
        <Alert kind="warning" className="mb-4">
          Temporary password for <strong>{sp.temp_for}</strong>:{" "}
          <code className="rounded bg-white/60 px-1.5 py-0.5 font-mono">{sp.temp_pw}</code>
          <span className="mt-1 block text-xs">
            Shown once only — copy it now. They must change it before they can use the system.
          </span>
          {/* The password stays on screen whatever happened to the email, so
              the Administrator is never left without a way to hand it over. */}
          {sp.mail === "sent" && (
            <span className="mt-1 block text-xs">A copy has been emailed to them.</span>
          )}
          {sp.mail === "failed" && (
            <span className="mt-1 block text-xs font-medium">
              The welcome email could not be sent — pass this password on yourself.
            </span>
          )}
        </Alert>
      )}
      {sp.created && !sp.temp_pw && (
        <Alert kind="success" className="mb-4">
          User created successfully.
        </Alert>
      )}
      {sp.updated && (
        <Alert kind="success" className="mb-4">
          User updated.
        </Alert>
      )}
      {sp.deleted_account && (
        <Alert kind="success" className="mb-4">
          Account <strong>{sp.deleted_account}</strong>{" "}
          {sp.handling === "anonymized"
            ? "was anonymized — its records are preserved and now show as “Deleted User”."
            : "was permanently deleted."}
        </Alert>
      )}
      {sp.reset_pw && (
        <Alert kind="warning" className="mb-4">
          Temporary password for <strong>{sp.reset_for}</strong>:{" "}
          <code className="rounded bg-white/60 px-1.5 py-0.5 font-mono">{sp.reset_pw}</code>
          <span className="mt-1 block text-xs">Shown once only. They must change it on next login.</span>
        </Alert>
      )}

      {canCreate && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Create new user</CardTitle>
          </CardHeader>
          <CardContent>
            <CreateUserForm
              roles={db.roles.map((r) => ({ key: r.key, name: r.name }))}
              teamLeads={teamLeads.map((tl) => ({ id: tl.id, full_name: tl.full_name }))}
              takenUsernames={db.profiles.map((p) => p.username)}
            />
          </CardContent>
        </Card>
      )}

      {/* Role filter, directly above the rows it governs. Every role in the
          database gets a tab rather than a hard-coded three, so a custom role
          created in Settings is filterable the day it exists. Roles with
          nobody in them are dropped — a tab that always yields an empty table
          is noise. */}
      {/* A GET form, so a search is a plain URL: shareable, bookmarkable, and
          survivable by the back button. The other controls travel as hidden
          fields rather than being rebuilt, so searching never silently drops
          the role tab or the sort you were on. */}
      <form className="mb-3 flex flex-wrap items-center gap-2">
        {Object.entries(state)
          .filter(([key, value]) => key !== "q" && value)
          .map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
        <Input
          name="q"
          defaultValue={query}
          placeholder="Search name, username, email, call name or contact"
          aria-label="Search users"
          className="w-full sm:w-96"
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
        {query && (
          <Link href={hrefWith({ q: "" })} className="text-xs font-medium text-[var(--brand-primary)] hover:underline">
            Clear
          </Link>
        )}
      </form>

      {query && (
        <p className="mb-3 text-xs text-slate-500">
          {visible.length} account{visible.length === 1 ? "" : "s"} matching{" "}
          <span className="font-medium text-slate-700">{query}</span>
          {!showDeleted && deletedCount > 0 ? " (deleted accounts are hidden)" : ""}
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link
          href={filterHref("")}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            roleFilter === ""
              ? "border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white"
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
          )}
        >
          All <span className="tabular-nums">{visible.length}</span>
        </Link>
        {db.roles
          .filter((r) => countForRole(r.key) > 0)
          .map((r) => (
            <Link
              key={r.key}
              href={filterHref(r.key)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                roleFilter === r.key
                  ? "border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              )}
            >
              {r.name} <span className="tabular-nums">{countForRole(r.key)}</span>
            </Link>
          ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[1500px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            {/* Headers stay on one line. Squeezed into an even share of the
                table they otherwise stack ("Call" / "Name"), which reads as a
                different set of columns than it is. */}
            {/* Every column is sortable except Actions, which holds buttons
                rather than a value. The arrow marks the active column, so the
                order on screen is never unexplained. */}
            <tr className="whitespace-nowrap">
              {(
                [
                  ["full_name", "Full Name"],
                  ["username", "Username"],
                  ["email", "Email"],
                  ["call_name", "Call Name"],
                  ["role", "Role"],
                  ["team_lead", "Team Lead"],
                  ["contact", "Contact"],
                  ["permission_profile", "Permission Profile"],
                  ["status", "Status"],
                  ["created_at", "Created"],
                  ["created_by", "Created By"],
                  ["last_login", "Last Login"],
                  ["last_time_in", "Last Time-In"],
                ] as const
              ).map(([key, label]) => (
                <th
                  key={key}
                  className={cn(
                    "px-4 py-3",
                    // The header's own opaque background, so scrolled columns
                    // pass underneath rather than through.
                    FROZEN_COLUMN[key as keyof typeof FROZEN_COLUMN] && "z-20 bg-slate-50",
                    FROZEN_COLUMN[key as keyof typeof FROZEN_COLUMN],
                    key === "username" && "border-r border-slate-200"
                  )}
                >
                  <Link
                    href={sortHref(key)}
                    className={cn(
                      "hover:text-slate-700",
                      sortKey === key && "font-semibold text-[var(--brand-primary)]"
                    )}
                  >
                    {label}
                    {caret(key)}
                  </Link>
                </th>
              ))}
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map((u) => {
              const boundToggle = async () => {
                "use server";
                await toggleActiveAction(u.id);
              };
              const boundReset = async () => {
                "use server";
                await adminResetPasswordAction(u.id);
              };
              const lastTimeIn = lastTimeInByUser.get(u.id);
              // The row carries an OPAQUE background so the two frozen columns
              // can inherit it. A translucent one would let the scrolling
              // columns show through them.
              return (
                <tr key={u.id} className={u.is_deleted ? "bg-slate-50 text-slate-400" : "bg-white"}>
                  <td className={cn("px-4 py-3 z-10 bg-inherit", FROZEN_COLUMN.full_name)}>
                    <span className="flex items-center gap-2">
                      <Avatar name={displayUserName(u)} src={u.avatar_url} size="sm" />
                      <span className={u.is_deleted ? "italic" : undefined}>{displayUserName(u)}</span>
                    </span>
                  </td>
                  <td
                    className={cn(
                      "px-4 py-3 z-10 font-medium text-slate-800",
                      "border-r border-slate-200 bg-inherit",
                      FROZEN_COLUMN.username
                    )}
                  >
                    {u.username}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{u.is_deleted ? "—" : u.email}</td>
                  <td className="px-4 py-3 text-slate-500">{u.call_name || "—"}</td>
                  <td className="px-4 py-3">
                    {u.is_deleted || isFullAccess(u.role) ? (
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
                    {u.is_deleted ? (
                      "—"
                    ) : u.role === "agent" && canAssign ? (
                      <TeamLeadSelect userId={u.id} teamLeadId={u.team_lead_id} teamLeads={teamLeads} />
                    ) : u.role === "agent" ? (
                      teamLeads.find((tl) => tl.id === u.team_lead_id)?.full_name || "—"
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{u.contact_number || "—"}</td>
                  <td className="px-4 py-3 text-slate-500">{u.permission_profile || "—"}</td>
                  <td className="px-4 py-3">
                    {u.is_deleted ? (
                      <Badge className="bg-slate-200 text-slate-600">Deleted</Badge>
                    ) : u.is_active ? (
                      <Badge className="bg-green-100 text-green-700">Active</Badge>
                    ) : (
                      <Badge className="bg-slate-200 text-slate-600">Deactivated</Badge>
                    )}
                  </td>
                  {/* Dates never wrap. "Aug 7, 2026, 3:15 PM" broken over four
                      lines set the height of every row in the table, including
                      the dozen cells that had one short word in them. */}
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatDate(u.created_at)}</td>
                  <td className="px-4 py-3 text-slate-500">{createdByUser.get(u.id) || "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                    {u.last_login_at ? formatDateTime(u.last_login_at) : "Never"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                    {lastTimeIn ? formatDateTime(lastTimeIn) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {canEdit && !u.is_deleted && (
                        <ConfirmButton
                          action={boundReset}
                          label="Reset PW"
                          variant="outline"
                          size="sm"
                          confirmTitle="Reset this user's password?"
                          confirmBody={`A new random temporary password will be generated for ${u.username}.`}
                        />
                      )}
                      {canDeactivate && u.id !== user.id && !u.is_deleted && (
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
                      {canPermanentlyDelete && u.id !== user.id && !u.is_deleted && (
                        <Link
                          href={`/users/${u.id}/delete`}
                          className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                        >
                          Delete…
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {/* An empty table with no word in it reads as broken rather than
                as "nothing matched". */}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={14} className="px-4 py-10 text-center text-slate-400">
                  {query ? (
                    <>
                      No account matches <span className="font-medium text-slate-500">{query}</span>
                      {roleFilter ? " in this role" : ""}.{" "}
                      <Link href={hrefWith({ q: "" })} className="text-[var(--brand-primary)] hover:underline">
                        Clear the search
                      </Link>
                      .
                    </>
                  ) : (
                    "No accounts to show."
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
