/**
 * Reading a switch that a person typed into a box.
 *
 * Every one of these flags decides something large — where the clock lives, who
 * decides leave, whether the roster crosses — and each was compared against the
 * exact string "on". That is fine for a variable set by a script and wrong for
 * one set by a human in a dashboard, where the value field is a multi-line
 * textarea: a single Enter turns `on` into `on\n`, which looks identical on the
 * screen, reads identical in a screenshot, and matches nothing.
 *
 * That is not hypothetical. Two leave requests were filed against a correctly
 * named, correctly scoped, correctly valued PORTAL_LEAVE and neither crossed,
 * because of a character nobody can see.
 *
 * So: trimmed, lower-cased, and the words people actually use. Still explicit —
 * anything not in the list is off, and an unset variable is off, which is what
 * makes these safe to add before they are wanted.
 */
const ON = new Set(["on", "true", "1", "yes", "enabled"]);

export function envFlagIsOn(name: string): boolean {
  return ON.has(String(process.env[name] ?? "").trim().toLowerCase());
}
