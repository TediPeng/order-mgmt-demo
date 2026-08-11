import Link from "next/link";
import { readDbLite } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { scopeAgentsForUser } from "@/lib/performance";
import { displayUserName } from "@/lib/types";
import { todayInTz, formatDate } from "@/lib/utils";
import { LEAD_STATUS_LABELS } from "@/lib/validation";
import { listCallsForDay } from "@/lib/call-sessions";
import { Alert } from "@/components/ui/Alert";
import { Badge, LEAD_STATUS_STYLES } from "@/components/ui/Badge";
import { Button, LinkButton } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import type { OrderStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * The numbers called on a given day.
 *
 * Everything else about calling in this app reports a count — the monitor's
 * Calls column, the activity report, the dashboard tile. An agent working
 * through five hundred imported leads wants the other thing: which numbers they
 * have already been through, and what came of each. There was nowhere that
 * said, so the question was answered by scrolling the Leads list looking for
 * statuses that had changed.
 *
 * Scoped like every other report: an agent sees their own calls, a Team Lead
 * their team's, an Administrator everyone's. The scoping is the same helper the
 * performance pages use, so there is one answer to "whose numbers are these".
 */
function hms(seconds: number | null): string {
  if (seconds == null) return "—";
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m}:${String(rest).padStart(2, "0")}`;
}

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; agent?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const db = await readDbLite();

  if (!can(user.role, "orders", "view", db.role_permissions)) {
    return <Alert kind="error">You do not have permission to view calls.</Alert>;
  }

  const date = sp.date || todayInTz();
  const page = Math.max(1, parseInt(sp.page || "1", 10) || 1);

  // Whose calls this viewer may see. An agent gets exactly one id — their own —
  // so the agent filter below is never shown to them and never needed.
  const scopedAgents = scopeAgentsForUser(db, user);
  const seesOthers = scopedAgents.length > 1 || isFullAccess(user.role) || user.role === "team_lead";
  // A selected agent must be inside the scope, or it is a way to read somebody
  // else's day by editing the address bar.
  const selectedAgent = sp.agent && scopedAgents.some((a) => a.id === sp.agent) ? sp.agent : "";
  const agentIds = selectedAgent ? [selectedAgent] : scopedAgents.map((a) => a.id);

  const { rows, total } = await listCallsForDay(agentIds, date, page, PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const nameById = new Map(db.profiles.map((p) => [p.id, displayUserName(p)]));

  // Counted over the page in hand, and labelled as such: the whole day is not
  // in memory and should not be, so a figure claiming to cover it would be a
  // lie on page two.
  const numbersOnPage = new Set(rows.map((r) => r.customer_phone).filter(Boolean)).size;

  const qs = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    Object.entries({ date, agent: selectedAgent, page: String(page), ...overrides }).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    return `?${params.toString()}`;
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-page-title text-slate-900">Numbers Called</h1>
          <p className="text-sm text-slate-500">
            {seesOthers ? "Every call" : "Your calls"} on {formatDate(date)} — newest first.
          </p>
        </div>
        <LinkButton href="/leads" variant="outline" size="sm">
          Back to Leads
        </LinkButton>
      </div>

      <form className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs text-slate-400">Date</label>
          <Input type="date" name="date" defaultValue={date} />
        </div>
        {seesOthers && (
          <div className="min-w-[14rem]">
            <label className="mb-1 block text-xs text-slate-400">Agent</label>
            <Select name="agent" defaultValue={selectedAgent}>
              <option value="">All agents in your scope</option>
              {scopedAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {displayUserName(a)}
                </option>
              ))}
            </Select>
          </div>
        )}
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>

      <p className="mb-3 text-sm text-slate-500">
        <span className="font-medium text-slate-800">{total}</span> call{total === 1 ? "" : "s"} on this date
        {rows.length > 0 && (
          <>
            {" "}
            · <span className="font-medium text-slate-800">{numbersOnPage}</span> distinct number
            {numbersOnPage === 1 ? "" : "s"} on this page
          </>
        )}
        .
      </p>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[900px] text-left text-table">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr className="whitespace-nowrap">
              <th className="px-2.5 py-2">Time</th>
              {seesOthers && <th className="px-2.5 py-2">Agent</th>}
              <th className="px-2.5 py-2">Customer</th>
              <th className="px-2.5 py-2">Phone Number</th>
              <th className="px-2.5 py-2">Order ID</th>
              <th className="px-2.5 py-2 text-right">Talk time</th>
              <th className="px-2.5 py-2">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const status = r.new_status as OrderStatus | null;
              return (
                <tr key={r.id} className="whitespace-nowrap">
                  <td className="px-2.5 py-1.5 text-slate-500">
                    {new Date(r.started_at).toLocaleTimeString("en-PH", {
                      timeZone: "Asia/Manila",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </td>
                  {seesOthers && <td className="px-2.5 py-1.5 text-slate-600">{nameById.get(r.agent_id) || "—"}</td>}
                  <td className="px-2.5 py-1.5 text-slate-700">{r.customer_name || "—"}</td>
                  {/* The number itself dials on a phone and copies on a desktop —
                      it is the thing this page exists for, so it is not buried
                      in a tooltip. */}
                  <td className="px-2.5 py-1.5 font-medium text-slate-800">
                    {r.customer_phone ? (
                      <a href={`tel:${r.customer_phone}`} className="hover:underline">
                        {r.customer_phone}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-2.5 py-1.5">
                    <Link
                      href={`/leads?open_id=${r.order_id}`}
                      className="font-medium text-[var(--brand-primary)] hover:underline"
                    >
                      {r.order_number}
                    </Link>
                  </td>
                  <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-600">
                    {r.ended_at ? hms(r.duration_seconds) : "on call"}
                  </td>
                  <td className="px-2.5 py-1.5">
                    {status && LEAD_STATUS_STYLES[status] ? (
                      <Badge className={LEAD_STATUS_STYLES[status].badge}>{LEAD_STATUS_LABELS[status]}</Badge>
                    ) : (
                      <span className="text-slate-400">No status change</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={seesOthers ? 7 : 6} className="px-4 py-10 text-center text-slate-400">
                  No calls recorded on {formatDate(date)}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <LinkButton
              href={qs({ page: String(Math.max(1, page - 1)) })}
              variant="outline"
              size="sm"
              className={page <= 1 ? "pointer-events-none opacity-50" : ""}
            >
              Previous
            </LinkButton>
            <LinkButton
              href={qs({ page: String(Math.min(totalPages, page + 1)) })}
              variant="outline"
              size="sm"
              className={page >= totalPages ? "pointer-events-none opacity-50" : ""}
            >
              Next
            </LinkButton>
          </div>
        </div>
      )}
    </div>
  );
}
