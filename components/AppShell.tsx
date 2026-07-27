"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import type { AppNotification, ModuleKey, Profile } from "@/lib/types";

const REFRESH_INTERVAL_MS = 30000;

export function AppShell({
  user,
  roleName,
  access,
  notifications,
  children,
}: {
  user: Profile;
  roleName: string;
  access: Record<ModuleKey, boolean>;
  notifications: AppNotification[];
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const router = useRouter();

  // No Supabase/websocket backend here (JSON-file db), so "real-time" dashboard
  // stats, attendance widgets, and notifications (Section 1/6) are done via
  // periodic router.refresh() -- re-runs server components in place without a
  // full page reload or disturbing client-side state (e.g. an open modal).
  useEffect(() => {
    const id = setInterval(() => router.refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [router]);

  return (
    <div className="flex h-screen bg-slate-50">
      <div className="hidden lg:block">
        <Sidebar access={access} />
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <div className="relative z-50">
            <Sidebar access={access} />
          </div>
          <button
            className="absolute right-4 top-4 z-50 rounded-md bg-white p-1.5 shadow"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close menu"
          >
            <X className="h-5 w-5 text-slate-600" />
          </button>
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center border-b border-slate-200 bg-white lg:hidden">
          <button className="p-3 text-slate-600" onClick={() => setDrawerOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
        </div>
        <Topbar user={user} roleName={roleName} notifications={notifications} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
