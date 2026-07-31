"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home } from "lucide-react";

/** Segments that are route plumbing rather than a place a user navigated to. */
const HIDDEN_SEGMENTS = new Set(["(app)"]);

/** Labels that title-casing would get wrong or render awkwardly. */
const SEGMENT_LABELS: Record<string, string> = {
  leads: "Leads",
  "regular-customers": "Regular Customers",
  products: "Products",
  "call-logs": "Call Logs",
  "file-uploads": "File Uploads",
  performance: "Performance",
  agents: "Agent Performance",
  team: "Team Performance",
  sales: "Daily Sales",
  ranking: "Agent Ranking",
  attendance: "Attendance",
  clock: "Time In / Out",
  manage: "Manage",
  schedule: "Schedule",
  suspensions: "Disciplinary Actions",
  leave: "Leave Requests",
  users: "Users",
  settings: "Settings",
  roles: "Roles & Permissions",
  integrations: "Integrations",
  "status-map": "Status Map",
  mappings: "Order Source & Staff",
  logs: "Sync Logs",
  "update-logs": "Update Logs",
  system: "System Settings",
  password: "Change Password",
  reports: "Reports",
  "audit-logs": "Audit Logs",
  dashboard: "Dashboard",
  new: "New",
  import: "Import",
  upload: "Upload",
  history: "History",
  duplicates: "Duplicates",
  delete: "Delete",
  notifications: "Notifications",
};

/** A path segment that is an id rather than a page name. */
function isIdSegment(segment: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment) || /^\d+$/.test(segment);
}

function labelFor(segment: string): string {
  if (SEGMENT_LABELS[segment]) return SEGMENT_LABELS[segment];
  return segment
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * The breadcrumb row that sits under the header on every page.
 *
 * Derived from the URL rather than declared per page, so a new route gets one
 * for free and none can drift out of sync with where the user actually is. An
 * id segment renders as "Details" instead of a raw UUID.
 */
export function Breadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean).filter((s) => !HIDDEN_SEGMENTS.has(s));

  if (segments.length === 0) return null;

  const crumbs = segments.map((segment, i) => ({
    label: isIdSegment(segment) ? "Details" : labelFor(segment),
    href: "/" + segments.slice(0, i + 1).join("/"),
    isLast: i === segments.length - 1,
  }));

  return (
    <nav
      aria-label="Breadcrumb"
      className="mx-auto flex w-full max-w-screen-2xl items-center gap-1.5 px-4 pt-4 text-xs text-slate-400 md:px-6"
    >
      <Link
        href="/dashboard"
        className="flex cursor-pointer items-center gap-1 transition-colors duration-150 hover:text-slate-600"
      >
        <Home className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">Home</span>
      </Link>
      {crumbs.map((c) => (
        <span key={c.href} className="flex items-center gap-1.5">
          <span aria-hidden>/</span>
          {c.isLast ? (
            <span aria-current="page" className="font-medium text-slate-600">
              {c.label}
            </span>
          ) : (
            <Link href={c.href} className="cursor-pointer transition-colors duration-150 hover:text-slate-600">
              {c.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
