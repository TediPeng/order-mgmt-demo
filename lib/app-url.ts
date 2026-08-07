/** The application's own public base URL, for links that leave the app -- in
 * an email there is no request to make a relative path meaningful.
 *
 * `NEXT_PUBLIC_APP_URL` wins so a custom domain is what recipients see;
 * `VERCEL_URL` is the per-deployment hostname Vercel always sets, which is
 * right on a preview and merely ugly on production. Localhost is the fallback
 * so links are still clickable in development. Never trust a request Host
 * header for this -- an emailed link built from an attacker-supplied header is
 * how password reset flows get hijacked.
 */
export function appBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
