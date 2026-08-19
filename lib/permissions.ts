import type { ActionKey, ModuleKey, Role, RolePermission } from "./types";
import { ACTIONS, MODULES } from "./types";

export { MODULES, ACTIONS };

export const MODULE_LABELS: Record<ModuleKey, string> = {
  dashboard: "Dashboard",
  orders: "Leads",
  products: "Products",
  call_logs: "Call Logs",
  performance: "Performance",
  ranking: "Agent Ranking",
  attendance: "Attendance",
  leave: "Leave Requests",
  schedules: "Schedule",
  disciplinary: "Disciplinary Actions",
  users: "Users",
  roles: "Roles & Permissions",
  reports: "Reports",
  audit_logs: "Audit Logs",
  settings: "System Settings",
  integrations: "Integrations (Pancake POS)",
  file_uploads: "File Uploads",
  regular_customers: "Regular Customers",
};

export const ACTION_LABELS: Record<ActionKey, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  upload: "Upload",
  download: "Download",
  export: "Export",
  approve: "Approve",
  assign: "Assign",
  manage: "Manage",
};

// Only the actions that are meaningful per module are shown in the matrix UI.
export const MODULE_ACTIONS: Record<ModuleKey, ActionKey[]> = {
  dashboard: ["view"],
  orders: ["view", "create", "edit", "delete", "upload", "export"],
  products: ["view", "create", "edit", "delete"],
  call_logs: ["view", "upload", "download", "delete", "export"],
  performance: ["view", "export"],
  ranking: ["view", "export"],
  attendance: ["view", "create", "edit", "export", "approve"],
  leave: ["view", "create", "approve", "export"],
  schedules: ["view", "create", "edit", "delete", "assign", "export"],
  disciplinary: ["view", "manage"],
  users: ["view", "create", "edit", "delete", "assign"],
  roles: ["view", "create", "edit", "manage"],
  reports: ["view", "export"],
  audit_logs: ["view", "export"],
  settings: ["view", "manage"],
  // Administrator-only by default: no team_lead/agent grants below, so only
  // full-access roles (or an explicit matrix grant) can see/manage the
  // Pancake POS integration settings, manual sync/retry, and sync logs.
  integrations: ["view", "manage"],
  file_uploads: ["view", "upload", "download"],
  // "create" is deliberately its own grant, separate from orders.create:
  // adding a Regular Customer is not adding a lead. It covers both the Add
  // Regular Customer button and tagging an existing lead's customer as one.
  //
  // "assign" is the Share grant, and is separate from "edit" on purpose: editing
  // a customer changes what the record says, sharing changes who can see a
  // person's name, number and address. The second is a disclosure, not an edit,
  // and an agent trusted with one is not automatically trusted with the other.
  regular_customers: ["view", "create", "edit", "assign", "manage"],
};

type Grant = [ModuleKey, ActionKey];

/** "administrator" always bypasses permission checks (full system access) and
 * is never stored in role_permissions. Team Lead and Agent access is entirely
 * permission-driven through the roles matrix. */
export function isFullAccess(role: Role): boolean {
  return role === "administrator";
}

const TEAM_LEAD_DEFAULTS: Grant[] = [
  ["dashboard", "view"],
  ["orders", "view"],
  ["orders", "create"],
  ["orders", "edit"],
  ["orders", "export"],
  ["products", "view"],
  ["products", "create"],
  ["products", "edit"],
  ["products", "delete"],
  ["call_logs", "view"],
  ["call_logs", "upload"],
  ["call_logs", "download"],
  ["call_logs", "export"],
  ["performance", "view"],
  ["performance", "export"],
  ["ranking", "view"],
  ["attendance", "view"],
  ["attendance", "create"],
  ["attendance", "edit"],
  ["attendance", "export"],
  ["attendance", "approve"],
  ["leave", "view"],
  ["leave", "approve"],
  // Section 2: Team Lead sees (but cannot create/edit) their team's schedules
  // and disciplinary records by default; Management can grant more via the matrix.
  ["schedules", "view"],
  ["disciplinary", "view"],
  ["audit_logs", "view"],
  ["reports", "view"],
  ["reports", "export"],
  ["file_uploads", "view"],
  ["file_uploads", "upload"],
  ["regular_customers", "view"],
  ["regular_customers", "create"],
];

const AGENT_DEFAULTS: Grant[] = [
  ["dashboard", "view"],
  ["orders", "view"],
  ["orders", "create"],
  ["orders", "edit"],
  ["call_logs", "upload"],
  ["performance", "view"],
  // Section 0.7: agents can see the team ranking chart by default (an
  // intentional exception to "own data only", standard for sales floors);
  // Management can flip this off per-role in Settings > Roles & Permissions.
  ["ranking", "view"],
  ["attendance", "view"],
  ["leave", "view"],
  ["leave", "create"],
  // Agents see their own schedule and disciplinary history only -- row
  // scoping happens in lib/schedule-access.ts, same pattern as orders/leads.
  ["schedules", "view"],
  ["disciplinary", "view"],
  ["file_uploads", "view"],
  ["file_uploads", "upload"],
  // Regular Customers are the agent's OWN repeat buyers: they keep their own
  // list and may add to it, but they cannot untag one back into Leads
  // ("manage" stays with Team Lead/Administrator), and row scoping in
  // app/(app)/regular-customers/page.tsx limits the list to their own.
  ["regular_customers", "view"],
  ["regular_customers", "create"],
];

export const SYSTEM_ROLE_DEFAULTS: Record<"team_lead" | "agent", Grant[]> = {
  team_lead: TEAM_LEAD_DEFAULTS,
  agent: AGENT_DEFAULTS,
};

export function defaultAllowed(role: string, moduleKey: ModuleKey, action: ActionKey): boolean {
  if (isFullAccess(role)) return true;
  const grants = SYSTEM_ROLE_DEFAULTS[role as "team_lead" | "agent"];
  if (!grants) return false; // custom roles start with nothing granted
  return grants.some(([m, a]) => m === moduleKey && a === action);
}

export function can(role: Role, moduleKey: ModuleKey, action: ActionKey, rolePermissions: RolePermission[]): boolean {
  if (isFullAccess(role)) return true;
  const row = rolePermissions.find((r) => r.role === role && r.module === moduleKey && r.action === action);
  if (row) return row.allowed;
  return defaultAllowed(role, moduleKey, action);
}

export function canAny(role: Role, moduleKey: ModuleKey, actions: ActionKey[], rolePermissions: RolePermission[]): boolean {
  return actions.some((a) => can(role, moduleKey, a, rolePermissions));
}

export function permissionGrid(role: string, rolePermissions: RolePermission[]): Record<ModuleKey, Record<ActionKey, boolean>> {
  const grid = {} as Record<ModuleKey, Record<ActionKey, boolean>>;
  for (const m of MODULES) {
    grid[m] = {} as Record<ActionKey, boolean>;
    for (const a of ACTIONS) {
      grid[m][a] = can(role, m, a, rolePermissions);
    }
  }
  return grid;
}

export function buildDefaultRows(
  role: "team_lead" | "agent",
  uuidFn: () => string,
  nowFn: () => string
): RolePermission[] {
  const rows: RolePermission[] = [];
  for (const m of MODULES) {
    for (const a of MODULE_ACTIONS[m]) {
      rows.push({
        id: uuidFn(),
        role,
        module: m,
        action: a,
        allowed: defaultAllowed(role, m, a),
        updated_by: null,
        updated_at: nowFn(),
      });
    }
  }
  return rows;
}
