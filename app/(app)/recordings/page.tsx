import Link from "next/link";
import { redirect } from "next/navigation";
import { Mic } from "lucide-react";

import { getCurrentUser } from "@/lib/auth";
import { readDb } from "@/lib/db";
import { scopeAgentsForUser } from "@/lib/performance";
import { isFullAccess } from "@/lib/permissions";
import { listRecordings, RECORDING_KEEP_DAYS } from "@/lib/recordings";
import { displayUserName } from "@/lib/types";
import { formatDate, todayInTz } from "@/lib/utils";
import { Alert } from "@/components/ui/Alert";
import { LinkButton } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * Every recorded call, in one place.
 *
 * The audio was already reachable — a player in a column on Numbers Called —
 * but only as an attribute of one agent's day, which meant hearing a call
 * required first knowing whose day to open and on which date. The questions
 * recordings are actually kept for run the other way: "what was said to this
 * customer", and "let me listen to a few of yesterday's calls". Both start
 * from the recording.
 *
 * Supervisory, and scoped like every other report in the app: an Administrator
 * hears the whole floor, a Team Lead their own agents. An agent does not get
 * the page — not because the audio is secret from whoever made the call, since
 * they still hear their own on Numbers Called, but because laying other
 * people's conversations out for browsing is a different trust from a player on
 * a row somebody was already entitled to see.
 *
 * The rule is enforced twice: here, and again in /api/recordings/<id>, which is
 * what mints the address the player fetches. A page is not a lock.
 */
function hms(seconds: number | null): string {
  if (seconds == null) return "—";
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function mb(bytes: number | null): string {
  if (!bytes) return "—";
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default async function RecordingsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; agent?: string; phone?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;

  // Supervisors only, and a redirect rather than a message: an account that
  // cannot be here should not learn that the page exists.
  const isTeamLead = user.role === "team_lead";
  if (!isFullAccess(user.role) && !isTeamLead) redirect("/dashboard");

  // The full read, not the lite one: scopeAgentsForUser needs the profile rows
  // it filters on, and this page is opened by a handful of supervisors rather
  // than by the floor.
  const db = await readDb();
  const today = todayInTz();
  const date = sp.date || today;
  const page = Math.max(1, parseInt(sp.page || "1", 10) || 1);
  const phone = String(sp.phone || "").trim();
  const searching = Boolean(phone.replace(/[^0-9]/g, ""));

  // Whose recordings this viewer may hear. The same helper the performance and
  // Calls pages use, so there is one answer to "whose calls are these" rather
  // than a second opinion living on this page.
  const scopedAgents = scopeAgentsForUser(db, user).sort((a, b) =>
    displayUserName(a).localeCompare(displayUserName(b))
  );
  // A selected agent must be inside the scope, or the dropdown is decoration
  // and the address bar is the real control.
  const selectedAgent = sp.agent && scopedAgents.some((a) => a.id === sp.agent) ? sp.agent : "";

  const { rows, total } = await listRecordings({
    date,
    // Null for a full-access account: everything, including a call that matched
    // no extension and so belongs to nobody.
    scopeAgentIds: isFullAccess(user.role) ? null : scopedAgents.map((a) => a.id),
    agentId: selectedAgent || null,
    phone: phone || null,
    page,
    pageSize: PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const nameById = new Map(db.profiles.map((p) => [p.id, displayUserName(p)]));

  const qs = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    Object.entries({
      date: date === today ? "" : date,
      agent: selectedAgent,
      phone,
      page: String(page),
      ...overrides,
    }).forEach(([k, v]) => {
      if (v && !(k === "page" && v === "1")) params.set(k, v);
    });
    const s = params.toString();
    return s ? `/recordings?${s}` : "/recordings";
  };

  // Over the page in hand, and said so. The whole day is not in memory and
  // should not be, so a figure claiming to cover it would be a lie on page two.
  const talkOnPage = rows.reduce((sum, r) => sum + (r.billsec || 0), 0);

  return (
    <div>
      <PageHeader
        title="Call Recordings"
        description={`${
          isFullAccess(user.role) ? "Every agent" : "Your team"
        }. Audio is kept for ${RECORDING_KEEP_DAYS} days, then deleted automatically.`}
      />

      {/* A plain GET form. The filters belong in the address so a particular
          call can be sent to somebody, and so the back button works. */}
      <form method="get" className="mb-3 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="date" className="block text-xs font-medium text-slate-500">
            Day
          </label>
          <Input id="date" type="date" name="date" defaultValue={date} max={today} disabled={searching} />
        </div>
        <div>
          <label htmlFor="agent" className="block text-xs font-medium text-slate-500">
            Agent
          </label>
          <Select id="agent" name="agent" defaultValue={selectedAgent}>
            <option value="">{isFullAccess(user.role) ? "Everyone" : "My whole team"}</option>
            {scopedAgents.map((a) => (
              <option key={a.id} value={a.id}>
                {displayUserName(a)}
                {a.sip_extension ? ` (${a.sip_extension})` : ""}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="phone" className="block text-xs font-medium text-slate-500">
            Number called
          </label>
          <Input id="phone" name="phone" defaultValue={phone} placeholder="09xx…" className="w-44" />
        </div>
        <button
          type="submit"
          className="h-9 rounded-md bg-[var(--brand-primary)] px-4 text-control font-medium text-white hover:opacity-90"
        >
          Search
        </button>
        {(selectedAgent || phone || date !== today) && (
          <LinkButton href="/recordings" variant="outline" size="sm">
            Clear
          </LinkButton>
        )}
      </form>

      {/* Said plainly, because a date box that is ignored looks broken. */}
      {searching && (
        <Alert kind="info" className="mb-3">
          Searching every stored day for numbers containing <span className="font-medium">{phone}</span> — the day
          filter does not apply to a number search.
        </Alert>
      )}

      <p className="mb-2 text-sm text-slate-500">
        {total === 0 ? (
          "No recordings"
        ) : (
          <>
            <span className="font-medium text-slate-800">{total}</span> recording{total === 1 ? "" : "s"}
            {searching ? "" : ` on ${formatDate(date)}`}
            {selectedAgent ? ` — ${nameById.get(selectedAgent)}` : ""}. This page holds {rows.length}, {hms(talkOnPage)}{" "}
            of conversation.
          </>
        )}
      </p>

      {rows.length === 0 ? (
        <Alert kind="info">
          Nothing recorded here. Only answered calls produce audio — a number that rang out or was busy has nothing to
          store — and anything older than {RECORDING_KEEP_DAYS} days has already been deleted.
        </Alert>
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[900px] text-left text-table">
            <thead className="sticky top-0 z-20 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 shadow-sm">
              <tr className="whitespace-nowrap">
                <th className="px-2.5 py-2">Time</th>
                <th className="px-2.5 py-2">Agent</th>
                <th className="px-2.5 py-2">Number</th>
                <th className="px-2.5 py-2">Customer</th>
                <th className="px-2.5 py-2 text-right">Spoke for</th>
                <th className="px-2.5 py-2">Recording</th>
                <th className="px-2.5 py-2 text-right">Size</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="whitespace-nowrap hover:bg-slate-50">
                  <td className="px-2.5 py-1.5 text-slate-500">
                    {new Date(r.startedAt).toLocaleString("en-PH", {
                      timeZone: "Asia/Manila",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-2.5 py-1.5 text-slate-700">
                    {r.agentId ? nameById.get(r.agentId) || "—" : <span className="text-slate-400">Unmatched</span>}
                    {r.extension && <span className="ml-1.5 text-xs text-slate-400">{r.extension}</span>}
                  </td>
                  <td className="px-2.5 py-1.5 font-mono text-slate-700">{r.dialedRaw || "—"}</td>
                  <td className="px-2.5 py-1.5">
                    <span className="text-slate-800">{r.customerName || "—"}</span>
                    {/* The order behind the call, when the call was matched to
                        one. A blank is not a fault: an agent can ring a number
                        that never became an order, and that call is still
                        worth hearing. */}
                    {r.orderId && r.orderNumber && (
                      <Link
                        href={`/leads/${r.orderId}`}
                        className="ml-2 text-xs text-[var(--brand-primary)] hover:underline"
                      >
                        {r.orderNumber}
                      </Link>
                    )}
                  </td>
                  <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-600">{hms(r.billsec)}</td>
                  {/* A player, not a download. The audio is a customer's voice;
                      listening in place leaves it where the permissions are,
                      and the address it plays from is minted per press and
                      expires in minutes. */}
                  <td className="px-2.5 py-1.5">
                    <audio controls preload="none" src={`/api/recordings/${r.id}`} className="h-8 w-52" />
                  </td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums text-slate-400">{mb(r.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-sm text-slate-500">
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

      <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400">
        <Mic className="h-3.5 w-3.5" aria-hidden />
        Only answered calls are recorded. Calls placed outside ROMA — on a mobile rather than the softphone — never
        reach the phone system and have no audio here.
      </p>
    </div>
  );
}
