"use client";

import { Button } from "@/components/ui/Button";
import { useSubmitGuard } from "@/lib/use-submit-guard";

/**
 * A submit button that refuses its own second click.
 *
 * For forms that live in a server component and so cannot hold the guard
 * themselves. A client form should put useSubmitGuard() in its own onSubmit
 * instead: the guard then sits after whatever validation the form does, so a
 * rejected submit does not leave the button sitting dead.
 */
export function GuardedSubmit({
  children,
  pendingLabel,
  variant,
  size,
  className,
  disabled,
}: {
  children: React.ReactNode;
  /** Shown while the guard is closed. Defaults to the normal label. */
  pendingLabel?: React.ReactNode;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
  disabled?: boolean;
}) {
  const { submitting, guardSubmit } = useSubmitGuard();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      className={className}
      disabled={disabled || submitting}
      onClick={guardSubmit}
    >
      {submitting && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
