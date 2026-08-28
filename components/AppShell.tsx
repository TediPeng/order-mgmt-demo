"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { Breadcrumb } from "./Breadcrumb";
import { UpdateLogsPanel } from "./UpdateLogsPanel";
import { APP_NAME, APP_VERSION } from "@/lib/version";
import { isFullAccess } from "@/lib/permissions";
import type { AppNotification, ModuleKey, Profile, UpdateLog } from "@/lib/types";

import { SIDEBAR_COOKIE, SIDEBAR_COOKIE_MAX_AGE } from "@/lib/ui-prefs";

const REFRESH_INTERVAL_MS = 60000;

export function AppShell({
  user,
  roleName,
  access,
  canImportRegularCustomers,
  workforceInPortal,
  notifications,
  releases,
  initialCollapsed,
  children,
}: {
  user: Profile;
  roleName: string;
  access: Record<ModuleKey, boolean>;
  /** regular_customers.create — an action grant, so it cannot be read off
   * `access`, which carries view only. */
  canImportRegularCustomers: boolean;
  /** Whether the company portal is where the floor keeps its own time and
   * roster. Decided on the server and carried through, because it reads
   * environment neither this component nor the sidebar can. */
  workforceInPortal: boolean;
  notifications: AppNotification[];
  releases: UpdateLog[];
  initialCollapsed: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const router = useRouter();

  // Agent Monitor is supervisory, so it is gated on the role rather than on the
  // attendance permission — that permission is what lets an agent see their own
  // record, and must not also expose everyone else's break timers. The page
  // enforces the same rule server-side; this only decides whether the link shows.
  const canMonitor = isFullAccess(user.role) || user.role === "team_lead";
  const canSeeRemainingLeads = isFullAccess(user.role);

  // No websocket backend, so "real-time" dashboard stats, attendance widgets and
  // notifications are refreshed by re-running the server components in place —
  // no full reload, and client state (an open modal, a running call timer) is
  // left undisturbed.
  //
  // Gated on tab visibility: a hidden tab keeps running its timers, and every
  // tick re-runs the whole server tree — one full readDb() each. Staff leave
  // this open all day behind other windows, so the old unconditional interval
  // spent most of its life refreshing pages nobody was looking at. A tick
  // skipped while hidden is remembered and fired the moment the tab comes
  // back, so returning to it still shows current data rather than waiting out
  // the rest of the interval.
  useEffect(() => {
    let missedWhileHidden = false;

    const id = setInterval(() => {
      if (document.hidden) {
        missedWhileHidden = true;
        return;
      }
      router.refresh();
    }, REFRESH_INTERVAL_MS);

    function onVisibilityChange() {
      if (document.hidden || !missedWhileHidden) return;
      missedWhileHidden = false;
      router.refresh();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router]);

  // Persisted in a cookie rather than localStorage so the server renders the
  // right width on first paint — reading it after hydration would flash the
  // sidebar open on every navigation. One year, and scoped to this browser.
  const toggleSidebar = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; samesite=lax`;
      return next;
    });
  }, []);

  // Below lg the sidebar is an overlay drawer, so the toggle opens that instead
  // of narrowing a rail nobody can see.
  const handleToggle = useCallback(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) toggleSidebar();
    else setDrawerOpen((v) => !v);
  }, [toggleSidebar]);

  useEffect(() => {
    if (!drawerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawerOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  return (
    <div className="flex h-screen" style={{ background: "var(--surface-muted)" }}>
      <div className="hidden lg:block">
        <Sidebar access={access} canMonitor={canMonitor} canSeeRemainingLeads={canSeeRemainingLeads}
          canImportRegularCustomers={canImportRegularCustomers} workforceInPortal={workforceInPortal} collapsed={collapsed} />
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden whitespace-normal">
          <button
            aria-label="Close menu"
            className="absolute inset-0 cursor-pointer bg-black/50"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="relative z-10">
            <Sidebar access={access} canMonitor={canMonitor} canSeeRemainingLeads={canSeeRemainingLeads}
          canImportRegularCustomers={canImportRegularCustomers} workforceInPortal={workforceInPortal} onNavigate={() => setDrawerOpen(false)} />
          </div>
          <button
            className="absolute right-4 top-4 z-10 cursor-pointer rounded-md bg-white p-1.5 shadow"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close menu"
          >
            <X className="h-5 w-5 text-slate-600" />
          </button>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} roleName={roleName} notifications={notifications} onToggleSidebar={handleToggle} />

        <div className="flex-1 overflow-y-auto">
          <Breadcrumb />
          {/* min-w-0 all the way down so a wide table scrolls inside its own
              container instead of stretching the page. */}
          <main className="mx-auto w-full min-w-0 max-w-screen-2xl p-4 md:p-6">{children}</main>

          <footer className="mx-auto flex w-full max-w-screen-2xl flex-wrap items-center gap-x-2 gap-y-1 px-4 pb-6 text-xs text-slate-400 md:px-6">
            <span>{APP_NAME}</span>
            <span aria-hidden>·</span>
            <span>Version {APP_VERSION}</span>
            <span aria-hidden>·</span>
            <UpdateLogsPanel releases={releases} />
          </footer>
        </div>
      </div>
    </div>
  );
}
