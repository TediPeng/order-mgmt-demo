"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, KeyRound, LogOut, PanelLeft, User as UserIcon } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { logoutAction } from "@/lib/actions/auth";
import { Avatar } from "@/components/ui/Avatar";
import { NotificationBell } from "./NotificationBell";
import { displayUserName } from "@/lib/types";
import type { AppNotification, Profile } from "@/lib/types";

/**
 * Slim sticky header: sidebar toggle on the left, then the notification bell,
 * theme toggle and user menu on the right.
 *
 * The account controls live in a dropdown rather than sitting loose in the bar,
 * so the header stays one row tall at every width and Logout stops being a
 * button you can hit by accident.
 */
export function Topbar({
  user,
  roleName,
  notifications,
  onToggleSidebar,
}: {
  user: Profile;
  roleName: string;
  notifications: AppNotification[];
  onToggleSidebar: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <header
      /* z-40 outranks page-level sticky toolbars (the Leads filter bar is z-30):
         on a tie the later element in the DOM wins, which put that toolbar over
         the header and clipped the open user menu behind it. The menu's own
         z-index cannot fix that — it only orders siblings inside the header's
         own stacking context. Modals stay above at z-50. */
      className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between px-3 sm:px-4"
      style={{ background: "var(--header-bg)", borderBottom: "1px solid var(--header-border)" }}
    >
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label="Toggle sidebar"
        /* 44px on touch layouts, trimmed to 36px once there is a pointer. */
        className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-md text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] lg:h-9 lg:w-9"
      >
        <PanelLeft className="h-[18px] w-[18px]" />
      </button>

      <div className="flex items-center gap-1.5">
        <NotificationBell notifications={notifications} />
        <ThemeToggle current={user.theme_preference || "light"} />

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex cursor-pointer items-center gap-2 rounded-md py-1 pl-1 pr-2 transition-colors duration-150 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
          >
            <Avatar name={displayUserName(user)} src={user.avatar_url} size="sm" />
            <span className="hidden text-left sm:block">
              <span className="block text-control font-medium leading-tight text-slate-800">
                {displayUserName(user)}
              </span>
              <span className="block text-[11px] leading-tight text-slate-400">{roleName}</span>
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-40 mt-1 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
            >
              <div className="border-b border-slate-100 px-3 py-2.5">
                <p className="truncate text-control font-medium text-slate-800">{displayUserName(user)}</p>
                <p className="truncate text-[11px] text-slate-400">{user.email}</p>
                <span className="mt-1 inline-flex rounded-full bg-[var(--brand-primary-10)] px-2 py-0.5 text-[11px] font-medium text-[var(--brand-primary)]">
                  {roleName}
                </span>
              </div>
              <Link
                href="/attendance"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="flex cursor-pointer items-center gap-2 px-3 py-2 text-control text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              >
                <UserIcon className="h-4 w-4" /> My Attendance
              </Link>
              <Link
                href="/settings/password"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="flex cursor-pointer items-center gap-2 px-3 py-2 text-control text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              >
                <KeyRound className="h-4 w-4" /> Change Password
              </Link>
              <form action={logoutAction} className="border-t border-slate-100">
                <button
                  type="submit"
                  role="menuitem"
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-control text-red-600 hover:bg-red-50"
                >
                  <LogOut className="h-4 w-4" /> Logout
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
