import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { readDbLite, writeDb } from "@/lib/db";
import { can } from "@/lib/permissions";
import { sweepAutoAbsences } from "@/lib/attendance-sweep";
import { maybeSweepPancakeSync } from "@/lib/pancake/sweep";
import { MODULES } from "@/lib/types";
import type { ModuleKey } from "@/lib/types";
import { cookies } from "next/headers";
import { AppShell } from "@/components/AppShell";
import { SIDEBAR_COOKIE } from "@/lib/ui-prefs";
import { CallSessionProvider } from "@/components/CallSessionProvider";
import { ShiftWatcher } from "@/components/ShiftWatcher";
import { scheduledInstant } from "@/lib/attendance-logic";
import { todayInTz } from "@/lib/utils";
import { getActiveSession } from "@/lib/call-sessions";
import { listUpdateLogs } from "@/lib/update-logs";

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
  if (sweepAutoAbsences(db)) await writeDb(db);
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
  const releases = await listUpdateLogs({ publishedOnly: true });

  // The shift warnings watch from here, so they reach whatever page the agent is
  // on. Everything they need is already in `db` — this layout reads it on every
  // request — so app-wide costs no extra query.
  //
  // The end of shift is resolved to an instant here rather than in the browser:
  // scheduled_time_out is a Postgres `time` and arrives as "17:00:00", and the
  // company timezone is the one that decides what that means.
  const ownAttendance = db.attendance.find((a) => a.user_id === user.id && a.work_date === todayInTz());
  const onTheClock = Boolean(ownAttendance?.time_in && !ownAttendance.time_out);
  const ownScheduledTimeOut = (ownAttendance?.scheduled_time_out || db.work_schedule.work_end).slice(0, 5);
  const dutyEndsAt = onTheClock
    ? scheduledInstant(todayInTz(), ownScheduledTimeOut, db.work_schedule.timezone).toISOString()
    : null;

  return (
    <CallSessionProvider initialSession={activeCallSession} serverNow={Date.now()}>
      <ShiftWatcher
        breakStart={ownAttendance?.break_start ?? null}
        breakEnd={ownAttendance?.break_end ?? null}
        allowanceMinutes={db.work_schedule.break_minutes}
        dutyEndsAt={dutyEndsAt}
        scheduledTimeOut={ownScheduledTimeOut}
        onTheClock={onTheClock}
        redirectTo={pathname || "/leads"}
      />
      <AppShell
        user={user}
        roleName={roleName}
        access={access}
        notifications={notifications}
        releases={releases}
        initialCollapsed={collapsed}
      >
        {children}
      </AppShell>
    </CallSessionProvider>
  );
}
