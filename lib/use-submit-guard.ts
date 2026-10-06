"use client";

import { useRef, useState } from "react";

/**
 * Stops a form being submitted twice by a double-click.
 *
 * A ref rather than state alone, because the second click of a double-click
 * arrives before React has re-rendered the first one's disabled button — state
 * is for the label, the ref is what actually blocks.
 *
 * `useFormStatus` would be the obvious tool and is not available: the installed
 * react-dom does not export it, which components/ClearDataButton.tsx found the
 * hard way.
 *
 * The guard releases itself after ten seconds. A server action that answers with
 * an error instead of navigating leaves the form mounted, and a Save button
 * disabled for good is a worse fault than the double it prevents. On success the
 * page has gone by then and nothing needs releasing.
 */
const RELEASE_MS = 10_000;

export function useSubmitGuard() {
  const inFlight = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  /** Call first in the form's onSubmit. Returns false when this is the second
   *  click and the event has been cancelled. */
  function guardSubmit(e: { preventDefault: () => void }): boolean {
    if (inFlight.current) {
      e.preventDefault();
      return false;
    }
    inFlight.current = true;
    setSubmitting(true);
    window.setTimeout(() => {
      inFlight.current = false;
      setSubmitting(false);
    }, RELEASE_MS);
    return true;
  }

  /** For a form that decided not to submit after all — a validation failure —
   *  so the control does not sit dead for ten seconds over a typo. */
  function releaseGuard(): void {
    inFlight.current = false;
    setSubmitting(false);
  }

  return { submitting, guardSubmit, releaseGuard };
}
