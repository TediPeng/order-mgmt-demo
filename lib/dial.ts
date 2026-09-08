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

/**
 * The scheme actually used for one person.
 *
 * There is a company-wide setting and, optionally, a personal one. The personal
 * one wins when it is set, and null means "whatever the company says" — not
 * "off". That distinction is the whole point: an account that has never been
 * touched must keep behaving exactly as it did before this field existed.
 *
 * It exists because the rollout is gradual. Zoiper arrives on seventeen PCs
 * over days, not at once, and the setting it needs (`callto:`) does nothing on
 * a machine without Zoiper except raise a Windows dialog asking which program
 * should handle it — a question the agent cannot answer and will answer wrongly
 * once, permanently. So the company setting stays where it is and each agent is
 * moved as their machine is ready.
 *
 * The stored value is validated here rather than trusted. A column added by
 * hand, or a row written before the column existed, reads as something that is
 * not a scheme, and falling back is the only safe reading of that.
 */
export function resolveDialScheme(personal: unknown, company: DialScheme): DialScheme {
  return isDialScheme(personal) ? personal : company;
}

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
