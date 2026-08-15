/**
 * Stops Enter from submitting a form from inside a text field.
 *
 * Browsers submit a form when Enter is pressed in a single-line input — implicit
 * submission, and it is on by default. On a lead form that means tabbing to the
 * phone number, pressing Enter out of habit, and having the whole lead saved
 * half-filled: the agent was still typing, the form was not finished, and
 * nothing asked.
 *
 * Textareas keep Enter, because there it means a new line. Buttons keep it,
 * because there it means press this button — so Save still works from the
 * keyboard when Save is what has focus. Everything else is swallowed, which
 * leaves exactly one way to submit these forms: the button that says so.
 */
export function blockImplicitSubmit(e: React.KeyboardEvent<HTMLFormElement>): void {
  if (e.key !== "Enter") return;

  const el = e.target as HTMLElement | null;
  if (!el) return;

  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "BUTTON") return;
  // A focused submit input is the same case as a button.
  if (tag === "INPUT" && (el as HTMLInputElement).type === "submit") return;

  e.preventDefault();
}
