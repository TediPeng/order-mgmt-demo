"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  PhoneCall,
  PhoneOutgoing,
  UploadCloud,
  FileUp,
  Users2,
  UserCheck,
  TrendingUp,
  Trophy,
  ListTodo,
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
  ScrollText,
  Activity,
  BarChart3,
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

/**
 * Fixed application sidebar.
 *
 * Deliberately dark in BOTH themes: it is the one surface that stays constant
 * while the content area follows the theme, which is what makes brand gold read
 * as the active colour in either mode. Its tokens therefore live outside the
 * `.dark` remap in globals.css.
 *
 * Collapsed it shows icons only at 56px; the label rides along as a `title` so
 * the nav stays usable without widening. Permission filtering is unchanged —
 * an item the user cannot access is never rendered, collapsed or not.
 */
export function Sidebar({
  access,
  canMonitor = false,
  canSeeRemainingLeads = false,
  canImportRegularCustomers = false,
  workforceInPortal = false,
  collapsed = false,
  onNavigate,
}: {
  access: Record<ModuleKey, boolean>;
  /** Agent Monitor is supervisory: Administrators and Team Leads only. Passed
   * in rather than derived from `access`, because holding attendance.view is
   * what lets an agent see their OWN record — it should not also hand them a
   * board of everyone else's break timers. */
  canMonitor?: boolean;
  /** The size of the floor's queue is a management number, so this is
   * Administrators and Management only -- narrower than performance.view,
   * which every Team Lead holds for their own team. */
  canSeeRemainingLeads?: boolean;
  /** Uploading is gated on regular_customers.create, an action grant rather
   * than a module one, so it cannot be read off `access` — which carries view
   * only. The page enforces the same rule; this decides whether the link
   * shows. */
  canImportRegularCustomers?: boolean;
  /**
   * True once the company portal is where the floor keeps its own time and
   * roster, which drops Time In / Out and Schedule from this menu.
   *
   * Passed in rather than worked out here: deciding it reads server
   * environment, and this is a client component.
   */
  workforceInPortal?: boolean;
  collapsed?: boolean;
  /** Lets the mobile drawer close itself when a destination is chosen. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  const groups: NavGroup[] = [
    {
      title: "Main",
      items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, show: access.dashboard }],
    },
    {
      title: "Sales",
      items: [
        { href: "/leads", label: "Leads", icon: ShoppingCart, show: access.orders },
        // Beside Leads, not under Files: this is the day's calls against those
        // leads, not an uploaded recording. Same gate as Leads because it shows
        // the same rows, scoped the same way — an agent sees their own.
        { href: "/calls", label: "Numbers Called", icon: PhoneOutgoing, show: access.orders },
        { href: "/regular-customers", label: "Regular Customers", icon: UserCheck, show: access.regular_customers },
        // Its own entry rather than a button on the list: an agent bringing
        // over a list of their repeat buyers goes straight to it, and the
        // template lives on that page beside the upload box.
        {
          href: "/regular-customers/import",
          label: "Import Regular Customers",
          icon: FileUp,
          show: access.regular_customers && canImportRegularCustomers,
        },
        { href: "/products", label: "Products", icon: Package, show: access.products },
      ],
    },
    {
      title: "Performance",
      items: [
        { href: "/performance/agents", label: "Agent Performance", icon: Users2, show: access.performance },
        { href: "/performance/team", label: "Team Performance", icon: TrendingUp, show: access.performance },
        { href: "/performance/sales", label: "Daily Sales", icon: LineChart, show: access.performance },
        { href: "/performance/ranking", label: "Agent Ranking", icon: Trophy, show: access.ranking },
        { href: "/performance/remaining-leads", label: "Remaining Leads", icon: ListTodo, show: canSeeRemainingLeads },
      ],
    },
    {
      title: "Workforce",
      items: [
        { href: "/attendance", label: "Attendance", icon: Clock, show: true },
        // Gone once the clock is the portal's. Attendance above stays: it is
        // the read of the mirrored rows that ROMA's own timesheet, activity
        // report and exports are built from, and hiding it would take away the
        // record without taking away anything that writes it.
        { href: "/attendance/clock", label: "Time In / Out", icon: Timer, show: !workforceInPortal },
        { href: "/attendance/monitor", label: "Agent Monitoring", icon: Activity, show: canMonitor },
        // Same audience and same gate as the monitor — the live board and its
        // historical counterpart belong next to each other.
        { href: "/attendance/activity", label: "Activity Report", icon: BarChart3, show: canMonitor },
        // Off the menu with the clock, because the floor reads its roster in the
        // portal now.
        //
        // Only off the MENU. /schedule still works, and that is deliberate
        // rather than an oversight: nothing carries a roster between the two
        // applications, and lateness on every mirrored time-in is still
        // measured against the duty hours held here -- see the portal
        // attendance route, which falls back to the global work schedule when
        // an agent has no row for the day. A roster nobody can reach is a
        // roster that stops being maintained, and the first sign of it would be
        // wrong lateness in ROMA's own timesheet, which nothing announces.
        { href: "/schedule", label: "Schedule", icon: CalendarDays, show: access.schedules && !workforceInPortal },
        { href: "/leave", label: "Leave Requests", icon: CalendarClock, show: access.leave },
        { href: "/schedule/suspensions", label: "Disciplinary", icon: ShieldAlert, show: access.disciplinary },
      ],
    },
    {
      title: "Files",
      items: [
        { href: "/call-logs", label: "Call Logs", icon: PhoneCall, show: access.call_logs },
        { href: "/file-uploads", label: "File Uploads", icon: UploadCloud, show: access.file_uploads },
      ],
    },
    {
      title: "Admin",
      items: [
        { href: "/users", label: "Users", icon: Users, show: access.users },
        { href: "/settings/roles", label: "Roles & Permissions", icon: ShieldCheck, show: access.roles },
        { href: "/settings/integrations", label: "Integrations", icon: Plug, show: access.integrations },
        { href: "/reports", label: "Reports", icon: FileBarChart, show: access.reports },
        { href: "/audit-logs", label: "Audit Logs", icon: History, show: access.audit_logs },
        { href: "/settings/system", label: "System Settings", icon: Settings, show: access.settings },
        { href: "/settings/update-logs", label: "Update Logs", icon: ScrollText, show: access.settings },
      ],
    },
  ];

  // The most specific entry that matches the current path, and only that one.
  //
  // The rule was "exact, or a path-segment prefix", which lit Regular Customers
  // AND Import Regular Customers together the moment the second existed —
  // /regular-customers/import is a child of /regular-customers, and both were
  // in the list. Two items highlighted says the wrong thing about where you
  // are. The longest matching href wins.
  const activeHref = groups
    .flatMap((g) => g.items)
    .filter((item) => item.show && (pathname === item.href || pathname.startsWith(item.href + "/")))
    .reduce<string | null>((best, item) => (best && best.length >= item.href.length ? best : item.href), null);

  function renderItem(item: NavItem) {
    const active = item.href === activeHref;
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        title={collapsed ? item.label : undefined}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex cursor-pointer items-center gap-3 rounded-md py-2 text-sm font-medium transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)]",
          collapsed ? "justify-center px-2" : "px-3",
          active
            ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-active-fg)]"
            : "text-[var(--sidebar-fg)] hover:bg-[var(--sidebar-bg-elevated)] hover:text-[var(--sidebar-fg-strong)]"
        )}
      >
        {/* Brand-coloured left edge marks the active item — readable without
            relying on colour alone, since the background shifts too. */}
        {active && (
          <span
            aria-hidden
            className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-r bg-[var(--brand-accent)]"
          />
        )}
        <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </Link>
    );
  }

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col bg-[var(--sidebar-bg)] transition-[width] duration-200",
        collapsed ? "w-14" : "w-64"
      )}
      style={{ borderRight: "1px solid var(--sidebar-border)" }}
    >
      <div
        className={cn(
          "flex h-14 shrink-0 items-center gap-2 px-3",
          collapsed && "justify-center"
        )}
        style={{ borderBottom: "1px solid var(--sidebar-border)" }}
      >
        <Image
          src="/brand-logo.png"
          alt="4S ROMA"
          width={28}
          height={20}
          className="h-7 w-auto shrink-0 object-contain"
          unoptimized
          priority
        />
        {!collapsed && (
          <span className="truncate text-sm font-semibold tracking-wide text-[var(--sidebar-fg-strong)]">4S ROMA</span>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-3">
        {groups.map((group) => {
          const visible = group.items.filter((i) => i.show);
          if (visible.length === 0) return null;
          return (
            <div key={group.title} className="mb-3 last:mb-0">
              {collapsed ? (
                <div aria-hidden className="mx-2 mb-2 border-t border-[var(--sidebar-border)]" />
              ) : (
                <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--sidebar-fg-muted)]">
                  {group.title}
                </p>
              )}
              <div className="space-y-0.5">{visible.map(renderItem)}</div>
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 px-2 py-2" style={{ borderTop: "1px solid var(--sidebar-border)" }}>
        {renderItem({ href: "/settings/password", label: "Change Password", icon: KeyRound, show: true })}
      </div>
    </aside>
  );
}
