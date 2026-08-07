import type { z } from "zod";

/** Names the offending field.
 *
 * A bare "Invalid input" says nothing about which of a dozen form fields was
 * rejected, which makes a schema mismatch effectively undebuggable from the
 * screen — and Zod's own defaults are exactly that whenever a field has no
 * custom message, or when a value arrives as null because its input was
 * disabled or missing from the form and never got submitted.
 *
 * Shared by every action that surfaces a parse failure through a redirect, so
 * the same mismatch reads the same way wherever it happens. */
export function describeParseFailure(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid input.";
  const field = issue.path.join(".");
  return field ? `${field}: ${issue.message}` : issue.message;
}
