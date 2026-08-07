This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | yes | Supabase project URL (server-side only). |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service-role key; all DB access goes through it (RLS has zero policies). |
| `ENCRYPTION_KEY` | for Pancake POS | Encrypts Pancake API keys / webhook secrets at rest (AES-256-GCM; the string is SHA-256-hashed into the AES key). Any random string ≥16 chars; generate with `openssl rand -hex 32`. Rotating it invalidates stored credentials — they must be re-entered in Settings → Integrations. |
| `CRON_SECRET` | for Pancake POS | Bearer token protecting `/api/cron/pancake-sync`. On Vercel, setting this env var makes Vercel Cron send it automatically. |
| `PANCAKE_MOCK_MODE` | optional | `success` / `fail` simulates the Pancake POS API locally (no real credentials needed); unset for real HTTP calls. |
| `APP_TIMEZONE` | optional | Defaults to `Asia/Manila`. |
| `SMTP_USER` | for email | The sending mailbox, e.g. `you@yourdomain.com`. |
| `SMTP_PASS` | for email | Gmail/Workspace **App Password**, not the account password — Google has refused plain passwords for SMTP since 2022, and an account without 2-Step Verification cannot create one. |
| `SMTP_HOST` | optional | Defaults to `smtp.gmail.com`. |
| `SMTP_PORT` | optional | Defaults to `465` (implicit TLS). `587` is used with STARTTLS instead. |
| `MAIL_FROM` | optional | From header; defaults to `4S ROMA <SMTP_USER>`. |
| `MAIL_MOCK_MODE` | optional | `success` / `fail` short-circuits SMTP locally, the same switch `PANCAKE_MOCK_MODE` gives the Pancake client. Unset for real delivery. |
| `NEXT_PUBLIC_APP_URL` | for email | Public base URL used to build links in emails. Falls back to `VERCEL_URL`, then `http://localhost:3000`. Set it in production so recipients get the custom domain rather than the per-deployment hostname. |

## Transactional email

Two emails, both sent over SMTP through `lib/mail/` (Gmail/Workspace by default):

- **Account created** — `createUserAction` emails the new user their username and temporary password. Mail is treated as optional infrastructure: if it is unconfigured or the send fails, the account is still created and the Administrator still sees the password on screen, which is the hand-over that worked before this email existed. The banner says which happened.
- **Password reset** — `/forgot-password` issues a single-use token that expires in an hour and emails the link. Only the SHA-256 hash is stored (`password_reset_tokens`), so a database dump yields no working links. The confirmation screen says the same thing whether or not the address matched an account, so it cannot be used to enumerate who has a login. A token that could not be delivered is retired immediately rather than left live.

`password_reset_tokens` has been applied to the **dev** project only. Production
(`4S RETENTION`) needs the same migration before the reset flow works there —
until it does, requesting a reset errors on the insert.

## Development and production databases

There are two Supabase projects, and `.env.local` decides which one the machine
you are sitting at talks to:

| | Project | Ref | Configured in |
| --- | --- | --- | --- |
| Production | `4S RETENTION` | `lvqpvcpcbjujcqlntjjn` | Vercel environment variables |
| Development | `4S ROMA DEV` | `dpyzykpiplupzcxcpiev` | `.env.local` |

**`.env.local` must point at the DEV project.** It did not always: both once
shared one project, and on 2026-08-07 a Clear Company Data click against
`localhost` deleted the live orders, attendance, notifications and the entire
audit trail. There is no backup on the free plan. Local development is not a
rehearsal unless the database is a different database.

The dev project carries the same schema — 30 tables, 92 indexes, 55 foreign
keys, RLS enabled with no policies, and the private `uploads` bucket — but no
data. On first run against an empty database the app seeds itself (see
`seedDb()` in `lib/db.ts`), so accounts appear on their own. Address reference
data does not: run `node scripts/seed-psgc.mjs` once to load the 84 provinces,
1,634 cities and 42,046 barangays the address picker needs.

## Pancake POS integration

Order lines: Pancake normally requires `items[].variation_id` pointing at a variation in the
shop's own catalog, so `products.pancake_variation_id` maps each product across. Products left
unmapped are sent as Pancake **quick-add (one-time) products** — name and price only, no
catalog entry and no Pancake inventory movement — when the account has that option enabled
(the default); with it off, such orders are held as Needs Review instead.

Two-way order sync lives in `lib/pancake/`. `lib/pancake/config.ts` is wired against the
**official Pancake POS OpenAPI spec** (base URL `https://pos.pages.fm/api/v1`, `api_key`
query-param auth, `POST/GET /shops/{SHOP_ID}/orders`, integer status codes). The API key is
created in Pancake at *Setting → Advance → Third-party connection → Webhook/API* — the same
screen configures webhooks (Webhook URL, webhook types, and custom Request Headers).
Pancake does not sign webhook payloads, so the receiver authenticates a request by any of:
an `X-API-KEY` request header matching the account's webhook secret (recommended — set it
under Request Headers in Pancake), an HMAC-SHA256 signature, or `?token=<secret>` on the URL.
With no webhook secret configured, the sweep polls instead. The `orders` webhook posts the
bare Order object; the parser also tolerates a `data`/`order` wrapper.

- Forward-on-Ready-to-Ship: `lib/pancake/forward.ts` (idempotency key = internal order id; exactly-once guards).
- Incoming updates: webhook `/api/webhooks/pancake` (HMAC-verified) → polling fallback → manual Sync Now.
- Retry queue + polling: `lib/pancake/sweep.ts`. It runs two ways — lazily (throttled,
  fire-and-forget) from the authenticated layout on page loads, and from
  `/api/cron/pancake-sync` via Vercel Cron. The cron is deliberately scheduled daily so it
  deploys on any Vercel plan (sub-daily schedules are a paid-plan feature); the lazy sweep is
  what keeps retries and polling timely, so the integration never depends on cron frequency.
  On a paid plan you can tighten `vercel.json` to `*/10 * * * *`.
- Settings (Management-only): `/settings/integrations` (accounts, encrypted credentials, Test Connection), `/settings/integrations/status-map`, `/settings/integrations/logs`.

## Production domain

The app is served at **https://www.4sdigitalmarketing-crm.com**. `www` is the
production alias; the bare domain 308-redirects to it. The domain is registered
at Porkbun, where DNS is also hosted — the apex is an `A` record to Vercel and
`www` a `CNAME` to a project-specific `*.vercel-dns-###.com` hostname, so do not
copy the shared IPs from older Vercel documentation.

`NEXT_PUBLIC_APP_URL` must match whatever is primary here, because every
password reset link is built from it. It is inlined at build time, so changing
it needs a redeploy **without** the build cache, not just a new environment
variable.

## Deployment region

`vercel.json` pins functions to `sin1` (Singapore) because the Supabase project lives in
`ap-southeast-1`. This is not a preference — it is load-bearing. Every request runs `readDb()`
(2 sequential round trips) and every save runs `writeDb()`, whose upserts and deletes are
deliberately sequenced parent-before-child and so cost ~15 more. On the default `iad1`
(Washington DC) that is ~17 crossings of the Pacific at 200ms+ each, adding seconds to a single
status change no matter how little data exists.

Keep the functions in whatever region the database is in. If the Supabase project is ever moved,
move this too.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
