# Value Investment

A stock screener and security-research workspace built with Next.js, React,
TypeScript, Tailwind, Cloudflare Workers, and D1.

The browser renders charts and provider-backed valuation evidence. Next.js route
handlers running in a Cloudflare Worker own market-data access, normalization,
canonical valuation and quality models, and workspace APIs. D1 persists
anonymous saved-screener definitions and the ranked Top 1,000 market-cap
universe together with a durable daily screener snapshot. Each snapshot stores
normalized source metrics, precomputed filter memberships, and one compact
client payload. The screener downloads that payload once, then filters, sorts,
and paginates locally without another data request. Market-data credentials
never enter browser bundles or API responses.

Every screener request applies the Top 1,000 membership together with an
immutable NYSE/NASDAQ scope. Five-year operating-margin stability and trend are
derived from annual provider fundamentals in the server-side scan. The daily
snapshot also precomputes value-investing memberships for a margin of safety ≥
20%, positive P/E ≤ 15×, FCF yield ≥ 5%, positive EV / EBITDA ≤ 10×, FCF /
earnings ≥ 80%, ROIC ≥ 15%, and net debt / positive FCF ≤ 1.5×. Missing or
invalid denominators fail closed.

## Why this deploys to Workers, not Pages

This is a full-stack Next.js application with dynamic routes, server-side
rendering, D1 access, Cron Triggers, and a server-only upstream credential.
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
for calculation and persistence ownership. The detail-page audit and field
lineage are recorded in
[docs/security-detail-data-lineage.md](docs/security-detail-data-lineage.md).

## Prerequisites

- Node.js `>=22.13.0`
- A Cloudflare account and Wrangler authentication for production deployment
- A valid AInvest account and permission to use and redistribute that
  provider's data

## Local setup

The repository keeps all local environment configuration in one private file:
`site/.dev.vars`. Copy the tracked template, then fill in the credentials that
will be shared privately with each trusted contributor:

```bash
cp .dev.vars.example .dev.vars
chmod 600 .dev.vars
```

```dotenv
AINVEST_USERID=your-account-userid
AINVEST_SESSIONID=your-account-sessionid
```

Obtain these two values from an authenticated AInvest browser session. They are
used only to construct the server-side C-side `Cookie` header. Do not commit
`.dev.vars`, paste it into issues, or send it through a public channel. Session
identifiers can expire or be revoked; replace both values when the application
reports that the live market-data session is unavailable. The application does
not attempt an email/password login because AInvest now requires an interactive
email-certification step that is not available to this server-side flow. If the
session is missing or rejected, market-data APIs fail closed without inserting
snapshot or fabricated substitute values.

Then install and start the application:

```bash
npm install
npm run cf:typegen
npm run db:migrate:local
npm run dev
```

The screener uses its durable daily snapshot as its primary data source. A
local clone must have a local snapshot generation (or run the explicit seed
command below) before screener rows are available. The security research APIs
do not use screener snapshots as fallback data; they require live AInvest data.

To regenerate a complete snapshot from AInvest into local D1, run:

```bash
npm run seed:local
```

That optional command uses `.dev.vars`, writes only under `.wrangler/`, and may
take several minutes. An optional US trading date can be supplied for repeatable
testing:

```bash
npm run seed:local -- 2026-08-24
```

Edit the application normally after startup; Next.js hot reload shows code and
UI changes immediately. Push to `main` to run validation and deploy the same
source architecture to the live Worker.

Open the printed local URL, then use:

- `/value-opportunities` for the screener
- `/value-opportunities/nasdaq/msft/overview` for a security overview
- `/value-opportunities/{exchange}/{symbol}/cash-flow` for DCF analysis
- `/value-opportunities/{exchange}/{symbol}/market-comparison` for relative
  valuation
- `/value-opportunities/{exchange}/{symbol}/business-quality` for the
  server-computed quality model

Local D1 state is kept under `.wrangler/` and is ignored by Git.

## Automatic deployment from GitHub

Every push to `main` runs the test suite and deploys the Worker through
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml). Configure these
GitHub Actions repository secrets once:

- `CLOUDFLARE_API_TOKEN` — a scoped Cloudflare API token with Workers Scripts,
  Workers Routes, D1, and account access needed by this project
- `CLOUDFLARE_ACCOUNT_ID` — the Cloudflare account ID that owns the Worker and D1

Production AInvest session identifiers remain Cloudflare Worker secrets and are
not put in GitHub Actions or source control. After updating the private local
`.dev.vars` file, rotate both production secrets together with the repository
script:

```bash
npm run rotate:ainvest -- --dry-run
npm run rotate:ainvest -- --verify
```

The script reads the two values from `.dev.vars`, validates them, and sends the
required JSON payload to `wrangler secret bulk` over stdin. The values never
appear in command arguments, logs, or files created by the script. Use `--verify`
to make a small authenticated AInvest snapshot request before updating
Cloudflare. The script requires the credential file to be private (`chmod 600`).
If you prefer to update secrets manually, use `npx wrangler secret put` for each
key and never paste the values into a shell command.

After that, collaborators can work locally, push a reviewed change to `main`,
and GitHub Actions will run validation, apply migrations, and deploy the live
Worker. The workflow intentionally deploys only the `main` branch.

## Cloudflare deployment

1. Authenticate with Cloudflare:

   ```bash
   npx wrangler login
   ```

   The current Cloudflare account already has the `value-investment` D1
   database bound in `wrangler.jsonc`. When deploying to a different account,
   create a new database with `npx wrangler d1 create value-investment` and
   replace the checked-in `database_id`.

2. Regenerate binding types and apply the production migration:

   ```bash
   npm run cf:typegen
   npm run db:migrate:remote
   ```

3. Store the server-only AInvest session identifiers as Worker secrets:

   ```bash
   npm run rotate:ainvest -- --verify
   ```

   This verifies the local C-side session and atomically updates both encrypted
   Worker secrets. Never add either value to `wrangler.jsonc`, a browser
   environment variable, or source control. Rotate both secrets together when
   the browser session is expired or rejected.

4. Build, test, and deploy:

   ```bash
   npm test
   npm run deploy
   ```

5. Smoke-test the security summary, valuation, business-quality, screener, and
   saved-screener create/read/update/delete flows before attaching the
   production domain.

The application does not ship the production market-data credential; it remains
an encrypted Worker secret.

The Worker applies an initial Cloudflare-native limit of 120 security API
requests and 30 screener requests per minute per connecting IP. Recalibrate
these coarse anonymous limits after observing production traffic.

## Contributing

1. Fork the GitHub repository or create a branch from `main`.
2. Install Node.js `>=22.13.0` and npm.
3. Follow [Local setup](#local-setup), including the private `.dev.vars` file.
4. Make focused changes and add or update tests for behavior changes.
5. Run the relevant checks before opening a pull request:

   ```bash
   npm run typecheck
   npm run lint
   npm test
   ```

6. Review `git diff` and confirm that `.dev.vars`, `.wrangler/`, build output,
   and credentials are not staged. Open a pull request against `main` with a
   short description, test commands, migration notes, and screenshots for UI
   changes.

Never commit credentials, Cloudflare API tokens, generated local databases, or
provider cookies. Use the tracked `.dev.vars.example` as the configuration
shape, and ask the project owner for private values through a separate channel.
For production work, contributors should use their own Cloudflare account or
explicitly authorized access; do not share Wrangler tokens in the repository.

## Commands

- `npm run dev` — load ignored local secrets and start Next.js with OpenNext's
  Cloudflare bindings
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
are no accounts or cross-device synchronization yet. It persists saved-screener
definitions only. Legacy `localStorage` saved-screener data is imported once
after the first successful D1 connection. The screener Cron Trigger uses a
DST-safe UTC grid and a New York wall-clock gate. It attempts the server-side
calculation at 08:00, 08:30, and 09:00 ET on US equity trading days only, before
the 09:30 ET regular-session open. The first successful attempt atomically
publishes a complete D1 generation; later attempts are idempotent no-ops unless
an earlier attempt failed. A durable run ledger keyed by `YYYY-MM-DD` records the attempt,
status, and stored generation. Daily-linked generations are retained when
routine cleanup removes abandoned or superseded non-daily generations.
Weekends, recurring full-day exchange holidays, and confirmed one-off closures
are skipped. The same accepted trigger removes
expired anonymous sessions. A separate trigger refreshes the ranked Top 1,000
company universe on the last UTC day of every month; the next trading-day
calculation publishes results for that universe.
Public screener requests only read an active stored generation; a newly migrated
empty database remains unavailable until the scheduled refresh or an explicit
administrative seed publishes one. Every published generation is created by a
server-side AInvest refresh, validated before activation, and carries its
calculation timestamp and ETag. The compact screener endpoint revalidates
against D1 on every request and is `no-store`; it is never served from an
unversioned edge or checkout-file cache. Filter-schema versioning keeps older
stored generations readable while hiding controls that require newer source
metrics.

## Known production limitations

- Stored screener quotes reflect the latest successful daily snapshot rather
  than every intraday tick. Security-research pages still retrieve live quotes
  when opened.
- Cross-sector value multiples are starting points for research, not
  recommendations. Banks, insurers, REITs, utilities, and cyclical businesses
  need sector-appropriate or normalized denominators before an investment
  decision.
- Company DCF, relative-valuation, peer, and business-quality views apply only
  to catalog common and depositary equities. ETFs, preferreds, warrants, units,
  rights, and debt receive an explicit unsupported-security response instead of
  a mostly blank corporate model.
- Current provider DCF references are read from AInvest's fair-value module when requested. Historical
  saved valuation runs are not persisted unless a future “Save model” feature
  stores normalized inputs, provenance, and a model version.
- Anonymous workspaces cannot be recovered or synchronized across devices.
- AInvest's private email/password endpoint requires an interactive
  email-certification value that the Worker cannot obtain reliably. Production
  therefore uses manually rotated C-side session identifiers; provider
  availability, data-use, and redistribution rights remain launch gates.
