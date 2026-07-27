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
