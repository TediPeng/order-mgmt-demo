"use client";

import { useEffect, useRef } from "react";
import { Alert } from "@/components/ui/Alert";
import { dismissTempPasswordAction } from "@/lib/actions/users";
import type { TempPasswordFlash } from "@/lib/temp-password-flash";

/**
 * The one showing of a temporary password.
 *
 * A client component for one reason: a Server Component cannot write cookies,
 * so somebody has to clear the flash after it has been read, and the moment it
 * reaches the screen is the right one. Without that the cookie would sit until
 * it expired and the banner would return on every refresh — which is how
 * "Shown once only" becomes a claim the page does not keep.
 *
 * The password is rendered from a prop the server passed, never fetched here,
 * and the cookie it came from is httpOnly, so nothing on this page can read it
 * back after the clear.
 */
export function TempPasswordBanner({ flash }: { flash: TempPasswordFlash }) {
  // Strict Mode runs effects twice in development; a second delete is harmless,
  // but the guard keeps it to one request either way.
  const dismissed = useRef(false);

  useEffect(() => {
    if (dismissed.current) return;
    dismissed.current = true;
    // Deliberately not awaited and not surfaced: the banner is already on
    // screen and doing its job. A failure here means the cookie expires on its
    // own two minutes later, which is a worse outcome than this one, not a
    // broken one — and an error toast over a password nobody has copied yet
    // would be the real harm.
    void dismissTempPasswordAction();
  }, []);

  const isReset = flash.kind === "reset";

  return (
    <Alert kind="warning" className="mb-4">
      Temporary password for <strong>{flash.username}</strong>:{" "}
      <code className="rounded bg-white/60 px-1.5 py-0.5 font-mono">{flash.password}</code>
      <span className="mt-1 block text-xs">
        {isReset
          ? "Shown once only — copy it now. They must change it on next login."
          : "Shown once only — copy it now. They must change it before they can use the system."}
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
