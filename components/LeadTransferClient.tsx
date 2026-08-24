"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";
import { LEAD_STATUS_LABELS } from "@/lib/validation";

export interface PhoneLead {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  status: string;
  agent_id: string;
  agent_name: string | null;
  /** Why this one cannot be moved, or null. Same rules the transfer applies, so
   * the screen can never offer something the server would refuse. */
  blocked_reason: string | null;
}

export interface TransferAgent {
  id: string;
  name: string;
  callName: string | null;
}

/**
 * Moving a queue from one caller to another.
 *
 * Always a preview first. The count depends on the statuses ticked and on what
 * the server refuses to move, so a number typed from memory is a guess — and
 * the difference between transferring 40 leads and 4,000 is one unticked box.
 */
export function LeadTransferClient({
  agents,
  statuses,
  defaultStatuses,
}: {
  agents: TransferAgent[];
  statuses: string[];
  defaultStatuses: string[];
}) {
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [picked, setPicked] = useState<string[]>(defaultStatuses);
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [moved, setMoved] = useState<number | null>(null);

  // Looking one number up, as an alternative to moving a whole queue.
  const [phone, setPhone] = useState("");
  const [lookup, setLookup] = useState<PhoneLead[] | null>(null);
  const [looking, setLooking] = useState(false);

  /**
   * The answer arrives as they type, not behind a button.
   *
   * The question being asked of this field is "is this the right person", and
   * an answer that costs a click is one people skip — they paste the number,
   * assume, and transfer. Debounced so a ten-digit number is one request rather
   * than ten, and the sequence guard means a slow early reply cannot overwrite
   * the answer to what is actually in the box now.
   */
  const seq = useRef(0);
  useEffect(() => {
    const digits = phone.replace(/[^0-9]/g, "");
    if (digits.length < 7) {
      setLookup(null);
      setLooking(false);
      return;
    }
    const mine = ++seq.current;
    setLooking(true);
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/leads/lookup?phone=${encodeURIComponent(phone)}`);
        const json = await res.json();
        if (mine !== seq.current) return;
        setLookup(json.ok ? (json.leads as PhoneLead[]) : []);
      } catch {
        if (mine === seq.current) setLookup([]);
      } finally {
        if (mine === seq.current) setLooking(false);
      }
    }, 350);
    return () => clearTimeout(id);
  }, [phone]);

  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name || "";

  // A number in the box is the instruction; the queue pickers step aside.
  const byPhone = phone.replace(/[^0-9]/g, "").length >= 7;
  const movable = (lookup || []).filter((l) => !l.blocked_reason && l.agent_id !== to);
  const canRun = byPhone ? Boolean(to) && movable.length > 0 : Boolean(from) && Boolean(to) && picked.length > 0;

  function toggle(s: string) {
    setPreview(null);
    setPicked((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  async function run(apply: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/leads/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to,
          statuses: picked,
          limit: limit ? Number(limit) : null,
          apply,
          // Set only in by-number mode; the server then ignores From and the
          // status ticks entirely.
          phone: byPhone ? phone : "",
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error || "Something went wrong.");
        return;
      }
      if (apply) {
        setMoved(json.moved);
        setPreview(null);
        router.refresh();
      } else {
        setPreview(json.moved);
      }
    } catch {
      setError("Network error. Nothing was transferred.");
    } finally {
      setBusy(false);
    }
  }

  if (moved !== null) {
    return (
      <div className="space-y-3">
        <Alert kind="success">
          {moved} lead{moved === 1 ? "" : "s"} moved from <strong>{nameOf(from)}</strong> to{" "}
          <strong>{nameOf(to)}</strong>. Both were notified.
        </Alert>
        <div className="flex gap-2">
          <Button type="button" onClick={() => { setMoved(null); setPreview(null); }}>
            Transfer more
          </Button>
          <a href="/leads">
            <Button type="button" variant="outline">
              Go to Leads
            </Button>
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <Alert kind="error">{error}</Alert>}

      {/* One number, as an alternative to a whole queue. A customer rings back
          and asks for the agent they spoke to, and the person handling that
          knows the number, not who holds it. */}
      <div>
        <Label htmlFor="phone">Or find one lead by phone number</Label>
        <Input
          id="phone"
          inputMode="tel"
          value={phone}
          onChange={(e) => { setPhone(e.target.value); setPreview(null); }}
          placeholder="0917 000 0000"
          className="max-w-xs"
        />
        <p className="mt-1 text-xs text-slate-400">
          Checked as you type. 0917…, +63917… and 917… are read as the same number.
        </p>
      </div>

      {byPhone && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          {looking && <p className="text-sm text-slate-500">Checking…</p>}
          {!looking && lookup && lookup.length === 0 && (
            <p className="text-sm text-slate-500">No lead in the system on that number.</p>
          )}
          {!looking &&
            lookup?.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 py-1.5 last:border-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">
                    {l.customer_name || "(no name)"}{" "}
                    <span className="font-mono text-xs text-slate-400">{l.order_number}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    Held by <span className="font-medium text-slate-700">{l.agent_name || "nobody"}</span> ·{" "}
                    {LEAD_STATUS_LABELS[l.status as keyof typeof LEAD_STATUS_LABELS] || l.status}
                  </p>
                </div>
                {l.blocked_reason ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                    {l.blocked_reason}
                  </span>
                ) : l.agent_id === to ? (
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                    Already theirs
                  </span>
                ) : (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
                    Can be moved
                  </span>
                )}
              </div>
            ))}
        </div>
      )}

      <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <div className={byPhone ? "opacity-40" : undefined}>
          <Label htmlFor="from">From{byPhone ? " (not needed — whoever holds the number)" : ""}</Label>
          <Select id="from" value={from} onChange={(e) => { setFrom(e.target.value); setPreview(null); }}>
            <option value="">Pick an agent</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.callName ? ` (${a.callName})` : ""}
              </option>
            ))}
          </Select>
        </div>
        <ArrowRight className="mx-auto hidden h-5 w-5 shrink-0 text-slate-400 sm:block" aria-hidden />
        <div>
          <Label htmlFor="to">To</Label>
          <Select id="to" value={to} onChange={(e) => { setTo(e.target.value); setPreview(null); }}>
            <option value="">Pick an agent</option>
            {agents
              .filter((a) => a.id !== from)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.callName ? ` (${a.callName})` : ""}
                </option>
              ))}
          </Select>
        </div>
      </div>

      <div className={byPhone ? "opacity-40" : undefined}>
        <Label>Which leads{byPhone ? " (ignored for a single number)" : ""}</Label>
        <div className="flex flex-wrap gap-2">
          {statuses.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => toggle(s)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                picked.includes(s)
                  ? "border-[var(--brand-primary)] bg-[var(--brand-primary-10)] text-[var(--brand-primary)]"
                  : "border-slate-200 text-slate-500 hover:border-slate-300"
              }`}
            >
              {LEAD_STATUS_LABELS[s as keyof typeof LEAD_STATUS_LABELS] || s}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Sales and anything sent to Pancake are never moved — those are credited to the agent who made them. A regular
          customer&apos;s orders stay with the customer record.
        </p>
      </div>

      <div className="max-w-xs">
        <Label htmlFor="limit">How many (optional)</Label>
        <Input
          id="limit"
          type="number"
          min={1}
          value={limit}
          onChange={(e) => { setLimit(e.target.value); setPreview(null); }}
          placeholder="All of them"
        />
        <p className="mt-1 text-xs text-slate-400">Oldest first, so a partial hand-over moves the longest-waiting leads.</p>
      </div>

      {preview !== null && (
        <Alert kind={preview === 0 ? "warning" : "info"}>
          {preview === 0 ? (
            <>Nothing matches. {nameOf(from)} holds no transferable leads at those statuses.</>
          ) : (
            <>
              <strong>{preview}</strong> lead{preview === 1 ? "" : "s"} will move from {nameOf(from)} to {nameOf(to)}.
            </>
          )}
        </Alert>
      )}

      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
        <Button type="button" variant="outline" onClick={() => run(false)} disabled={busy || !canRun}>
          {busy ? "Checking…" : "Preview"}
        </Button>
        <Button type="button" onClick={() => run(true)} disabled={busy || preview === null || preview === 0}>
          {busy ? "Transferring…" : preview ? `Transfer ${preview}` : byPhone ? `Transfer ${movable.length}` : "Transfer"}
        </Button>
      </div>
    </div>
  );
}
