# Value Investment

A stock screener and security-research workspace built with Next.js, React,
TypeScript, Tailwind, Cloudflare Workers, and D1.

The browser renders charts and instant valuation previews. Next.js route
handlers running in a Cloudflare Worker own market-data access, normalization,
canonical valuation and quality models, and workspace APIs. D1 persists
anonymous-user notes, sentiment, watch prices, saved screener definitions, and
saved result-page baselines. Market-data credentials never enter browser
bundles or API responses.

## Why this deploys to Workers, not Pages

This is a full-stack Next.js application with dynamic routes, server-side
rendering, D1 access, a Cron Trigger, and a server-only upstream credential.
Cloudflare's Pages path for Next.js is static export; Cloudflare directs
full-stack Next.js applications to Workers.

The supported deployment path used here is
[`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare), which packages
Next.js for a Cloudflare Worker. Workers Static Assets serves the frontend from
the same deployment, and D1 is bound directly to the Worker. You can attach the
same custom domain you intended to use with Pages, but this repository should
be created as a Workers deployment rather than a Pages project.

See [docs/cloudflare-architecture.md](docs/cloudflare-architecture.md) for the
deployment decision and [docs/calculation-ownership.md](docs/calculation-ownership.md)
for the calculation and persistence audit.

## Prerequisites

- Node.js `>=22.13.0`
- A Cloudflare account and Wrangler authentication for production deployment
- A valid upstream market-data cookie and permission to use and redistribute
  that provider's data

## Local setup

```bash
npm install
npm run cf:typegen
npm run db:migrate:local
npm run dev
```

The development wrapper reads `../skills/Cauth.json` in memory and exposes only
the composed upstream cookie to the local Next.js process. Alternatively, set
`AINVEST_C_COOKIE` in your shell. If the credential is missing or expired,
market-data APIs fail closed instead of returning fabricated fallback values.

Open the printed local URL, then use:

- `/value-opportunities` for the screener
- `/value-opportunities/nasdaq/msft/overview` for a security overview
- `/value-opportunities/{exchange}/{symbol}/cash-flow` for DCF analysis
- `/value-opportunities/{exchange}/{symbol}/market-comparison` for relative
  valuation
- `/value-opportunities/{exchange}/{symbol}/business-quality` for the
  server-computed quality model

Local D1 state is kept under `.wrangler/` and is ignored by Git.

## Cloudflare deployment

1. Authenticate and create the D1 database:

   ```bash
   npx wrangler login
   npx wrangler d1 create value-investment
   ```

2. Replace the placeholder `database_id` in `wrangler.jsonc` with the ID printed
   by Wrangler.

3. Regenerate binding types and apply the production migration:

   ```bash
   npm run cf:typegen
   npm run db:migrate:remote
   ```

4. Store the server-only market-data cookie as a Worker secret:

   ```bash
   npx wrangler secret put AINVEST_C_COOKIE
   ```

   Enter a value shaped like `userid=…; sessionid=…`. Never add it to
   `wrangler.jsonc`, an environment file, or source control.

5. Build, test, and deploy:

   ```bash
   npm test
   npm run deploy
   ```

6. Smoke-test the security summary, valuation, business-quality, screener, and
   workspace create/read/update/delete flows before attaching the production
   domain.

The production deployment is blocked until the placeholder D1 database ID is
replaced. The application does not ship a production credential or database ID.

The Worker applies an initial Cloudflare-native limit of 120 security API
requests and 30 screener requests per minute per connecting IP. Recalibrate
these coarse anonymous limits after observing production traffic.

## Commands

- `npm run dev` — start local Next.js with OpenNext's Cloudflare bindings
- `npm run build` — create the standard Next.js production build
- `npm run build:worker` — package Next.js as an OpenNext Cloudflare Worker
- `npm run preview` — build and preview the Worker locally with Wrangler
- `npm test` — type-check, build the Worker, and run unit, contract, render, and
  secret-leak tests
- `npm run typecheck` — check TypeScript and Cloudflare binding types
- `npm run lint` — run ESLint
- `npm run db:generate` — generate a migration after editing `db/schema.ts`
- `npm run db:migrate:local` — apply migrations to local D1
- `npm run db:migrate:remote` — apply migrations to production D1
- `npm run cf:typegen` — regenerate Cloudflare binding types
- `npm run deploy` — build and deploy the Worker and Static Assets with
  OpenNext

## Persistence model

The current workspace is anonymous and browser-scoped. A random 256-bit opaque,
HttpOnly cookie identifies a workspace; D1 stores only its SHA-256 digest. There
are no accounts or cross-device synchronization yet. Legacy `localStorage`
workspace data is imported once after the first successful D1 connection. An
attached daily Cron Trigger removes expired anonymous sessions and cascades
their workspace rows.

Saved screener baselines currently represent the visible result page, not a
complete market-universe snapshot. A global screener snapshot and scheduled
market-data refresh remain separate production-scale ingestion work.

## Known production limitations

- The full-market screener cache still lives in Worker isolate memory; it must
  move to a scheduled Worker/Queue plus a generation-based D1 snapshot before
  global counts are production-grade.
- Saved screener baselines compare only the visible result page.
- Interactive DCF assumptions are not persisted unless a future “Save model”
  feature stores a versioned run.
- Anonymous workspaces cannot be recovered or synchronized across devices.
- The upstream session cookie can expire, and provider data-use and
  redistribution rights remain a launch gate.
