"use client";

import { useState, useTransition } from "react";
import { Check, Copy } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { dismissTempPasswordAction } from "@/lib/actions/users";
import type { TempPasswordFlash } from "@/lib/temp-password-flash";

/**
 * The one showing of a temporary password.
 *
 * It used to clear the cookie the moment it mounted, which read as tidy and was
 * unusable: dismissTempPasswordAction is a Server Action, and finishing one
 * re-renders the route it was called from. So the page came back without the
 * flash and unmounted this banner a few hundred milliseconds after it appeared
 * — the password was on screen for less time than it takes to read, let alone
 * to copy. "Shown once only" was true in the worst possible way.
 *
 * It is dismissed by the Administrator now, not by the clock or by a render.
 * That is also the only version that can be trusted: a banner that disappears
 * on its own leaves somebody holding an account they cannot get into, and the
 * recovery is another reset.
 *
 * Copy is the point of the whole banner, so it is a button rather than a
 * text selection somebody has to drag across a monospace string.
 */
export function TempPasswordBanner({ flash }: { flash: TempPasswordFlash }) {
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  if (done) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(flash.password);
      setCopied(true);
      // Long enough to be noticed, short enough that the button is ready again
      // if the paste went somewhere wrong.
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard access can be refused — an insecure origin, or a browser
      // policy. The password is still on screen to select by hand, so there is
      // nothing worth interrupting anybody about.
    }
  }

  function dismiss() {
    setDone(true);
    startTransition(() => {
      void dismissTempPasswordAction();
    });
  }

  const isReset = flash.kind === "reset";

  return (
    <Alert kind="warning" className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <span>
          Temporary password for <strong>{flash.username}</strong>:
        </span>
        <code className="select-all rounded bg-white/60 px-2 py-1 font-mono text-sm">{flash.password}</code>
        <Button type="button" size="sm" variant="outline" onClick={copy}>
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" /> Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" /> Copy
            </>
          )}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={dismiss} disabled={pending}>
          Done
        </Button>
      </div>

      <span className="mt-1 block text-xs">
        {isReset
          ? "Stays here until you press Done. They must change it on next login."
          : "Stays here until you press Done. They must change it before they can use the system."}
      </span>
      {/* The password stays on screen whatever happened to the email, so the
          Administrator is never left without a way to hand it over. */}
      {flash.mail === "sent" && <span className="mt-1 block text-xs">A copy has been emailed to them.</span>}
      {flash.mail === "failed" && (
        <span className="mt-1 block text-xs font-medium">
          The welcome email could not be sent — pass this password on yourself.
        </span>
      )}
    </Alert>
  );
}
