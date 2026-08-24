# Calculation ownership

This document records every meaningful calculation found in the browser-facing
code, where its authoritative implementation belongs, and whether its output
should be persisted.

In the deployed architecture, **backend canonical** means a Next.js route
handler or server module packaged by `@opennextjs/cloudflare` and executed in
the Cloudflare Worker. **D1** means the database binding on that same Worker.
The deployment adapter does not change the calculation boundary: presentation
math stays in the browser, investment semantics stay on the server, and only
durable user intent or deliberately captured history is stored.

The boundary used by this project is:

- **Backend canonical** for investment meaning: valuation, ratios, scoring,
  normalization, screening, and any label that could affect an investment
  interpretation.
- **Provider-backed/backend canonical** for current company valuation: the
  Worker parses AInvest modules and calculates only documented aggregates.
- **Client only** for formatting, responsive layout, chart coordinates,
  pagination text, and other ephemeral presentation state.
- **D1** for durable user intent or history, not for values that can be
  deterministically recomputed from current inputs.

## Inventory and decisions

### Valuation and security summary

| Calculation | Current authoritative code | Owner | Persist? | Migration status |
| --- | --- | --- | --- | --- |
| DCF value | AInvest `stockdiag_fundamental_value_dcf`, parsed in `lib/security/valuation.ts` | Provider-backed/backend canonical | No | The overview, cash-flow view, and screener require the value at the latest returned date to be positive. The provider does not return the discount rate, terminal growth, forecast horizon, terminal value, or per-share bridge, so the result is explicitly disclosed as not locally reproducible. |
| Reported and forecast FCF evidence | AInvest `stockdiag_fundamental_future_growthforecast`, parsed in `lib/security/valuation.ts` | Provider-backed/backend canonical | No | The API returns normalized points plus latest-four, forward-four, and forward-growth aggregates. Labels say “returned periods” because continuity and future-date status are not inferred. This separate series is not presented as an input to the provider DCF. |
| Peer P/E, P/S, and P/B medians | `lib/security/valuation.ts`; summary peers in `lib/security/peers.ts` | Backend canonical | No | Migrated. |
| Per-share denominators and peer-multiple implied values | `lib/security/valuation.ts` | Backend canonical | No | Company price divided by its matching current multiple keeps the denominator share-class consistent. |
| Relative valuation aggregate | `lib/security/valuation.ts` (`medianPositive`) | Backend canonical | No, unless part of a saved valuation run | Uses the median of available positive PE-, PS-, and PB-implied values and identifies the policy in the response. |
| Relative premium/discount shown on each multiple card | `lib/security/valuation.ts` | Backend canonical | No | Migrated into each server-computed `RelativeMeasure`. |
| Summary fair-value selection | `lib/security/service.ts` | Backend canonical | No | Uses the provider DCF when available and otherwise falls back to the peer estimate; the methods remain separately visible. |
| Implied value gap | `lib/security/derivations.ts` (`selectedValue / price - 1`) | Backend canonical | No | Migrated for summary and screener responses. It is labelled as implied upside/downside, not the conventional discount-to-value denominator. |
| Opportunity label thresholds | `lib/security/valuation.ts` (`opportunityLabel`) | Backend canonical | No | The API applies exact unrounded boundaries: at least 20%, 0% to below 20%, -10% to below 0%, and below -10%; the browser does not recalculate the label. |
| Net margin and free-cash-flow margin on the summary | `lib/security/service.ts` | Backend canonical | No | Migrated into `SecuritySummaryResponse.derived`. |
| Summary narrative percentages and labels | `lib/security/service.ts` (`metricNarrative`) | Backend canonical | No | Already server-side. |

The summary and relative-analysis paths both use peer-implied values. Their
aggregation policy must stay identical. Keep a parity test around
`derivePeerValue` and `calculateRelativeValuation` whenever that policy changes.

### Business quality

The canonical business-quality response is built by
`lib/security/business-quality-service.ts` and versioned by
`BUSINESS_QUALITY_MODEL_VERSION`.

| Calculation | Current authoritative code | Owner | Persist? | Migration status |
| --- | --- | --- | --- | --- |
| Gross, operating, EBIT, EBITDA, net, and FCF margins | `lib/security/business-quality.ts` | Backend canonical | No | Migrated. |
| Cash conversion (`FCF / net income`) | `lib/security/business-quality.ts` | Backend canonical | No | Migrated. |
| ROE normalization and ROIC/ROA/asset-turnover selection | `lib/security/business-quality.ts` plus `lib/security/profitability.ts` | Backend canonical | No | Migrated. Missing source inputs remain `null`. |
| Net debt and enterprise value | `lib/security/business-quality.ts` | Backend canonical | No | Migrated. |
| Cash return on enterprise value, FCF yield, and earnings yield | `lib/security/business-quality.ts` | Backend canonical | No | Migrated. |
| Net debt / FCF | `lib/security/business-quality.ts` | Backend canonical | No | Migrated. |
| Revenue and net-income CAGR | `lib/security/business-quality.ts` (`annualizedGrowth`) | Backend canonical | No | Migrated, with elapsed calendar years used when available. |
| Latest margin versus preceding three-period average | `lib/security/business-quality.ts` | Backend canonical | No | Migrated. |
| Earnings consistency | `lib/security/business-quality.ts` | Backend canonical | No | Migrated. |
| Weighted 0–100 quality score and component credits | `lib/security/business-quality.ts` | Backend canonical | No, unless an explicit historical snapshot is saved | Migrated and model-versioned. |
| Diligence pass/watch states | `lib/security/business-quality.ts` | Backend canonical | No | Migrated. |
| Quality-and-price opportunity signals | `lib/security/business-quality.ts` | Backend canonical | No | Migrated. |
| Margin tone thresholds and capital-return interpretations | `lib/security/business-quality.ts` | Backend canonical | No | Migrated. The client receives tones and explanation text with the model response. |
| Peer net margin and ROE | Direct AInvest TTM indicators, normalized in `lib/security/peers.ts` with the same ratio metadata policy as company values | Provider-backed/backend canonical | No | Missing direct values remain null; scaled `ratio2` values are converted to fractions, and multiples are never used to fabricate profitability. |
| Peer medians for direct profitability | `lib/security/business-quality-service.ts` | Backend canonical | No | Calculated from available direct peer ratios. |
| Company-versus-peer net-margin gap and narrative | `lib/security/business-quality-service.ts` | Backend canonical | No | Migrated. |
| Score ring angle, score-component bar widths, and cash-conversion gauge width | `components/security/business-quality/BusinessQualityClient.tsx` | Client only | No | Correct presentation-only calculations. |
| Profitability chart ratio-to-percent conversion, row slicing, and axes | `components/security/business-quality/BusinessQualityCharts.tsx` | Client only | No | Correct presentation-only calculations. |
| Earnings-to-cash bridge differences | `lib/security/bridges.ts` | Backend canonical | No | Migrated. The quality API returns labeled bridge rows; the client calculates only bar geometry. |

### Screener

| Calculation | Current authoritative code | Owner | Persist? | Migration status |
| --- | --- | --- | --- | --- |
| Provider DCF / price value gap | `lib/screener/service.ts`, using `deriveMispricing` | Backend canonical | Persist only as part of a durable screener snapshot | Uses the positive value at the latest returned provider DCF date divided by positive stored price, minus one. There is no Overview peer fallback in screener rows. |
| Filter evaluation across the visible filter library | `lib/screener/filter-presets.ts` | Backend canonical membership; client combines stored memberships | Yes, as a compact bit mask in each immutable snapshot row | Each daily snapshot precomputes every filter once. The browser intersects selected bits without a new request. |
| Five-year operating-margin stability and trend | `lib/screener/operating-margins.ts` | Backend canonical | Yes, with the immutable detailed snapshot | Uses the latest five consecutive fiscal years. Stable means a range of at most five percentage points; expanding requires a positive least-squares annual slope and a latest margin above the earliest. Missing histories do not match. |
| Provider-value-gap and positive P/E screens | `lib/screener/filter-presets.ts` | Backend canonical membership | Yes, in the immutable snapshot mask | The provider DCF value gap matches at 20% or more. The earnings-multiple screen requires a finite positive P/E no greater than 15×, so loss-making companies never pass through a negative multiple. |
| FCF yield and cash conversion | `lib/screener/filter-presets.ts` | Backend canonical membership | Yes, in the immutable snapshot mask | FCF yield is positive TTM free cash flow divided by positive market cap and matches at 5% or more. Cash conversion requires positive TTM net income and FCF, then matches at FCF / net income of 80% or more. Missing or nonpositive denominators never match. |
| EV / EBITDA, ROIC, and net debt / FCF screens | `lib/screener/filter-presets.ts` | Backend canonical membership | Yes, with their normalized source values in the detailed snapshot and their bits in the client mask | EV / EBITDA must be positive and at most 10×; display-normalized ROIC must be at least 15%; net debt / FCF requires positive TTM FCF and must be at most 1.5×, so a signed net-cash value also passes. Missing values never match. |
| Sort ordering and null handling | `lib/screener/service.ts` (`sortScreenerRows`) | Backend canonical | Persist the user's sort choice | Already server-side. |
| Result count, offset, and total pages | `components/screener/ScreenerClient.tsx` | Client presentation over the validated complete generation | No | Recomputed locally after filter selection so pagination changes instantly. |
| Mapping UI filter IDs to stored membership bits | `lib/screener/filter-presets.ts` and `components/screener/screener-data.ts` | Shared contract | The resulting mask is stored | The client does not reproduce financial thresholds; it only combines server-precomputed bits. |
| Filter-mask schema compatibility | `lib/screener/snapshot.ts`, `lib/screener/client-snapshot-contract.ts`, and `lib/screener/client-snapshot-cache.ts` | Backend and transport contract | Yes, on each generation | Schema-one and schema-two payloads remain readable during the schema-three rollout but are not cached under the schema-three key. Controls whose threshold semantics require schema three stay hidden until compatible stored data loads. Retired momentum and debt/equity bit positions remain reserved for old generations and are never written by schema three. Unknown future schemas fail closed. |
| Daily pre-open snapshot execution | `lib/screener/daily-refresh.ts`, `lib/screener/schedule.ts`, and `lib/market-calendar.ts` | Backend canonical | Yes, one D1 ledger row per New York trading date | Cloudflare supplies a UTC candidate grid; the Worker admits 08:00, 08:30, and 09:00 ET on supported NYSE trading days. A leased, deterministic `daily-YYYY-MM-DD` generation makes duplicate attempts no-op and allows failed or expired attempts to retry before the 09:30 core open. |
| Top 1,000 market-cap membership and rank | `lib/screener/universe.ts` | Backend canonical | Yes, in D1 | Refreshed on the last UTC day of each month; screener evaluation always intersects the stored membership with NYSE and NASDAQ. The next accepted trading-day job snapshots the refreshed universe. |
| Pagination range text | `components/screener/ScreenerClient.tsx` | Client only | No | Correct presentation-only calculation. |
| Percent/currency display, value tone, and result caption | `components/screener/ScreenerClient.tsx` | Client presentation | No | The descriptive caption uses the unrounded displayed gap: above +1% positive, below -1% negative, and the inclusive interval between them within ±1%. It does not claim intrinsic undervaluation. |
| Logo fallback hue from ticker text | `components/CompanyLogo.tsx` | Client only | No | Correct decorative calculation used only if the real company image cannot load. |

### Adapters, charts, and general presentation

These calculations should stay in the browser and should not be stored:

- `Intl.NumberFormat`, decimal rounding, currency symbols, compact notation,
  ratio-to-percent display conversion, and multiplication signs.
- Relative page-calculation labels such as “Page calculated 8m ago”.
- Responsive chart width and series sorting needed by the chart libraries.
- Chart domains, marker positions, bar widths, axis labels, gradients, and
  selection of the last N display points.
- Valuation-method range marker coordinates.
- Score-bar normalization and clamping for CSS.
- Ownership ratio-to-percent display conversion when an API unit identifies a
  ratio.
- Loading polling intervals, page-button bounds, selected-filter counts, and
  other UI state.

`components/security/data.ts` and
`components/screener/screener-data.ts` still contain defensive response
normalization. Parsing and validation are appropriate in a client adapter, but
provider-specific field aliases and ambiguous unit heuristics should continue
moving toward the server contract. The browser should not have to infer whether
an unlabeled value is a ratio or a percentage.

The summary cash-flow waterfall and business-quality earnings bridge receive
server-owned, clearly named rows from `lib/security/bridges.ts`. Their
components now calculate only visual positions and widths. These simplified
bridges remain explanatory reconciliations, not substitutes for an income or
cash-flow statement.

## D1 persistence policy

### Implemented tables

`db/schema.ts` and the versioned SQL files under `drizzle/` implement:

| Table | Why it is durable |
| --- | --- |
| `anonymous_sessions` | Associates anonymous browser workspaces with D1. Only the SHA-256 digest of the opaque 256-bit cookie token is stored. |
| `security_journal` | Legacy table retained so existing rows are not destructively deleted. No active UI or API reads or writes it. |
| `saved_screeners` | Stores a user's screener name, filter definition, visible columns, and sort choice. |
| `top_market_cap_universe` | Stores the ranked Top 1,000 market-cap membership used by every screener request. |
| `screener_snapshot_generations` | Records each complete immutable daily generation, its universe/source timestamps and filter schema version, plus the compact client JSON and content hash served by the snapshot endpoint. |
| `screener_snapshot_rows` | Stores compact normalized metrics and the precomputed filter mask by generation and market code. |
| `screener_snapshot_state` | Points readers to the active generation only after all rows validate and commit. |
| `screener_snapshot_daily_runs` | Stores the claim, lease, attempt count, status, generation, and completion evidence for each New York trading date; generation publication and success are committed atomically. |

The front end performs a one-time migration of legacy `localStorage`
saved-screener data when the server workspace is empty. After a successful
import, it removes those legacy keys.

### Should be added when the corresponding feature exists

1. **Saved valuation runs.** If the UI gets a “Save model” action, store the
   security, user assumptions, normalized input values, input `asOf`, result,
   currency, and `modelVersion`. An explicitly saved run is historical evidence
   and must not change when the default model changes.
2. **Authenticated ownership.** If accounts are introduced, associate screeners
   and saved runs with a user identifier and provide an explicit
   anonymous-workspace claim/migration path.

### Should not be stored

- Currency strings, percentages formatted for display, chart geometry, CSS
  widths, freshness text, and pagination labels.
- Default fair value, margin, or quality outputs merely because they were
  displayed. Recompute them from current inputs and a versioned model.
- Short-lived API responses without a defined cache invalidation and
  provenance policy.
- Upstream authentication cookies or other secrets.

## Remaining limitations

1. **Screener quotes are snapshot-based.** Filter interaction is immediate and
   cross-isolate data is consistent, but screener prices and latest-session
   moves update with the successful daily generation rather than on every
   intraday tick. Public requests fail closed when no active generation exists;
   they never start an upstream rebuild.
2. **Saved valuation runs are not implemented.** Current provider-backed values
   are deliberately recomputed; add storage only with an explicit save/history
   feature and preserve normalized inputs, provenance, and model version.
3. **Anonymous workspaces are device-cookie scoped.** Clearing the cookie loses
   the lookup key, and there is no account recovery or cross-device sync.
4. **Upstream web authentication remains operationally brittle.** The server
   now renews rejected AInvest sessions automatically from Worker secrets, but
   the provider's private login contract or risk controls can change. Login
   secrets and session cookies must never be exposed to browser JavaScript or
   committed configuration.
5. **Provider rights remain a launch gate.** Verify the source provider's
   licensing, attribution, caching, and redistribution terms before exposing
   its data in production. Keeping a credential server-side is necessary for
   security but does not grant redistribution rights.
6. **Model-parity tests should expand.** Keep tests asserting that summary,
   dedicated valuation, business-quality, and screener views produce the same
   answer for the same inputs and model version.
7. **Unexpected exchange closures need an override.** Recurring NYSE full-day
   holidays are calculated and the published 2026–2028 calendars are covered by
   tests, but a future emergency closure must be added to the explicit closure
   set before that date.
