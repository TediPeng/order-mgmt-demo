"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";
import { LEAD_STATUS_LABELS } from "@/lib/validation";

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

  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name || "";

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
        body: JSON.stringify({ from, to, statuses: picked, limit: limit ? Number(limit) : null, apply }),
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

      <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <div>
          <Label htmlFor="from">From</Label>
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

      <div>
        <Label>Which leads</Label>
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
        <Button type="button" variant="outline" onClick={() => run(false)} disabled={busy || !from || !to || picked.length === 0}>
          {busy ? "Checking…" : "Preview"}
        </Button>
        <Button type="button" onClick={() => run(true)} disabled={busy || preview === null || preview === 0}>
          {busy ? "Transferring…" : preview ? `Transfer ${preview}` : "Transfer"}
        </Button>
      </div>
    </div>
  );
}
