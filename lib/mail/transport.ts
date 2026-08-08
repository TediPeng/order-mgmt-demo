import nodemailer, { type Transporter } from "nodemailer";

/** Outbound mail over SMTP. Server-only -- it reads SMTP credentials from the
 * environment, so never import it from a client component.
 *
 * Gmail and Google Workspace are the expected hosts, so the defaults point
 * there and `SMTP_PASS` means an App Password -- Google has refused plain
 * account passwords for SMTP since 2022, and an account without 2-Step
 * Verification cannot create one.
 *
 * Mail is optional infrastructure. With no credentials configured the app
 * still runs and every caller falls back to whatever it did before mail
 * existed, because an Administrator being unable to create an account is a
 * far worse failure than an account being created without its welcome email.
 * That is why nothing here throws.
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type MailResult = { ok: true; mocked: boolean } | { ok: false; error: string };

/** `success` / `fail` short-circuits SMTP for local work, the same switch
 * PANCAKE_MOCK_MODE gives the Pancake client. Unset means real delivery. */
const mockMode = () => process.env.MAIL_MOCK_MODE;

export function isMailConfigured(): boolean {
  return Boolean(mockMode() || (process.env.SMTP_USER && process.env.SMTP_PASS));
}

/** The From header, or null when one cannot be built honestly.
 *
 * MAIL_FROM wins. Falling back to SMTP_USER only works while the username is
 * itself an address, which is true of Gmail and false of most transactional
 * providers -- Resend authenticates as the literal string `resend`, and
 * "4S ROMA <resend>" is not an address. Rather than hand that to the server
 * and let it fail somewhere less legible, this returns null and the send is
 * refused with a message naming the variable to set. */
export function mailFrom(): string | null {
  const explicit = process.env.MAIL_FROM?.trim();
  if (explicit) return explicit;
  const user = process.env.SMTP_USER?.trim();
  return user && user.includes("@") ? `4S ROMA <${user}>` : null;
}

let cached: Transporter | null = null;

/** Built on first send rather than at import, so a deployment with no mail
 * configured does not fail to boot -- and so a key added in the Vercel
 * dashboard takes effect on the next cold start without a code change. */
function transporter(): Transporter {
  if (cached) return cached;
  const port = Number(process.env.SMTP_PORT || 465);
  cached = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    // 465 is implicit TLS; 587 opens in the clear and upgrades, so STARTTLS is
    // required explicitly rather than left to the server to offer.
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    // Fail fast. Nodemailer's defaults wait two minutes to connect and ten on
    // a quiet socket, and a send happens inside a request the user is watching
    // -- so a wrong port does not report a wrong port, it hangs the page until
    // the platform kills the function. Ten seconds is far more than a healthy
    // SMTP server in the same region needs, and short enough that a
    // misconfiguration comes back as an error someone can read.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return cached;
}

/** Sends one message. Resolves with a result instead of throwing -- callers
 * decide what a failure means, and none of them should abandon the work they
 * were already committing. */
export async function sendMail(message: MailMessage): Promise<MailResult> {
  const mock = mockMode();
  if (mock === "fail") return { ok: false, error: "MAIL_MOCK_MODE=fail" };
  if (mock) {
    console.info(`[mail:mock] to=${message.to} subject=${message.subject}`);
    return { ok: true, mocked: true };
  }

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return { ok: false, error: "SMTP_USER / SMTP_PASS are not configured" };
  }

  const from = mailFrom();
  if (!from) {
    return {
      ok: false,
      error: "MAIL_FROM is not set, and SMTP_USER is not an email address to fall back to.",
    };
  }

  try {
    await transporter().sendMail({ from, ...message });
    return { ok: true, mocked: false };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // The recipient and subject are safe to log; the body is not, because on
    // these two templates it is a password or a reset link.
    console.error(`[mail] send failed to=${message.to} subject=${message.subject}: ${error}`);
    return { ok: false, error };
  }
}
