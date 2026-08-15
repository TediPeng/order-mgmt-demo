"use client";

import { PhoneCall } from "lucide-react";
import { useCallSession } from "@/components/CallSessionProvider";
import { formatElapsed } from "@/components/CallSessionProvider";

/**
 * The way back to a call that is still running, from anywhere it is offered.
 *
 * One call is open at a time, and until it is ended no other can be started. An
 * agent who wandered off to Regular Customers mid-call had to remember which
 * lead it was on and find it again — and the popup that ends a call only exists
 * inside the leads table, so "find it again" was the only route.
 *
 * open_id is how the leads page pins one order onto the page whatever filter or
 * page it would otherwise fall on, which is the same route the leads row's own
 * "Return to call" takes.
 *
 * It renders nothing when no call is open. A permanent button that usually does
 * nothing is worse than one that appears when it means something.
 */
export function BackToCallButton() {
  const { session, now } = useCallSession();
  if (!session) return null;

  return (
    <a
      href={`/leads?open_id=${session.order_id}`}
      title="A call is in progress — go back to it"
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-green-100 px-2.5 py-1.5 text-control font-medium text-green-800 transition-colors hover:bg-green-200"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-green-600" />
      </span>
      <PhoneCall className="h-3.5 w-3.5" aria-hidden />
      Back to call
      <span className="font-mono tabular-nums text-green-900">{formatElapsed(session.started_at, now)}</span>
    </a>
  );
}
