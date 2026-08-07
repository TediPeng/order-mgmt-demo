import type { MailMessage } from "./transport";

/** The two transactional emails the app sends. Both carry a secret, so both
 * are deliberately plain: no tracking pixels, no remote images, and a text
 * part that says everything the HTML part does -- a mail client showing only
 * the text alternative must not leave someone unable to sign in. */

const BRAND = "#8f660c";

function layout(heading: string, body: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
      <tr>
        <td style="padding:24px 28px;">
          <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${BRAND};font-weight:600;">4S ROMA</p>
          <h1 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#0f172a;">${heading}</h1>
          ${body}
        </td>
      </tr>
    </table>
    <p style="max-width:520px;margin:16px auto 0;font-size:12px;color:#94a3b8;text-align:center;">
      Retention Order Management Application
    </p>
  </body>
</html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0;"><a href="${href}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px;">${label}</a></p>`;
}

/** HTML-escapes interpolated values. A generated password contains characters
 * from `!@#$%^&*?` and a full name is free text, so neither can be dropped
 * into markup raw without the chance of mangling the message. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function accountCreatedEmail(params: {
  to: string;
  fullName: string;
  username: string;
  tempPassword: string;
  loginUrl: string;
}): MailMessage {
  const { to, fullName, username, tempPassword, loginUrl } = params;
  const firstName = fullName.split(" ")[0] || fullName;

  const text = [
    `Hi ${firstName},`,
    ``,
    `An account has been created for you on 4S ROMA.`,
    ``,
    `Username: ${username}`,
    `Temporary password: ${tempPassword}`,
    ``,
    `Sign in at ${loginUrl}`,
    ``,
    `You will be asked to choose your own password the first time you sign in.`,
    `This temporary one stops working at that point, so there is no need to keep this email.`,
    ``,
    `If you were not expecting this account, tell your Administrator -- do not sign in.`,
  ].join("\n");

  const html = layout(
    "Your account is ready",
    `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;">Hi ${esc(firstName)}, an account has been created for you on 4S ROMA.</p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
       <tr><td style="padding:14px 16px;font-size:14px;">
         <p style="margin:0 0 6px;color:#64748b;font-size:12px;">Username</p>
         <p style="margin:0 0 14px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;">${esc(username)}</p>
         <p style="margin:0 0 6px;color:#64748b;font-size:12px;">Temporary password</p>
         <p style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;">${esc(tempPassword)}</p>
       </td></tr>
     </table>
     ${button(loginUrl, "Sign in")}
     <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#475569;">You will be asked to choose your own password the first time you sign in. The temporary one stops working at that point, so there is no need to keep this email.</p>
     <p style="margin:0;font-size:13px;line-height:1.6;color:#475569;">If you were not expecting this account, tell your Administrator &mdash; do not sign in.</p>`
  );

  return { to, subject: "Your 4S ROMA account", text, html };
}

export function passwordResetEmail(params: {
  to: string;
  fullName: string;
  resetUrl: string;
  expiresInMinutes: number;
}): MailMessage {
  const { to, fullName, resetUrl, expiresInMinutes } = params;
  const firstName = fullName.split(" ")[0] || fullName;

  const text = [
    `Hi ${firstName},`,
    ``,
    `Someone asked to reset the password on your 4S ROMA account.`,
    ``,
    `Open this link to choose a new one:`,
    resetUrl,
    ``,
    `The link works once and expires in ${expiresInMinutes} minutes.`,
    ``,
    `If this was not you, no action is needed -- your password has not changed.`,
  ].join("\n");

  const html = layout(
    "Reset your password",
    `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;">Hi ${esc(firstName)}, someone asked to reset the password on your 4S ROMA account.</p>
     ${button(resetUrl, "Choose a new password")}
     <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#475569;">The link works once and expires in ${expiresInMinutes} minutes.</p>
     <p style="margin:0;font-size:13px;line-height:1.6;color:#475569;">If this was not you, no action is needed &mdash; your password has not changed.</p>`
  );

  return { to, subject: "Reset your 4S ROMA password", text, html };
}
