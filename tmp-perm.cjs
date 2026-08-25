const fs = require('fs');
const rd = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const wr = (f, s) => fs.writeFileSync(f, s);
let n = 0;
const must = (f, s, before, after) => {
  if (!s.includes(before)) throw new Error(`anchor missing in ${f}: ${before.slice(0, 60)}`);
  n++;
  return s.replace(before, after);
};

// 1. the grant itself — `assign` is already in the action_key enum (schedules,
//    users and regular_customers use it), so this needs no migration.
{
  const f = 'lib/permissions.ts';
  let s = rd(f);
  s = must(f, s, '  orders: ["view", "create", "edit", "delete", "upload", "export"],',
`  // "assign" is who a lead BELONGS to, and is separate from "edit" on purpose.
  // Editing a lead changes the sale; assigning changes whose queue it is in and
  // whose numbers it lands on, which is a supervisor's decision rather than a
  // correction. It gates the Transfer Leads screen and the Agent field on a
  // single lead — the same act at two scales, so the same grant.
  //
  // Off by default for every role but full access: SYSTEM_ROLE_DEFAULTS does not
  // list it, so a Team Lead has to be given it deliberately.
  orders: ["view", "create", "edit", "delete", "upload", "export", "assign"],`);
  wr(f, s);
}

// 2. one helper both scales read
{
  const f = 'lib/order-access.ts';
  let s = rd(f);
  s = must(f, s, 'export function allowedAssigneeIds(user: Profile, db: DbShape): string[] {',
`/**
 * May this person change whose lead it is?
 *
 * Both the Transfer Leads screen and the Agent field on a single lead ask this,
 * because they are the same act at two scales — and gating the bulk one more
 * loosely than the single one would be the wrong way round.
 *
 * can() answers true for full access whatever the matrix says, so this is a
 * widening of the old isFullAccess check rather than a change to it: nobody who
 * could reassign before has lost anything, and a Team Lead can now be granted
 * it in Roles & Permissions.
 */
export function canAssignLeads(user: Profile, db: DbShape): boolean {
  return can(user.role, "orders", "assign", db.role_permissions);
}

export function allowedAssigneeIds(user: Profile, db: DbShape): string[] {`);
  if (!s.includes('import { can')) {
    s = must(f, s, 'import { isFullAccess } from "@/lib/permissions";', 'import { can, isFullAccess } from "@/lib/permissions";');
  }
  wr(f, s);
}

// 3. the single-lead path
{
  const f = 'lib/actions/leads.ts';
  let s = rd(f);
  s = must(f, s, '  raw.agent_id = isFullAccess(user.role) ? requestedAgentId : order.agent_id;',
    '  raw.agent_id = canAssignLeads(user, db) ? requestedAgentId : order.agent_id;');
  s = must(f, s, '  const isReassignment = isFullAccess(user.role) && data.agent_id !== before.agent_id;',
    '  const isReassignment = canAssignLeads(user, db) && data.agent_id !== before.agent_id;');
  s = must(f, s, 'import { orderInScope, allowedAssigneeIds } from "@/lib/order-access";',
    'import { orderInScope, allowedAssigneeIds, canAssignLeads } from "@/lib/order-access";');
  wr(f, s);
}

// 4. the forms
for (const [f, before, after] of [
  ['app/(app)/leads/new/page.tsx', '  const canReassign = isFullAccess(user.role);', '  const canReassign = canAssignLeads(user, db);'],
  ['app/(app)/leads/[id]/page.tsx', '  const canReassign = isFullAccess(user.role) && !locked;', '  const canReassign = canAssignLeads(user, db) && !locked;'],
]) {
  let s = rd(f);
  s = must(f, s, before, after);
  if (!s.includes('canAssignLeads')) throw new Error('replace failed');
  s = s.replace(/import \{ orderInScope \} from "@\/lib\/order-access";/, 'import { orderInScope, canAssignLeads } from "@/lib/order-access";');
  if (!s.includes('canAssignLeads } from "@/lib/order-access"') && !s.includes('canAssignLeads,')) {
    s = s.replace(/^(import .*\n)/, `$1import { canAssignLeads } from "@/lib/order-access";\n`);
  }
  wr(f, s);
}

// 5. the transfer surfaces
for (const [f, before, after] of [
  ['app/api/leads/transfer/route.ts',
   '  if (!isFullAccess(user.role) || !can(user.role, "orders", "edit", db.role_permissions)) {\n    return NextResponse.json({ ok: false, error: "Only Administrators and Management can transfer leads." }, { status: 403 });',
   '  if (!canAssignLeads(user, db)) {\n    return NextResponse.json({ ok: false, error: "You do not have permission to transfer leads." }, { status: 403 });'],
  ['app/api/leads/lookup/route.ts',
   '  if (!isFullAccess(user.role) || !can(user.role, "orders", "edit", db.role_permissions)) {\n    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });',
   '  if (!canAssignLeads(user, db)) {\n    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });'],
]) {
  let s = rd(f);
  s = must(f, s, before, after);
  s = s.replace('import { can, isFullAccess } from "@/lib/permissions";', 'import { canAssignLeads } from "@/lib/order-access";');
  wr(f, s);
}

console.log(`patched ${n} anchors`);
