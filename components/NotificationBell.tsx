"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Bell } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import { markNotificationReadAction, markAllNotificationsReadAction } from "@/lib/actions/notifications";
import type { AppNotification } from "@/lib/types";

export function NotificationBell({ notifications }: { notifications: AppNotification[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const unread = notifications.filter((n) => !n.is_read);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unread.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-80 rounded-lg border border-slate-200 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
              <p className="text-sm font-semibold text-slate-800">Notifications</p>
              {unread.length > 0 && (
                <button
                  disabled={pending}
                  onClick={() => startTransition(() => markAllNotificationsReadAction())}
                  className="text-xs font-medium text-[var(--brand-primary)] hover:underline disabled:opacity-50"
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {notifications.slice(0, 8).map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    if (!n.is_read) startTransition(() => markNotificationReadAction(n.id));
                    setOpen(false);
                    if (n.link) window.location.href = n.link;
                  }}
                  className={`block w-full border-b border-slate-50 px-4 py-3 text-left text-sm last:border-0 hover:bg-slate-50 ${
                    !n.is_read ? "bg-[var(--brand-primary-10)]" : ""
                  }`}
                >
                  <p className="font-medium text-slate-800">{n.title}</p>
                  {n.body && <p className="mt-0.5 text-xs text-slate-500">{n.body}</p>}
                  <p className="mt-1 text-[11px] text-slate-400">{formatDateTime(n.created_at)}</p>
                </button>
              ))}
              {notifications.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-slate-400">You&apos;re all caught up.</p>
              )}
            </div>
            <div className="border-t border-slate-100 px-4 py-2 text-center">
              <Link
                href="/notifications"
                onClick={() => setOpen(false)}
                className="text-xs font-medium text-[var(--brand-primary)] hover:underline"
              >
                View all notifications
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
