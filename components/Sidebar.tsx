"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  PhoneCall,
  UploadCloud,
  Users2,
  TrendingUp,
  Trophy,
  LineChart,
  Clock,
  Timer,
  CalendarClock,
  CalendarDays,
  ShieldAlert,
  Users,
  ShieldCheck,
  FileBarChart,
  History,
  Settings,
  KeyRound,
  Plug,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ModuleKey } from "@/lib/types";

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  show: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

export function Sidebar({ access }: { access: Record<ModuleKey, boolean> }) {
  const pathname = usePathname();

  const groups: NavGroup[] = [
    {
      title: "",
      items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, show: access.dashboard }],
    },
    {
      title: "Operations",
      items: [
        { href: "/leads", label: "Leads", icon: ShoppingCart, show: access.orders },
        { href: "/products", label: "Products", icon: Package, show: access.products },
        { href: "/call-logs", label: "Call Logs", icon: PhoneCall, show: access.call_logs },
        { href: "/file-uploads", label: "File Uploads", icon: UploadCloud, show: access.file_uploads },
      ],
    },
    {
      title: "Performance",
      items: [
        { href: "/performance/agents", label: "Agent Performance", icon: Users2, show: access.performance },
        { href: "/performance/team", label: "Team Performance", icon: TrendingUp, show: access.performance },
        { href: "/performance/sales", label: "Daily Sales Monitoring", icon: LineChart, show: access.performance },
        { href: "/performance/ranking", label: "Agent Ranking", icon: Trophy, show: access.ranking },
      ],
    },
    {
      title: "Workforce",
      items: [
        { href: "/attendance", label: "Attendance", icon: Clock, show: true },
        { href: "/attendance/clock", label: "Time In / Time Out", icon: Timer, show: true },
        { href: "/leave", label: "Leave Requests", icon: CalendarClock, show: access.leave },
        { href: "/schedule", label: "Schedule", icon: CalendarDays, show: access.schedules },
        { href: "/schedule/suspensions", label: "Disciplinary Actions", icon: ShieldAlert, show: access.disciplinary },
      ],
    },
    {
      title: "Administration",
      items: [
        { href: "/users", label: "Users", icon: Users, show: access.users },
        { href: "/settings/roles", label: "Roles and Permissions", icon: ShieldCheck, show: access.roles },
        { href: "/reports", label: "Reports", icon: FileBarChart, show: access.reports },
        { href: "/audit-logs", label: "Audit Logs", icon: History, show: access.audit_logs },
        { href: "/settings/system", label: "System Settings", icon: Settings, show: access.settings },
        { href: "/settings/integrations", label: "Integrations", icon: Plug, show: access.integrations },
      ],
    },
  ];

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
        <Image src="/brand-logo.png" alt="4S RETENTION" width={32} height={23} className="h-8 w-auto object-contain" unoptimized priority />
        <span className="text-sm font-semibold tracking-wide text-slate-800">4S RETENTION</span>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {groups.map((group) => {
          const visibleItems = group.items.filter((i) => i.show);
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.title || "main"} className={group.title ? "mt-4 border-t border-slate-100 pt-4" : ""}>
              {group.title && (
                <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{group.title}</p>
              )}
              {visibleItems.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-[var(--brand-primary-10)] text-[var(--brand-primary)]"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          );
        })}
        <div className="mt-4 border-t border-slate-100 pt-4">
          <Link
            href="/settings/password"
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              pathname === "/settings/password"
                ? "bg-[var(--brand-primary-10)] text-[var(--brand-primary)]"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            )}
          >
            <KeyRound className="h-4 w-4" />
            Change Password
          </Link>
        </div>
      </nav>
    </aside>
  );
}
