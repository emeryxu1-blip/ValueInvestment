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
- **Hybrid** for interactive models: the server returns a canonical default,
  while the browser uses the same pure calculation module to preview unsaved
  assumption changes immediately.
- **Client only** for formatting, responsive layout, chart coordinates,
  pagination text, and other ephemeral presentation state.
- **D1** for durable user intent or history, not for values that can be
  deterministically recomputed from current inputs.

## Inventory and decisions

### Valuation and security summary

| Calculation | Current authoritative code | Owner | Persist? | Migration status |
| --- | --- | --- | --- | --- |
| DCF five-year cash-flow forecast | `lib/security/valuation.ts` (`calculateCashFlowValue`) | Hybrid | No for ordinary previews; yes only for an explicit saved model run | Shared pure module. The analysis API calculates the canonical default. The client reuses it for slider previews. |
| Discount factors and present values | `lib/security/valuation.ts` | Hybrid | Same as the DCF run | Migrated out of a component-local module. |
| Terminal value and its present value | `lib/security/valuation.ts` | Hybrid | Same as the DCF run | Migrated. The model rejects invalid assumptions such as discount rate less than or equal to terminal growth. |
| Enterprise value, equity bridge, inferred shares, and value per share | `lib/security/valuation.ts` | Hybrid | Same as the DCF run | Migrated. The default response is server-computed; slider changes remain ephemeral. |
| Default DCF assumptions | `lib/security/valuation.ts` (`DEFAULT_DCF_ASSUMPTIONS`) | Backend canonical/shared | Store with an explicitly saved run, including model version | Versioned in source by `VALUATION_MODEL_VERSION`. |
| DCF sensitivity grid | `components/security/ValueAnalysisClient.tsx`, calling the shared valuation module | Hybrid | No | Correctly remains an instant browser preview. It uses the same calculation function as the server rather than a second formula. |
| Peer P/E, P/S, and P/B medians | `lib/security/valuation.ts`; summary peers in `lib/security/peers.ts` | Backend canonical | No | Migrated. |
| Per-share sales denominator and peer-multiple implied values | `lib/security/valuation.ts` | Backend canonical | No | Migrated. |
| Relative valuation aggregate | `lib/security/valuation.ts` (`meanPositive`) | Backend canonical | No, unless part of a saved valuation run | Migrated and identified in the response as `mean-positive-implied-values`. |
| Relative premium/discount shown on each multiple card | `lib/security/valuation.ts` | Backend canonical | No | Migrated into each server-computed `RelativeMeasure`. |
| Fair value blend | `lib/security/derivations.ts` (`combineFairValues`) | Backend canonical | No | Migrated. It averages the available positive DCF and peer values. |
| Mispricing / margin of safety | `lib/security/derivations.ts` (`fairValue / price - 1`) | Backend canonical | No | Migrated for summary and screener responses. Client fallbacks were removed. |
| Bear/base/bull valuation scenarios | `lib/security/derivations.ts` and `lib/security/valuation.ts` | Backend canonical for default; hybrid for a slider preview | No, unless part of a saved run | Migrated for API responses. Interactive DCF scenarios are derived from the unsaved browser preview. |
| Opportunity label thresholds | `lib/security/valuation.ts` (`opportunityLabel`) | Backend canonical/shared | No | The function is shared, but the client currently calls it for an interactive gap. The server also returns the canonical label. |
| Net margin and free-cash-flow margin on the summary | `lib/security/service.ts` | Backend canonical | No | Migrated into `SecuritySummaryResponse.derived`. |
| Analyst count | `lib/security/service.ts` | Backend canonical | No | Already server-side: sum of returned buy, hold, and sell counts. |
| Summary narrative percentages and labels | `lib/security/service.ts` (`metricNarrative`) | Backend canonical | No | Already server-side. |
| Watch-price distance from current price | `components/security/SecuritySummaryClient.tsx` | Client only | Store the watch price, not the changing distance | This is a personalized display calculation over one saved input and the latest quote. |
| Suggested watch-price placeholder (`fairValue * 0.85`) | `components/security/SecuritySummaryClient.tsx` | Client only | No | A non-authoritative placeholder only. It must not be treated as a recommendation or silently saved. |

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
| Peer-implied net margin (`P/S ÷ P/E`) and ROE (`P/B ÷ P/E`) | `lib/security/business-quality.ts` | Backend canonical | No | Migrated. |
| Peer medians for the implied economics | `lib/security/business-quality-service.ts` | Backend canonical | No | Migrated. |
| Company-versus-peer net-margin gap and narrative | `lib/security/business-quality-service.ts` | Backend canonical | No | Migrated. |
| Score ring angle, score-component bar widths, and cash-conversion gauge width | `components/security/business-quality/BusinessQualityClient.tsx` | Client only | No | Correct presentation-only calculations. |
| Profitability chart ratio-to-percent conversion, row slicing, and axes | `components/security/business-quality/BusinessQualityCharts.tsx` | Client only | No | Correct presentation-only calculations. |
| Earnings-to-cash bridge differences | `lib/security/bridges.ts` | Backend canonical | No | Migrated. The quality API returns labeled bridge rows; the client calculates only bar geometry. |

### Screener

| Calculation | Current authoritative code | Owner | Persist? | Migration status |
| --- | --- | --- | --- | --- |
| Fair value / price mispricing | `lib/screener/service.ts`, using `deriveMispricing` | Backend canonical | Persist only as part of a durable screener snapshot | Migrated; the browser fallback was removed. |
| Filter evaluation across market cap, price, change, valuation, growth, quality, sector, exchange, symbol, and query | `lib/screener/service.ts` (`applyScreenerFilters`) | Backend canonical | Persist the saved filter definition, not each ordinary result | Already server-side. |
| Sort ordering and null handling | `lib/screener/service.ts` (`sortScreenerRows`) | Backend canonical | Persist the user's sort choice | Already server-side. |
| Result count, offset, and total pages | `lib/screener/service.ts` | Backend canonical | No | Already server-side when the full result universe is known. |
| Mapping UI filters to API fields and percent units | `components/screener/ScreenerClient.tsx` (`filterPayload`) | API adapter; preferably shared schema | No | Acceptable as request construction, but unit rules should ultimately live in a shared typed contract to avoid client/server drift. |
| “New on page” comparison against a saved baseline | `components/screener/ScreenerClient.tsx` | Client only over persisted membership | Persist the baseline symbols | Implemented, but limited to the saved result page. |
| Scan progress percentage | `components/screener/ScreenerClient.tsx` | Client only | Store raw scan counters if the scan becomes durable; never store the percentage | Correct presentation-only calculation. |
| Pagination range text | `components/screener/ScreenerClient.tsx` | Client only | No | Correct presentation-only calculation. |
| Percent/currency display, value tone, and “undervalued” display threshold | `components/screener/ScreenerClient.tsx` | Formatting is client only; semantic threshold belongs on server | No | **Partial:** formatting is correct in the client. If “undervalued / overvalued / near fair value” becomes product logic, return that classification from the API. |
| Logo hue from ticker text | `components/screener/ScreenerClient.tsx` | Client only | No | Correct decorative calculation. |

### Adapters, charts, and general presentation

These calculations should stay in the browser and should not be stored:

- `Intl.NumberFormat`, decimal rounding, currency symbols, compact notation,
  ratio-to-percent display conversion, and multiplication signs.
- Relative freshness labels such as “Updated 8m ago”.
- Responsive chart width and series sorting needed by the chart libraries.
- Chart domains, marker positions, bar widths, axis labels, gradients, and
  selection of the last N display points.
- Valuation-range and analyst-target marker coordinates.
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

`db/schema.ts` and `drizzle/0000_fearless_venus.sql` implement:

| Table | Why it is durable |
| --- | --- |
| `anonymous_sessions` | Associates anonymous browser workspaces with D1. Only the SHA-256 digest of the opaque 256-bit cookie token is stored. |
| `security_journal` | Stores user-authored note, stance, and watch price by session, exchange, and symbol. |
| `saved_screeners` | Stores a user's screener name, filter definition, visible columns, sort choice, and baseline timestamp. |
| `saved_screener_baseline_symbols` | Stores membership used by the “New on page” comparison. |

The front end performs a one-time migration of legacy `localStorage` journal
and screener data when the server workspace is empty. After a successful
import, it removes those legacy keys.

### Should be added when the corresponding feature exists

1. **Saved valuation runs.** If the UI gets a “Save model” action, store the
   security, user assumptions, normalized input values, input `asOf`, result,
   currency, and `modelVersion`. An explicitly saved run is historical evidence
   and must not change when the default model changes.
2. **Durable screener snapshot and refresh runs.** A production-wide screener
   needs normalized searchable rows plus refresh status in D1 (or another
   queryable Cloudflare store). Store source timestamps and a schema/model
   version. Replace rows transactionally or by generation so readers never see
   a half-refreshed universe.
3. **Authenticated ownership.** If accounts are introduced, associate journal,
   screeners, and saved runs with a user identifier and provide an explicit
   anonymous-workspace claim/migration path.

### Should not be stored

- Currency strings, percentages formatted for display, chart geometry, CSS
  widths, freshness text, and pagination labels.
- Every DCF slider movement or every sensitivity-grid cell.
- Default fair value, margin, or quality outputs merely because they were
  displayed. Recompute them from current inputs and a versioned model.
- Short-lived API responses without a defined cache invalidation and
  provenance policy.
- Upstream authentication cookies or other secrets.

## Remaining limitations

1. **The full-market screener is not durable.** `lib/screener/service.ts` keeps
   its valuation universe, progress, and in-flight promise in module globals.
   Worker isolates are disposable and do not share memory, so a request can
   lose progress or observe a different cache. The warm-up promise also is not
   explicitly attached to `ExecutionContext.waitUntil`. Move refresh work to a
   scheduled Worker/Queue and store versioned rows plus run state before
   treating global counts as production-grade.
2. **Saved baseline membership is page-scoped.** The browser currently sends
   `rows.map(symbol)` from the visible result page. The UI truthfully calls this
   “New on page”, but it is not a baseline for the complete matching universe.
3. **Interactive DCF runs are ephemeral.** Slider assumptions reset on reload,
   and there is no saved-model schema or action yet.
4. **Anonymous workspaces are device-cookie scoped.** Clearing the cookie loses
   the lookup key, and there is no account recovery or cross-device sync.
5. **Upstream data credentials are operationally brittle.** The market-data
   integration currently depends on a secret session cookie. It must remain a
   Worker secret, be rotated when it expires, and never be exposed to browser
   JavaScript or committed configuration.
6. **Provider rights remain a launch gate.** Verify the source provider's
   licensing, attribution, caching, and redistribution terms before exposing
   its data in production. Keeping a credential server-side is necessary for
   security but does not grant redistribution rights.
7. **Model-parity tests should expand.** Keep tests asserting that summary,
   dedicated valuation, business-quality, and screener views produce the same
   answer for the same inputs and model version.
