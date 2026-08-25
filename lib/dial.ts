/**
 * Turning a stored phone number into something a softphone will answer.
 *
 * The floor runs Zoiper against their own Asterisk. Nothing in this app talks
 * to that PBX — an agent still presses Calling and saves the outcome by hand —
 * but the number itself no longer has to be read off the screen and typed into
 * a dialler, which is where a wrong digit comes from.
 *
 * The scheme is a setting because it is a fact about the agent's PC, not about
 * this app: Zoiper registers `callto:`, `sip:` and `tel:` on Windows, and so do
 * Skype, Phone Link and anything else installed. Which one actually reaches
 * Zoiper is discoverable only by trying it there, so it must be changeable
 * without a deploy.
 */

export const DIAL_SCHEMES = ["tel", "callto", "sip", "off"] as const;
export type DialScheme = (typeof DIAL_SCHEMES)[number];

export const DIAL_SCHEME_LABELS: Record<DialScheme, string> = {
  tel: "tel: — the standard, and what most handlers claim",
  callto: "callto: — Zoiper's own, usually the one that works",
  sip: "sip: — dial the SIP URI directly",
  off: "Off — show numbers as plain text",
};

export function isDialScheme(value: unknown): value is DialScheme {
  return typeof value === "string" && (DIAL_SCHEMES as readonly string[]).includes(value);
}

/**
 * The dialable form of a number, or null when there is nothing to dial.
 *
 * Digits and a leading `+` only. Everything a person types to make a number
 * readable — spaces, dashes, brackets — is meaningless to a dialler and some
 * handlers refuse the whole URL over it. The number is otherwise left exactly
 * as stored: the floor's dialplan expects what the floor already dials, and
 * "helpfully" converting 0917 to +63917 would be this app guessing at somebody
 * else's Asterisk.
 */
export function dialHref(phone: string | null | undefined, scheme: DialScheme): string | null {
  if (scheme === "off") return null;
  const raw = String(phone ?? "").trim();
  if (!raw) return null;

  const plus = raw.startsWith("+");
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return null;

  return `${scheme}:${plus ? "+" : ""}${digits}`;
}
