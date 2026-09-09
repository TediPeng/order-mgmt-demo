import Link from "next/link";

import { Alert } from "@/components/ui/Alert";
import { portalHomeUrl } from "@/lib/portal-attendance";

/**
 * What the portal said about a time in or out that happened here.
 *
 * The clock is back on ROMA, but the portal is still what pays. So this screen
 * has to be honest about a fact that used to be invisible: whether the other
 * side accepted it.
 *
 * Three outcomes, three different things for the agent to do.
 *
 *   - Accepted: nothing to say beyond the success already shown, and a way
 *     through to the portal, which is where they were going next anyway.
 *   - Refused: the portal is stricter than ROMA — a rostered day off, or a
 *     department on manual time cards. They must read it now. Discovering on
 *     payday that a worked day was never recorded is the failure this whole
 *     bridge exists to prevent.
 *   - Not sent: ours, not theirs. It is swept up automatically within ten
 *     minutes, so the words say so instead of asking them to do anything.
 */
export function PortalClockNotice({
  refused,
  unsent,
  clocked,
}: {
  refused?: string;
  unsent?: boolean;
  /** True right after a time in or out, which is when the way through is worth offering. */
  clocked?: boolean;
}) {
  const portal = portalHomeUrl();

  return (
    <>
      {refused && (
        <Alert kind="error" className="mb-4">
          Recorded here, but the company portal did not accept it: {refused} Your pay is worked out from the portal, so
          tell your Team Lead now rather than at the end of the cut-off.
        </Alert>
      )}
      {unsent && !refused && (
        <Alert kind="warning" className="mb-4">
          Recorded here, but the company portal could not be reached. It will be sent again automatically within a few
          minutes — you do not need to do anything.
        </Alert>
      )}
      {clocked && portal && (
        <div className="mb-4">
          <Link
            href={portal}
            className="inline-flex items-center rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Continue to the company portal
          </Link>
        </div>
      )}
    </>
  );
}
