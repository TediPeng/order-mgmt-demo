import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { readDbLite } from "@/lib/db";
import { can } from "@/lib/permissions";
import { servingLocalAgainstProduction } from "@/lib/production-guard";
import { maybeSweepPancakeSync } from "@/lib/pancake/sweep";
import { MODULES } from "@/lib/types";
import type { ModuleKey } from "@/lib/types";
import { cookies } from "next/headers";
import { AppShell } from "@/components/AppShell";
import { SIDEBAR_COOKIE } from "@/lib/ui-prefs";
import { CallSessionProvider } from "@/components/CallSessionProvider";
import { ShiftWatcher } from "@/components/ShiftWatcher";

import { todayInTz } from "@/lib/utils";
import { getActiveSession } from "@/lib/call-sessions";

/** The only authenticated route reachable while a password reset is pending. */
const CHANGE_PASSWORD_PATH = "/settings/password";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // A forced reset is a lockout, not a banner (Section 8): until the temporary
  // password is changed, every authenticated route redirects to the change-
  // password page. Enforced here rather than in middleware because the flag
  // lives in the database, which the edge runtime cannot reach.
  const pathname = (await headers()).get("x-pathname") || "";
  if (user!.must_change_password && !pathname.startsWith(CHANGE_PASSWORD_PATH)) {
    redirect(CHANGE_PASSWORD_PATH);
  }

  // Lite: the sidebar, the permission map and the notification bell need
  // roles, permissions and notifications — not the orders table, which on a
  // busy floor is tens of thousands of rows fetched to render a menu.
  const db = await readDbLite();
  // The two attendance sweeps that used to run here are gone. They closed a
  // forgotten shift and marked a missing day, and both only ever had work to do
  // because ROMA was where a shift began. Nobody times in here now, so they ran
  // on every request to find nothing -- and they wrote the whole database back
  // when they did find something.
  //
  // Throttled, fire-and-forget: drives Pancake retries/polling without
  // depending on the Vercel Cron frequency available on the current plan.
  maybeSweepPancakeSync();
  const access = {} as Record<ModuleKey, boolean>;
  for (const m of MODULES) {
    access[m] = can(user.role, m, "view", db.role_permissions);
  }
  const roleName = db.roles.find((r) => r.key === user.role)?.name || user.role;
  const notifications = db.notifications
    .filter((n) => n.recipient_id === user.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  // Seeded server-side so the call timer is already running on first paint after
  // a refresh, instead of flashing "no call" until the client fetch lands.
  const activeCallSession = await getActiveSession(user.id);

  // Read server-side so the sidebar renders at its saved width on first paint
  // rather than flashing open and snapping shut after hydration.
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "1";

  // The break warning watches from here, so it reaches whatever page the agent
  // is on. Everything it needs is already in `db` — this layout reads it on
  // every request — so app-wide costs no extra query.
  //
  // The end of shift is no longer watched. It used to raise a dialog after the
  // scheduled time out, which only worked while somebody was looking at the
  // screen; a shift is closed by sweepAutoTimeOuts now, whether anyone is
  // looking or not.
  const ownAttendance = db.attendance.find((a) => a.user_id === user.id && a.work_date === todayInTz());
  const onTheClock = Boolean(ownAttendance?.time_in && !ownAttendance.time_out);

  return (
    <CallSessionProvider initialSession={activeCallSession} serverNow={Date.now()}>
      <ShiftWatcher
        breakStart={ownAttendance?.break_start ?? null}
        breakEnd={ownAttendance?.break_end ?? null}
        allowanceMinutes={db.work_schedule.break_minutes}
        onTheClock={onTheClock}
        redirectTo={pathname || "/leads"}
      />
      <AppShell
        user={user}
        roleName={roleName}
        access={access}
        canImportRegularCustomers={can(user.role, "regular_customers", "create", db.role_permissions)}
        localAgainstProduction={servingLocalAgainstProduction()}
        notifications={notifications}
        initialCollapsed={collapsed}
      >
        {children}
      </AppShell>
    </CallSessionProvider>
  );
}
