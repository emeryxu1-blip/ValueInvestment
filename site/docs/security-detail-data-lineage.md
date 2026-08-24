# Security detail data lineage

This audit covers the overview, cash-flow, market-comparison, and
business-quality views for every route in the generated US security catalog.
NVDA is a representative seed, not a special-case implementation.

## Audit result

No ticker-specific numeric fixture or fabricated financial dataset was found.
The removed mock-like behavior was global model policy that appeared as if it
were market evidence:

| View/component | Removed behavior | Current authoritative source |
| --- | --- | --- |
| Overview valuation range | Bear/base/bull values at 80%/100%/120% of one estimate | AInvest DCF, backend peer estimate, and the explicitly selected value |
| Overview selected value | Unnamed arithmetic average of DCF and peer estimates | AInvest DCF when available; otherwise the backend peer estimate |
| Cash-flow valuation | Local five-year DCF with fixed 8% growth, 9% discount, and 3% terminal growth | AInvest `stockdiag_fundamental_value_dcf` |
| Cash-flow evidence | Browser projections and sensitivity cells | AInvest `stockdiag_fundamental_future_growthforecast`, normalized and aggregated by the backend |
| Market comparison | Mean of implied values using provider per-share fields that could mismatch a share class | Backend median of positive implied values using current price divided by the matching company P/E, P/S, or P/B |
| Market-comparison label | Browser-recalculated gap and opportunity label | Canonical backend valuation response |
| Business-quality peers | Net margin inferred as P/S ÷ P/E and ROE inferred as P/B ÷ P/E | Direct AInvest TTM net-margin and ROE indicators |
| Issuer country | Hardcoded to United States from the listing route | Null with an explicit reason until a supported AInvest domicile indicator is available |
| Failed summary load | Empty normalized object labelled as live | Explicit unavailable state; no substitute response |

## Backend calculations

The backend performs only documented deterministic calculations over returned
provider facts:

- trailing-four FCF = sum of the latest four returned reported provider points;
- forward-four FCF = sum of the earliest four returned forecast points;
- forward FCF growth = forward four ÷ trailing four − 1, only when four points
  exist in each set and trailing four is positive;
- the app does not infer quarter continuity or future-date status from those
  points, and this separate FCF series is not used locally to reproduce the
  provider DCF;
- dated values from AInvest `predicted_prices` are labelled as provider DCF
  periods, including future-dated periods; they are not presented as an
  estimate-revision history;
- each relative implied value = peer median multiple × (current price ÷ matching
  current company multiple);
- final relative value = median of available positive implied values;
- comparable peers must be supported equities with at least two usable
  P/E, P/S, or P/B observations; when market capitalization is available,
  candidates must be between 1% and 100× the target's size, after which the
  closest eight by size are retained from up to 100 provider relation
  candidates in one bounded snapshot request; when a narrow industry returns fewer than three
  usable peers, the backend repeats the same rules over the provider's broader
  sector group;
- whenever the broader sector group is used, the API and UI disclose that
  fallback even when the final medians are complete;
- alternate share classes of the target issuer are excluded; valuation peers
  require multiple coverage, while business-quality peers are selected by
  direct net-margin or return-on-equity coverage so loss-making companies are
  not silently screened out;
- alternate share classes inside the peer set are collapsed to one issuer, and
  the minimum sample is enforced separately for every displayed peer metric;
- the operating-company applicability gate is also applied to every fetched
  peer, preventing fund-like vehicles and SPACs from entering company medians;
- each peer-multiple median requires at least three positive observations; the
  final relative estimate is the median of whichever one to three positive
  method values remain, and the UI displays that method count;
- implied value gap = selected value ÷ positive analysis price − 1;
- quality scores, ratios, and narratives remain backend-owned and model-versioned.

Every canonical view keeps its core equation or selection rule visible in a
native `<details>` summary and exposes source, guards, period basis, timestamps,
and policy version in the expanded method panel. Provider-defined values whose
inputs are absent are labelled as opaque rather than decorated with a generic
formula that cannot reproduce the number.

Missing inputs remain null. Raw DCF and growth-forecast provider modules are
parsed server-side and are not serialized to the browser.

## Applicability

Corporate valuation and business-quality analysis currently applies to common
and depositary equities (`ES` and `ED`) only when AInvest also returns an
operating-industry classification. Other instruments, provider-classified
SPACs, unclassified shells, explicit fund and royalty-trust legal names, and
asset-management rows whose AInvest workforce evidence is
fund-like return an explicit 422 response from company-analysis APIs. AInvest
industries classified as REITs remain eligible consistently even when an
externally managed issuer reports zero employees. The overview continues to
expose available identity and quote data for unsupported instruments but does
not render a mostly blank or misleading corporate model.

## Persistence decision

Current provider data and deterministic detail calculations are deliberately
not stored in D1. They are recomputed on request, consistent with
`calculation-ownership.md`. D1 should be added only for an explicit saved-model
or immutable historical-snapshot feature; such a record must include the market
code, normalized inputs, source dates, calculation time, method/model version,
currency, and output.
