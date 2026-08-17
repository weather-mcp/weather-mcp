# Single-Model Ensemble Spread — Design Plan

**Status:** 📝 Design — awaiting review, then `/impl-plan` + `/run-plan`
**Parent:** `docs/planning/README.md` Active ideas → Architecture & tooling
("Single-model ensemble spread"); closes the *within*-model half of
`docs/planning/FUTURE_ENHANCEMENTS.md` §13.1 (the *across*-model half shipped
as `compare_models` in v1.21.0)
**Target release:** v1.22.0 (next minor after v1.21.0)
**Branch (for /impl-plan):** `feat/ensemble-spread` — create off `main` **after
the v1.21.0 branches merge**; this feature imports from
`src/utils/modelComparison.ts` and mirrors its handler/service seams, so it
depends on the multi-model-comparison code being on the base. Line references
below were taken on the v1.21.0 stack (`feat/global-normals-hardening`) and may
shift slightly post-merge.

## Upstream verification (live-tested 2026-08-16)

All against `https://ensemble-api.open-meteo.com/v1/ensemble`, keyless:

- **(a) Daily aggregation is supported.** The ensemble endpoint accepts the
  same `daily=` variables as the forecast endpoint and returns per-member
  daily aggregates — no in-house hourly→daily aggregation needed. This was
  the biggest unknown; it holds for all five variables we render.
- **(b) Single-model key shape:** one **unsuffixed** series per variable (the
  control run) plus `_<variable>_memberNN` series, zero-padded from
  `member01`. Series counts per model (control + perturbed members):
  `gfs_seamless` 1+30, `ecmwf_ifs025` 1+50, `icon_seamless` 1+39,
  `gem_global` 1+20, `bom_access_global_ensemble` and
  `ukmo_global_ensemble_20km` 1+17 each.
- **(c) `precipitation_probability_max` is a trap:** HTTP 200 with unit
  `"undefined"` and **all-null** control *and* member arrays (verified on
  `gfs_seamless`). Probability is *derived from* ensembles, not published by
  them. Do not request it — the wet-member fraction we compute IS the
  probability product.
- **(d) Ragged horizons, trailing nulls** (forecast-API behavior): at
  `forecast_days=16`, `ecmwf_ifs025` returns 14 non-null daily values,
  `icon_seamless` 7; `gfs_seamless` returns 33 of 35 at the endpoint max.
  Members go null together with their control (whole-model horizon, not
  per-member raggedness).
- **(e) Invalid model name** → HTTP 400
  `{"reason":"…Cannot initialize MultiDomains from invalid String value…"}` —
  same shape as the forecast endpoint.
- **(f) Ocean points return real data** for `gfs_seamless` and
  `ecmwf_ifs025` (verified at 0, −140): global models cover open ocean. No
  Flood-API-style all-null-over-ocean mode observed for the chosen model.
- **(g) Unit params compose:** `temperature_unit=fahrenheit&wind_speed_unit=
  mph&precipitation_unit=inch` and `timezone=auto` all honored alongside
  `models=`.
- **(h) Multi-model requests rename the suffixes.** With
  `models=gfs_seamless,gem_global`, keys come back suffixed with **resolved
  internal names** (`temperature_2m_max_member01_ncep_gefs_seamless`,
  `…_gem_global_ensemble`) — *not* the requested aliases. This feature is
  strictly one model per request, so keys stay plain `_memberNN`; the
  validator must still fail loudly if a renamed shape ever appears (D3).
- **(i) Payload is small:** 51 series × 5 variables × 3 days ≈ 21 KB;
  estimated ≈ 65–70 KB at 16 days — well within normal response handling,
  no caps needed beyond the defensive member ceiling in D4.
- **(j) `weather_code` per member carries real WMO codes** (buckets apply
  cleanly); `daily_units` echoes per-member unit entries.

## What / Why

`compare_models` (v1.21.0) answers "do the models agree?" This feature
answers the sibling question the planning index tracks separately: **"how
confident is the model itself?"** A global ensemble runs the same model
~20–50 times from perturbed initial conditions; the spread of the members is
the model's own uncertainty estimate, and it widens with lead time in a way
a 5-model comparison cannot show (5 samples vs 50). Open-Meteo's ensemble
endpoint returns every member's **daily aggregates in one keyless call**
(verification a/b), so this is the same one-request, summarize-don't-dump
product shape as the comparison — most of the statistical and rendering
machinery already exists and several pieces are imported directly.

Output philosophy (inherited, settled): **summarize the distribution, never
dump N member forecasts.** Precedents: `formatEnsembleForecast` in
`riverConditionsHandler.ts` (GloFAS median + p25–p75), and the entire
`formatModelComparisonForecast` structure.

## Scope

**In:** an `ensemble_spread: boolean` parameter on `get_forecast` (parameters
over proliferation — NOT a new tool) that switches the output to a
member-spread confidence view built from **one fixed model, `ecmwf_ifs025`**
(ECMWF ENS 0.25°, 50 perturbed members + control — the largest member count
and the strongest-regarded global ensemble; verification b/f). A pure
statistics module; confidence rendering with honest framing.

**Out (explicit non-goals, recorded so /impl-plan doesn't relitigate):**

- **Caller-selectable ensemble model** (`gfs_seamless` for a 33-day horizon,
  `icon_seamless`, `gem_global`, …). All verified working, but one render
  path per release (project discipline) and one fixed curated choice
  (intelligent defaults). Record as a 💡 planning-index row on ship.
- **Hourly member spread.** Daily only — same context-bomb reasoning as
  compare_models D1, worse by 10× member count.
- **Combining with `compare_models` in one output.** The two are distinct
  products and distinct requests; the flags are mutually exclusive (D1).
- **Probability calibration / skill claims.** We report raw member fractions
  and spreads, disclosed as such — never "70% chance" as a calibrated
  probability.
- **Beyond-16-day horizons.** `ecmwf_ifs025` daily data ends at ~14 days
  (verification d); `days` stays 1–16 with trailing trim, and the 35-day GFS
  horizon goes unused (would require the model-selection non-goal).

## Design decisions (settled)

### D1. Parameter semantics and interactions

`ensemble_spread?: boolean`, default `false`, validated with
`validateOptionalBoolean` (pattern: `compare_models`,
`forecastHandler.ts:259-263`). Added to `ForecastArgs` (`:88` region).

Interactions — each settled explicitly, mirroring the compare_models D1
table:

- **`compare_models`:** both `true` → **validation error**
  (`ensemble_spread and compare_models are mutually exclusive; request one
  view at a time`). New interaction, tested explicitly.
- **`granularity`:** daily only; `"hourly"` + flag → **validation error**
  (the spread view is the requested product — never silently a plain
  forecast; compare_models precedent at `forecastHandler.ts:276-281`).
- **`source`:** `"noaa"` + flag → **validation error** (`ensemble_spread
  uses Open-Meteo ensemble data; use source "auto" or "openmeteo"`).
  `"auto"`/`"openmeteo"` both go straight to the ensemble path.
- **`days`:** unchanged 1–16 via `validateForecastDays`, default 7. ECMWF
  daily data ends ~day 14: trailing days where fewer than 2 members report
  `temperature_2m_max` are trimmed with a note (D4). Default 7 is fully
  inside the horizon.
- **`include_precipitation_probability`:** **silently ignored** (documented
  in `docs/TOOLS.md`). Unlike compare_models — where probability was a
  separately fetched variable that could be dropped — the wet-member
  fraction is intrinsic to this product and is the precipitation story
  itself (verification c).
- **`include_normals` / `include_astronomy` / `include_severe_weather`:**
  silently ignored, same as compare_models (documented, not in the schema
  string).
- **`detail`:** `summary` → overall-confidence line + one compact line per
  day; `standard` (default) → per-day blocks (D5); `full` → additionally a
  per-day full-envelope line (absolute min–max per variable). Never member
  dumps at any level.
- **Units:** `resolveUnitPreferences` as today; unit params compose with
  `models=` (verification g). Band thresholds scale for °C exactly as
  `classifyTempSpread` already does.

Schema description (tight — `get_forecast` is in every preset including
default `basic`):

> "Show one model's ensemble spread (ECMWF ENS, 50 members) instead of a
> single forecast — how confident the model itself is, day by day. Use when
> asked how certain/uncertain the forecast is. Daily only; always Open-Meteo
> (default: false)."

### D2. Routing — before NOAA, no fallback

In `handleGetForecast`, the flag short-circuits the `useNOAA` routing
exactly as `compare_models` does (`forecastHandler.ts:296-301`): NOAA is
never contacted, no fallback logic applies, `formatLocationLine` prepends
unchanged. The mutual-exclusion check (D1) runs with the other guards before
any service call.

For US points (`isInUS`), the footer carries the same one-line disclosure
pattern as compare_models D2: the NOAA/NWS point forecast is not the model
being spread; this is ECMWF's ensemble.

### D3. Service layer — new method, new host, everything else byte-untouched

New public method on `OpenMeteoService`:

```ts
async getEnsembleSpread(
  latitude: number,
  longitude: number,
  days: number = 7,
  prefs: UnitPreferences = IMPERIAL_PREFERENCES
): Promise<OpenMeteoEnsembleResponse>
```

- **Model constant** lives in the pure module (the corrected
  compare_models arrangement — service imports from util, never the
  reverse): `export const ENSEMBLE_MODEL = 'ecmwf_ifs025' as const;` in
  `src/utils/ensembleSpread.ts`, plus display metadata
  (`ENSEMBLE_MODEL_LABEL = 'ECMWF IFS 0.25° ensemble (ENS)'`,
  `ENSEMBLE_MEMBER_COUNT = 50` for the header line; the parser still counts
  members from the response rather than trusting the constant).
- **New host:** the ensemble API is its own subdomain. Add
  `ensembleURL = 'https://ensemble-api.open-meteo.com/v1'` to the
  constructor defaults (`openmeteo.ts:95-100`) and a private
  `makeRequestToEnsemble<T>` following `makeRequestToFlood`
  (`:1592`) — retry/backoff/sanitization come free from the shared shape.
- **Request params** (new private `buildEnsembleParams`): exactly five
  daily variables — `weather_code`, `temperature_2m_max`,
  `temperature_2m_min`, `precipitation_sum`, `wind_speed_10m_max` —
  **never** `precipitation_probability_max` (all-null trap, verification c);
  `models=<ENSEMBLE_MODEL>`, `forecast_days=<days>`, `timezone=auto`,
  `...openMeteoUnitParams(prefs)`.
- **New validator `validateEnsembleResponse`:** requires non-empty
  `daily.time` AND a `temperature_2m_max_member01` key; otherwise
  `DataNotFoundError`. Doc comment records the two shapes it must fail
  loudly on rather than mis-parse: a memberless plain-forecast shape, and
  the multi-model renamed-suffix shape (verification h).
- **`getForecast` and `getModelComparison` byte-untouched** — params, cache
  keys, TTLs identical for every existing caller.

### D4. Statistics — new pure module `src/utils/ensembleSpread.ts`

Pure, zero I/O, no service imports. It MAY import from
`src/utils/modelComparison.ts` (pure→pure): reuses `classifyTempSpread`
(`modelComparison.ts:154`) and `weatherCodeBucket` (`:181`) rather than
duplicating the band and bucket heuristics. The wet threshold (≥ 0.01 in /
≥ 0.25 mm) is reused as well — exported from `modelComparison.ts` if it is
currently module-private.

**Extraction.** `extractMemberSeries(daily, variable)` collects
`` `${variable}_member${NN}` `` keys behind `Array.isArray` guards with
non-numeric entries coerced to `null` (same strict-safe discipline as
`extractModelSeries`). Defensive ceiling: parse at most 64 members per
variable; beyond that, warn with `securityEvent: true` and truncate
(bounds-checking doctrine — 51 is the expected count, verification b).

**Control run:** the unsuffixed series is extracted separately and treated
exactly like `best_match` in compare_models D6 — **headline reference line,
excluded from every statistic, fraction, and trimming decision.** Rationale:
it is the unperturbed higher-weight run, not an equal-probability member;
with 50 perturbed members its exclusion barely moves the stats and the
symmetry with D6 keeps one mental model across both features. Stated in the
footer.

**Per-day, per-variable statistics** across perturbed members: median, p25,
p75, min, max. Percentile method pinned for determinism: sort ascending,
linear interpolation between closest ranks (the numpy-default convention);
locked by unit tests, noted in the doc comment.

**Confidence heuristics (project heuristics, disclosed in doc comments —
Fosberg/compare-models precedent):**

- **Temperature spread band:** `classifyTempSpread` applied to the
  **p25–p75 range** of the daily high (tight ≤ 4 °F / moderate ≤ 8 °F /
  divergent — thresholds and °C scaling unchanged). The interquartile range
  is the band we render (GloFAS precedent), so it is also the band we
  classify.
- **Precipitation:** wet-member fraction = members with
  `precipitation_sum` ≥ threshold ÷ members reporting. Rendered as
  "N of M members (NN%)". Amount range covers **only the wet members**
  (the compare_models implementation gotcha, inherited deliberately —
  dry members pin the minimum to 0.00 and misread as "anywhere from
  nothing").
- **Conditions:** modal `weatherCodeBucket` across members with its
  percentage; runner-up bucket named when it holds ≥ 25% of members.
- **Day confidence label:** **High** = temp band tight AND wet fraction
  ≤ 0.2 or ≥ 0.8; **Low** = temp band divergent OR wet fraction in
  [0.35, 0.65]; **Moderate** otherwise. Same shape as the compare_models
  Good/Moderate/Low rule, renamed to "Confidence" because this is one
  model's certainty, not cross-model agreement.

**Trimming:** trailing days where fewer than 2 members report
`temperature_2m_max` are trimmed and counted (`trimmedDays`); interior gap
days render with their reduced member count. All days trimmed → the handler
throws `DataNotFoundError` (D7), never an empty view.

**Result shape** (typed, exported):
`EnsembleSpreadResult { days: EnsembleDay[]; memberCount: number;
trimmedDays: number; … }` — the handler renders from this, never raw JSON.

### D5. Rendering — confidence summary, never fifty forecasts

New `formatEnsembleSpreadForecast` in `forecastHandler.ts`, structure
mirroring `formatModelComparisonForecast`. Sketch (detail = standard):

```
# Weather Forecast (Ensemble Spread)

**Location:** 39.7392, -104.9903
**Timezone:** America/Denver
**Forecast Days:** 7
**Model:** ECMWF IFS 0.25° ensemble (ENS) — 50 perturbed members + control run

**Forecast confidence:** High through Thursday; decreasing Friday–Saturday
(temperature spread widens to 9°F; members split 24–26 on rain Saturday).

## Tuesday, August 18
**Control run:** High 84°F / Low 62°F — Partly cloudy
**Confidence:** High
**Temperature (50 members):** high 82–85°F likely (p25–p75), median 84°F; low 60–63°F likely
**Precipitation:** 4 of 50 members (8%) produce measurable precipitation; 0.02–0.09 in among those
**Wind:** max typically 8–13 mph
**Conditions:** 74% of members partly cloudy; 26% rain showers

## Saturday, August 22
**Control run:** High 78°F / Low 58°F — Rain showers
**Confidence:** Low
**Temperature (50 members):** high 71–80°F likely (spread 9°F — divergent), median 76°F
**Precipitation:** 26 of 50 members (52%) produce measurable precipitation; 0.03–0.40 in among those
**Wind:** max typically 10–19 mph

*Note: 2 further days beyond the model's horizon were omitted*

*Data source: Open-Meteo (Ensemble API). Single-model spread: ECMWF ENS,
50 perturbed members; the control run is shown as reference and not counted
in spreads. Member fractions are raw model output, not calibrated
probabilities — a confident ensemble can still be wrong. Confidence bands
are project heuristics. The NOAA/NWS point forecast is not the model shown.*
```

- The NWS sentence renders only for US points (D2). The trim note only when
  `trimmedDays > 0`.
- `detail: "summary"` → one line per day
  (`- **Tue:** Partly cloudy (74% of members), high 82–85°F — High confidence`);
  `detail: "full"` → appends one envelope line per day
  (`**Full range:** high 79–88°F, low 55–66°F, wind up to 22 mph,
  precipitation up to 0.55 in`).
- Control-run description uses the existing `getWeatherDescription` at
  render time, as compare_models does.

### D6. Control run — reference only (mirror of compare_models D6)

Settled in D4/D5: headline line, excluded from all statistics, disclosed in
the footer. If the control is null for a day (unobserved but possible), its
line is omitted and the spread still renders — identical to the null
best_match rule.

### D7. Errors — contract, not garnish

Identical posture to compare_models D7: transport/HTTP failures propagate
sanitized through `makeRequestToEnsemble`'s shared mapping — no degraded
fallback to a plain forecast, ever. HTTP 200 but unusable →
`DataNotFoundError` from the validator (D3). Fewer than 2 perturbed members
after extraction, or all days trimmed → `DataNotFoundError('OpenMeteo',
'Ensemble spread data is unavailable for this location')`. The invalid-model
400 (verification e) is unreachable with the constant; the
exact-param-string service test is the typo lock.

### D8. Cache

Key: `Cache.generateKey('openmeteo-ensemble', latitude, longitude, days,
unitSignature(prefs))` — distinct namespace (compare_models D8 pattern,
`openmeteo.ts:1048`). The model is a fixed constant and not a key component
(in-process cache; a set change ships with a restart — comment beside the
key). TTL: `CacheConfig.ttl.forecast` (2 h, `src/config/cache.ts:87`).

### D9. get_weather_summary — strip the flag

`ensemble_spread: undefined` added to the summary's `subArgs` literal beside
the existing `compare_models: undefined` strip. Locked by a test asserting
`getEnsembleSpread` is never invoked from a summary call.

### D-types

New closed interfaces in `src/types/openmeteo.ts`, not widening any existing
ones — same shape as the comparison pair:

```ts
export interface OpenMeteoEnsembleDaily {
  time: string[];
  [key: string]: string[] | (number | null)[] | undefined;
}
export interface OpenMeteoEnsembleResponse { /* latitude, longitude, elevation,
  timezone fields, daily: OpenMeteoEnsembleDaily, daily_units?: Record<string,string> */ }
```

Dynamic member-key access goes exclusively through the guarded
`extractMemberSeries` — no casts, no `any`.

### D10. Schema, descriptions, docs, planning index

- `src/index.ts`: `ensemble_spread` property beside `compare_models` with
  the D1 description; the tool description's existing confidence sentence
  extends by a clause ("…or ensemble_spread=true for one model's own
  spread"). Dispatch unchanged.
- README.md features table; CLAUDE.md tool list note; `docs/TOOLS.md`
  `get_forecast` section (including every ignored/error interaction from
  D1); CHANGELOG.md under `[Unreleased]`.
- `docs/planning/README.md`: flip "Single-model ensemble spread" 💡 → 📝 on
  this doc landing (done with this commit), → ✅ at completion; on ship, add
  the descoped 💡 row for caller-selectable ensemble model, and annotate FE
  §13.1 as fully covered.
- Move this doc to `docs/plans/` at completion (project convention).

## Edge cases

| Case | Behavior |
|------|----------|
| Flag absent/false | Byte-identical output on every path (locked by existing tests unedited) |
| `ensemble_spread: true` + `compare_models: true` | Validation error — mutually exclusive views |
| Flag + `granularity: "hourly"` | Validation error (product, not garnish) |
| Flag + `source: "noaa"` | Validation error — ensemble is Open-Meteo-only |
| US point + flag | Straight to ensemble path; NOAA never called; NWS-not-shown footer sentence |
| `days: 16` (past ECMWF ~14-day daily horizon) | Trailing all-null days trimmed with note; counts from real data, not assumptions |
| All days trimmed / < 2 members | `DataNotFoundError` — never an empty or two-member "spread" |
| Response is plain-forecast-shaped (no `_memberNN` keys) | `DataNotFoundError` from validator |
| Multi-model renamed-suffix shape (verification h) | `DataNotFoundError` from validator — unreachable via our constant, guarded anyway |
| Control run null for a day | Control line omitted; stats unaffected (never counted) |
| > 64 member series in a variable | Truncated with `securityEvent` warn (defensive ceiling) |
| Ocean point | Real data (verification f) — renders normally |
| Metric / mixed unit prefs | Caller's units throughout; band thresholds scale in `classifyTempSpread` as today; wet threshold 0.25 mm |
| `include_precipitation_probability` / `include_normals` / `include_astronomy` + flag | Silently ignored (documented in TOOLS.md) |
| `get_weather_summary` with flag | Stripped in `subArgs`; summary forecast unchanged |
| Saved/geocoded location name | `formatLocationLine` prepends as on every path |

## Testing

- **Pure module (`tests/unit/ensembleSpread.test.ts`, new):** percentile
  method pinned (odd/even counts, interpolation); median/p25/p75/min/max;
  band classification on the p25–p75 range incl. °C scaling; wet fraction
  incl. threshold edges and wet-only amount ranges; bucket modal +
  runner-up ≥ 25% rule; High/Moderate/Low label rule at the fraction
  boundaries (0.2/0.35/0.65/0.8); control exclusion from every stat;
  trailing trim vs interior gap; 64-member ceiling; < 2 members meta.
- **Service (`tests/unit/openmeteo-ensemble.test.ts`, new; spy pattern from
  `openmeteo-model-comparison.test.ts`):** exact `models=ecmwf_ifs025`
  param; exact five-variable `daily` list and **absence of
  `precipitation_probability_max`**; ensemble host used; unit params;
  cache namespace `openmeteo-ensemble` + unit signature; TTL =
  `CacheConfig.ttl.forecast`; validator throws on memberless and
  renamed-suffix fixtures; no retry-without-anything on 400.
- **Handler (`tests/unit/forecast-ensemble-spread.test.ts`, new; fake
  services):** happy path off a 50-member fixture (a generator helper, not
  a hand-typed 250-array fixture); both mutual-exclusion/validation errors;
  US point asserts no NOAA call + NWS sentence; horizon-trim fixture;
  null-control day; `detail` summary/standard/full shapes; DataNotFoundError
  cases.
- **Flag-off byte-identical locks (pass unedited):**
  `forecast-fallback.test.ts`, `forecast-model-comparison.test.ts`,
  `astronomy.test.ts`, `normals.test.ts`, `weather-summary-handler.test.ts`.
- **Weather-summary strip:** append to `weather-summary-handler.test.ts` —
  flag set, `getEnsembleSpread` never invoked.
- **Integration:** one live smoke test that **re-throws assertion failures**
  (the corrected convention from the comparison's implementation notes):
  real endpoint, stable location, asserts `_member01`…`_member50` presence
  and ≥ 45 members non-null for day-1 temperature.
- **Byte-identical verification (release gate):** diff built-dist output
  against branch base for a no-flag US and a no-flag non-US request; live
  flag-on runs at a US point, a non-US point, `days: 16` (trim note), and
  metric units.

## Documentation / registration checklist (for /run-plan tracking)

- [ ] `src/utils/ensembleSpread.ts` — D4 pure module (+ export wet threshold from `modelComparison.ts` if private)
- [ ] `src/services/openmeteo.ts` — `ensembleURL`, `makeRequestToEnsemble`, `getEnsembleSpread`, `buildEnsembleParams`, `validateEnsembleResponse`, D8 cache
- [ ] `src/types/openmeteo.ts` — D-types
- [ ] `src/handlers/forecastHandler.ts` — D1 arg + guards, D2 routing, D5 `formatEnsembleSpreadForecast`
- [ ] `src/handlers/weatherSummaryHandler.ts` — D9 strip
- [ ] `src/index.ts` — D10 schema property + tool-description clause
- [ ] Tests per §Testing
- [ ] README.md, CHANGELOG.md, CLAUDE.md, `docs/TOOLS.md`
- [ ] `docs/planning/README.md` — status flips + descoped 💡 row + FE §13.1 annotation
- [ ] Move this doc to `docs/plans/` at completion
