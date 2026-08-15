"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatDate } from "@/lib/utils";

export interface DuplicateWarning {
  name: string;
  phone: string;
  /** The other agent's Call Name — who to name when escalating. */
  agent: string;
  /** That agent's most recent order for this customer, ISO or null. */
  lastOrderAt?: string | null;
  fields: string[];
  confidence: string;
}

/**
 * Raised on Save when the customer being saved is already somebody else's.
 *
 * The detector has always found these; only Management ever saw them, and only
 * as a note at the bottom of the popup, after the save had already happened.
 * The agent — the one person who can still stop — was told nothing, and two
 * agents would work the same customer for weeks before anybody compared lists.
 *
 * So it arrives before the save, and for an agent it does not offer a way past:
 * the server refuses the same save for the same reason, so a button marked
 * "Save anyway" would only produce a red error. Management and Team Leads keep
 * theirs — they are who the agent is being sent to, and blocking them would
 * leave the pair with nobody able to act on it.
 *
 * What it shows is what the escalation needs: whose customer this is, and when
 * that agent last sold to them — a match from eight months ago and one from
 * yesterday are not the same conversation.
 */
export function DuplicateBlockDialog({
  warnings,
  canOverride,
  onBack,
  onOverride,
}: {
  warnings: DuplicateWarning[];
  /** Team Lead and above. An agent gets no way through. */
  canOverride: boolean;
  onBack: () => void;
  onOverride: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="duplicate-title"
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl"
      >
        <div className="sticky top-0 flex items-center gap-2 bg-amber-500 px-5 py-3 text-white">
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
          <h2 id="duplicate-title" className="text-base font-semibold">
            This customer is already with another agent
          </h2>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-sm text-slate-700">
            {warnings.length === 1 ? "May nakita kaming tugma" : `May ${warnings.length} nakitang tugma`} sa ibang
            record:
          </p>

          <ul className="space-y-2">
            {warnings.map((d, i) => (
              <li key={i} className="rounded-lg border border-amber-200 bg-white p-3">
                <p className="text-sm font-semibold text-slate-900">
                  {d.name} <span className="font-normal text-slate-500">· {d.phone}</span>
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div>
                    <dt className="uppercase text-slate-400">Agent</dt>
                    <dd className="font-medium text-slate-800">{d.agent}</dd>
                  </div>
                  <div>
                    <dt className="uppercase text-slate-400">Latest order</dt>
                    {/* No order on file is its own answer: the customer is
                        claimed but has not been sold to, which is a different
                        conversation from one bought last week. */}
                    <dd className="font-medium text-slate-800">
                      {d.lastOrderAt ? formatDate(d.lastOrderAt) : "No order yet"}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="uppercase text-slate-400">Matched on</dt>
                    <dd className="text-slate-700">
                      {d.fields.join(", ")} <span className="text-slate-400">({d.confidence} confidence)</span>
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>

          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-900">
            Please contact your Team Lead for this concern.
          </p>

          <div className="flex justify-end gap-2">
            <Button type="button" variant={canOverride ? "outline" : "primary"} onClick={onBack}>
              Back to the order
            </Button>
            {canOverride && (
              <Button type="button" onClick={onOverride}>
                Save anyway
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
