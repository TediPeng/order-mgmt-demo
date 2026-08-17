import Link from "next/link";
import { Check } from "lucide-react";
import { readDbLite } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can, isFullAccess } from "@/lib/permissions";
import { scopeAgentsForUser } from "@/lib/performance";
import { displayUserName } from "@/lib/types";
import { todayInTz, formatDate, formatCurrency } from "@/lib/utils";
import { LEAD_STATUS_LABELS } from "@/lib/validation";
import { listCallsForDay, type CallKind } from "@/lib/call-sessions";
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
  searchParams: Promise<{ date?: string; agent?: string; page?: string; from?: string; ordered?: string }>;
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

  // Filtering happens in SQL, not over the rows in hand: the count under the
  // header and the pager both have to describe the filtered day, and a filter
  // applied after paging would describe neither.
  const kind: CallKind | "all" = sp.from === "lead" || sp.from === "regular_customer" ? sp.from : "all";
  const orderedOnly = sp.ordered === "1";
  const filtered = kind !== "all" || orderedOnly;

  const { rows, total } = await listCallsForDay(agentIds, date, page, PAGE_SIZE, { kind, orderedOnly });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const nameById = new Map(db.profiles.map((p) => [p.id, displayUserName(p)]));

  // Counted over the page in hand, and labelled as such: the whole day is not
  // in memory and should not be, so a figure claiming to cover it would be a
  // lie on page two.
  const numbersOnPage = new Set(rows.map((r) => r.customer_phone).filter(Boolean)).size;
  // How many of the calls on this page closed a sale. Same caveat as the count
  // above — it covers this page, not the day.
  const orderedOnPage = rows.filter((r) => r.ordered).length;

  const qs = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    Object.entries({
      date,
      agent: selectedAgent,
      page: String(page),
      from: kind === "all" ? "" : kind,
      ordered: orderedOnly ? "1" : "",
      ...overrides,
    }).forEach(([k, v]) => {
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
        {/* Two questions asked of a day's calls often enough to deserve their
            own controls: whose numbers were these, and which of them bought.
            Both are applied in SQL, so the count and the pager move with
            them. */}
        <div className="min-w-[12rem]">
          <label className="mb-1 block text-xs text-slate-400">From</label>
          <Select name="from" defaultValue={kind === "all" ? "" : kind}>
            <option value="">Leads and regular customers</option>
            <option value="lead">Leads only</option>
            <option value="regular_customer">Regular customers only</option>
          </Select>
        </div>
        <div className="min-w-[11rem]">
          <label className="mb-1 block text-xs text-slate-400">Outcome</label>
          <Select name="ordered" defaultValue={orderedOnly ? "1" : ""}>
            <option value="">Every call</option>
            <option value="1">Closed an order only</option>
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          Show
        </Button>
        {/* Paging is reset by submitting the form (no page field in it), but a
            filter left on is easy to forget when the list comes back short. */}
        {filtered && (
          <LinkButton href={qs({ from: "", ordered: "", page: "1" })} variant="outline" size="sm">
            Clear filters
          </LinkButton>
        )}
      </form>

      <p className="mb-3 text-sm text-slate-500">
        <span className="font-medium text-slate-800">{total}</span> call{total === 1 ? "" : "s"} on this date
        {filtered && (
          <>
            {" "}
            matching{" "}
            <span className="font-medium text-slate-800">
              {[
                kind === "lead" ? "leads only" : kind === "regular_customer" ? "regular customers only" : null,
                orderedOnly ? "closed an order" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </>
        )}
        {rows.length > 0 && (
          <>
            {" "}
            · <span className="font-medium text-slate-800">{numbersOnPage}</span> distinct number
            {numbersOnPage === 1 ? "" : "s"} on this page ·{" "}
            <span className="font-medium text-slate-800">{orderedOnPage}</span> closed an order
          </>
        )}
        .
      </p>

      <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[1120px] text-left text-table">
          <thead className="sticky top-0 z-20 bg-slate-50 shadow-sm text-xs uppercase tracking-wide text-slate-500">
            <tr className="whitespace-nowrap">
              <th className="px-2.5 py-2">Time</th>
              {seesOthers && <th className="px-2.5 py-2">Agent</th>}
              <th className="px-2.5 py-2">Customer</th>
              {/* Whether the number belongs to a lead being worked or to one of
                  the agent's own repeat buyers. The two are different jobs and
                  the page read as one undifferentiated list of numbers. */}
              <th className="px-2.5 py-2">From</th>
              <th className="px-2.5 py-2">Phone Number</th>
              <th className="px-2.5 py-2">Order ID</th>
              {/* The call that closed the sale, with what it was worth. Not
                  every call to a number that eventually ordered — that put the
                  tick on the earlier attempts too, beside their own Result of
                  Ringing, and counted one sale once per attempt. */}
              <th className="px-2.5 py-2">Ordered</th>
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
                  {/* Lead or regular customer — the same distinction the
                      monitor draws while the call is live. */}
                  <td className="px-2.5 py-1.5">
                    <Badge
                      className={
                        r.kind === "regular_customer"
                          ? "bg-violet-50 text-violet-700"
                          : "bg-slate-100 text-slate-600"
                      }
                    >
                      {r.kind === "regular_customer" ? "Regular Customer" : "Lead"}
                    </Badge>
                  </td>
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
                    {/* A call raised from a Regular Customer's record has no
                        order unless one was saved during it. The call still
                        happened and still belongs on this page. */}
                    {r.order_id ? (
                      <Link
                        href={`/leads?open_id=${r.order_id}`}
                        className="font-medium text-[var(--brand-primary)] hover:underline"
                      >
                        {r.order_number}
                      </Link>
                    ) : (
                      <span className="text-slate-400">No order</span>
                    )}
                  </td>
                  {/* Ordered means this call's own status transition landed on
                      a sale status — the definition in lib/validation.ts, which
                      is what Total Orders and Sales use. A call that did not
                      close shows the dash, whatever became of the lead later. */}
                  <td className="px-2.5 py-1.5">
                    {r.ordered ? (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                        <Check className="h-3 w-3" aria-hidden />
                        {r.order_amount ? formatCurrency(r.order_amount) : "Ordered"}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
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
                <td colSpan={seesOthers ? 9 : 8} className="px-4 py-10 text-center text-slate-400">
                  {filtered ? (
                    <>
                      No calls on {formatDate(date)} match that filter.{" "}
                      <Link href={qs({ from: "", ordered: "", page: "1" })} className="text-[var(--brand-primary)] hover:underline">
                        Show every call
                      </Link>
                      .
                    </>
                  ) : (
                    <>No calls recorded on {formatDate(date)}.</>
                  )}
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
