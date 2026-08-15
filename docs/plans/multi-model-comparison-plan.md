# Multi-Model Forecast Comparison — Design Plan

**Status:** ✅ **IMPLEMENTED** (2026-08-15) — shipped on `feat/multi-model-comparison`
for v1.21.0. See "Implementation notes" at the foot of this document.
**Parent:** `docs/planning/FORK_DERIVED_IDEAS.md` §4 (Multi-model forecast comparison); `docs/planning/README.md` Active ideas → Architecture & tooling
**Target release:** v1.21.0 (next minor)
**Branch (for /impl-plan):** `feat/multi-model-comparison` — create off `main`
**Upstream verification:** live-tested 2026-08-14 against the Open-Meteo forecast
endpoint's `models=` parameter. Verified: (a) with >1 model listed, every daily
variable returns suffixed per model (`temperature_2m_max_gfs_seamless`); with
exactly one model listed keys are **unsuffixed** — our fixed six-model list
always takes the suffixed shape, but the validator must not assume it (D3);
(b) `best_match` may be a list member, suffixing as `_best_match`; (c) invalid
model name → HTTP 400 `{"reason":"…invalid String value…","error":true}`;
(d) days beyond a model's horizon → trailing nulls in that model's arrays
(ECMWF ~14 days, GFS 15, of 16 requested) — horizons are ragged per model;
(e) some models return HTTP 200 with ALL-NULL arrays at some/all locations
(observed: `bom_access_global`, `ecmwf_aifs025` daily) — the Flood-API/pollen
precedent: never trust the 200; (f) per-variable nulls inside an otherwise
good model: `ukmo_seamless` returns all-null `precipitation_probability_max`
(publishes no probability product) with good temps/weather_code — null
handling must be per-variable-per-model; (g) unit params
(`temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch`)
compose cleanly with `models=`; (h) 5 models × 6 daily variables × 7 days is
~3–4 KB JSON — one small request. All six curated models verified live at
multiple locations 2026-08-14.

## What / Why

"How confident is this forecast?" is a natural assistant question the server
cannot answer today — `get_forecast` returns one deterministic forecast with
no uncertainty signal. Weather models disagree exactly when uncertainty
matters most to a user (storm tracks, rain/no-rain days, temperature swings).
Open-Meteo's `models=` parameter returns several global models' daily series
in a **single JSON call**, making a model-agreement view a small-effort,
genuine differentiator. The fork that inspired this (`dapcook/weather-mcp`)
did it via NOMADS GRIB downloads — heavy parsing, US-centric; that approach
is **rejected** and off the table (FORK_DERIVED_IDEAS §4, planning-index
Rejected table).

Output philosophy, settled by the parent doc: **summarize agreement and
divergence — never dump N full forecasts.** The rendering precedent is
`formatEnsembleForecast` in `src/handlers/riverConditionsHandler.ts:539-620`
(GloFAS median + p25–p75 band): show the spread, not the members.

## Scope

**In:** a `compare_models: boolean` parameter on `get_forecast` (parameters
over proliferation — project design principle; NOT a new tool) that switches
the output to a model-agreement comparison built from a fixed curated set of
six global models fetched in one Open-Meteo request; a pure comparison module;
agreement/divergence rendering with honest framing.

**Out (explicit non-goals, recorded so /impl-plan doesn't relitigate):**

- **Caller-selectable models.** The set is fixed and curated:
  `best_match` (reference) + `gfs_seamless` (NOAA/NCEP, US),
  `ecmwf_ifs025` (ECMWF), `icon_seamless` (DWD Germany), `gem_seamless`
  (ECCC Canada), `ukmo_seamless` (UK Met Office). All global — regional
  models (e.g. `icon_eu`) error "No data is available for this location"
  outside their domain (live-verified) and would break the
  anywhere-on-Earth contract. A `models:` override is a future 💡 idea,
  not this release.
- **Hourly comparison.** Daily only (D1). Hourly × 6 models × 16 days is a
  context bomb and the agreement story reads best at daily resolution.
- **NOMADS/GRIB anything.** Rejected upstream approach.
- **NOAA/NBM/HRRR in the compared set.** The NWS point forecast is not an
  Open-Meteo model choice in our curated global set; `gfs_seamless`
  represents the US global model. Disclosed in-output for US points (D2).
- **A new tool.** Settled: parameter on `get_forecast`.
- **Ensemble spread within one model** (e.g. GFS ensemble members via the
  Open-Meteo ensemble API) — a different product; record as 💡.

## Design decisions (settled)

### D1. Parameter semantics and interactions

`compare_models?: boolean`, default `false`, validated with the existing
`validateOptionalBoolean` (pattern: `include_astronomy`,
`forecastHandler.ts:241-245`). Added to `ForecastArgs`
(`src/handlers/forecastHandler.ts:68-81`).

Interactions with existing parameters — each settled explicitly:

- **`granularity`:** daily only. `compare_models: true` +
  `granularity: "hourly"` → **validation error** (`compare_models requires
  daily granularity`). Unlike `include_astronomy` (garnish, silently
  ignored on hourly), the comparison IS the requested product — silently
  returning a plain hourly forecast would be dishonest.
- **`days`:** unchanged 1–16 via `validateForecastDays`, default 7. Ragged
  horizons are handled by per-day participation counts and trailing-day
  trimming (D4), not a cap. Days where fewer than 2 comparison models have
  data are trimmed with a note (spread over one model is meaningless).
- **`source`:** comparison is inherently Open-Meteo. `source: "noaa"` +
  `compare_models: true` → **validation error** (`compare_models uses
  Open-Meteo model data; use source "auto" or "openmeteo"`). `"auto"` and
  `"openmeteo"` both go straight to the comparison path (D2).
- **`include_precipitation_probability`** (default true): composes — when
  false, the probability-consensus fragment is omitted from the
  precipitation line.
- **`include_normals` / `include_astronomy`:** **silently ignored** when
  comparing (documented in `docs/TOOLS.md`, not in the tight schema
  description). The comparison view is a focused agreement product;
  normals/astronomy remain available in the standard view. Precedent: both
  flags are already silently ignored on hourly granularity.
- **`include_severe_weather`:** already NOAA-only; ignored on this path as
  it is on today's Open-Meteo path.
- **`detail`:** `summary` → overall-agreement line + one compact line per
  day; `standard` (default) → the per-day blocks of D5 for all requested
  days; `full` → additionally one compact per-model values line per
  variable group per day (e.g. `Highs: GFS 84, ECMWF 82, ICON 86, GEM 83,
  UKMO 85 °F`) — still ranges-first, never six full forecasts.
- **Units:** `resolveUnitPreferences` as today; unit params compose with
  `models=` (verified). All displayed values arrive in the caller's units.

Schema description (tight — `get_forecast` is in every preset including
default `basic`, so every user pays for this string):

> "Compare 5 global weather models (GFS, ECMWF, ICON, GEM, UKMO) and
> summarize their agreement/divergence instead of a single forecast. Use
> when asked how confident or certain a forecast is, or whether models
> agree. Daily granularity only; always Open-Meteo (default: false)."

### D2. Routing — comparison branches before NOAA

In `handleGetForecast` (`forecastHandler.ts:210-347`), after validation and
`resolveUnitPreferences`, `compare_models: true` short-circuits the
`useNOAA` routing (`:253-261`) entirely and calls a new
`formatModelComparisonForecast(...)`. The NOAA branch, its
DataNotFoundError/InvalidLocationError auto-fallback, and
`formatNOAAForecast` are never entered — no fallback logic applies because
there is nothing to fall back from. The `formatLocationLine` prepend
(`:341-344`) applies unchanged.

For points where `isInUS(latitude, longitude)` is true, the output carries a
one-line disclosure (D5 footer): the NOAA/NWS point forecast is not among
the compared models; `gfs_seamless` represents the US global model. This is
the FIRMS/rivers "the model path works in the US too" precedent, with the
honesty note attached.

### D3. Service layer — new method, `getForecast` byte-untouched

New public method on `OpenMeteoService` (`src/services/openmeteo.ts`):

```ts
async getModelComparison(
  latitude: number,
  longitude: number,
  days: number = 7,
  prefs: UnitPreferences = IMPERIAL_PREFERENCES
): Promise<OpenMeteoModelComparisonResponse>
```

- **Model list:** exported module constant, single source of truth for
  service, pure module, and tests:
  ```ts
  export const COMPARISON_MODELS = [
    'best_match', 'gfs_seamless', 'ecmwf_ifs025',
    'icon_seamless', 'gem_seamless', 'ukmo_seamless'
  ] as const;
  ```
- **New private `buildModelComparisonParams`** (do NOT extend
  `buildForecastParams:855-919` — its 19-variable list × 6 models would
  sextuple response size for variables the comparison never renders).
  Requests exactly the six verified daily variables: `weather_code`,
  `temperature_2m_max`, `temperature_2m_min`, `precipitation_sum`,
  `precipitation_probability_max`, `wind_speed_10m_max`; plus
  `models=<COMPARISON_MODELS joined>`, `forecast_days=<days>`,
  `timezone=auto`, `...openMeteoUnitParams(prefs)`.
- **Transport:** reuse `makeRequestToForecast` (`:925-950`) — retry/backoff
  on rate-limit/5xx/timeout comes free. **No garnish retry**: unlike the
  fire-weather flag's retry-without-extras (`fetchCurrentConditions:749-778`),
  the comparison IS the requested product, so a failed request errors
  normally (sanitized) — garnish-vs-contract settled as contract (D7).
- **New validator `validateModelComparisonResponse`** — cannot reuse
  `validateForecastResponse` (`:956-973`): with multi-model suffixes,
  `daily.time` is present but the unsuffixed keys it checks are absent.
  The new validator requires non-empty `daily.time` AND at least one
  `temperature_2m_max_<model>` key present for a model in
  `COMPARISON_MODELS`; otherwise `DataNotFoundError`. Defensive note in its
  doc comment: a single-model request returns UNSUFFIXED keys
  (live-verified) — our list is always six, but the validator must fail
  loudly, not mis-parse, if that shape ever appears.
- **Existing `getForecast` (`:627-670`) untouched** — request URLs, cache
  keys, and TTL byte-identical for every existing caller.

### D4. Comparison computation — new pure module `src/utils/modelComparison.ts`

Pure, zero I/O, no service imports (the `fireWeather.ts`/`firmsHotspots.ts`
pattern). Three-layer separation: service fetches (D3), this module
computes, the handler renders (D5).

**Extraction.** `extractModelSeries(daily, variable, model)` builds the key
`` `${variable}_${model}` `` and returns `(number | null)[] | undefined`
behind an `Array.isArray` guard with non-numeric entries coerced to `null`
(TypeScript-strict-safe against the index-signature type, D-types below).

**Model participation — three levels, matching the live-verified null modes:**

1. **All-null model** (verification fact e): a model whose every requested
   variable is entirely null is **dropped** before any stats, and recorded
   in the result meta for an in-output disclosure line ("X returned no data
   for this location and was excluded"). Never trust the 200.
2. **Per-variable null model** (fact f, UKMO probability): a model
   participates per-variable wherever it has data; each variable line shows
   its own participating count (e.g. "probability 0–10% (4 models)").
3. **Per-day trailing nulls** (fact d, ragged horizons): per-day
   participation counts ("(4 of 5 models)"); trailing days with fewer than
   2 participating comparison models (best_match excluded — D6) are trimmed
   with a note, anchored on `temperature_2m_max` as the participation
   variable. Interior gaps: the day renders with its reduced count.

**Per-day, per-variable statistics** across participating comparison models
(best_match excluded, D6): min, max, range, median.

**Agreement bands (project heuristics, disclosed in doc comments like the
Fosberg bands in `fireWeather.ts`):**

- **Temperature spread** (on daily-high range, in the caller's units;
  thresholds defined in °F, scaled for °C ranges):
  `≤ 4 °F` (≤ 2.2 °C) **tight** · `≤ 8 °F` (≤ 4.4 °C) **moderate** ·
  `> 8 °F` **divergent**. Pure `classifyTempSpread(range, tempUnit)`.
- **Precipitation consensus:** a model "predicts measurable precipitation"
  when its `precipitation_sum ≥ 0.01 in` (or `≥ 0.25 mm` under metric
  prefs). Consensus line = "N of M models predict measurable
  precipitation"; probability range appended across probability-publishing
  models with its own count.
- **Conditions consensus:** pure `weatherCodeBucket(code)` mapping WMO codes
  to coarse buckets — clear (0–1), cloudy (2–3), fog (45, 48), rain
  (51–67, 80–82), snow (71–77, 85–86), thunderstorm (95–99). Consensus =
  modal bucket + count; ≤ 2 dissenters are named with their model's
  description via the existing `getWeatherDescription` at render time.
- **Day-level agreement label:** **Good** = temp tight AND precip unanimous
  (or no wet models); **Low** = temp divergent OR precip split with ≥ 2
  models on each side; **Moderate** otherwise.
- **Outlier naming:** only when the temp band is divergent — the model
  whose high is farthest from the median of the others is the candidate;
  it is **named** ("driven by ICON") only if removing it drops the band at
  least one level; otherwise render "models broadly split" without naming.

**Result shape** (typed, exported): `ModelComparisonResult { days:
DayComparison[]; droppedModels: string[]; trimmedDays: number; … }` — the
handler renders from this, never from raw JSON.

### D5. Rendering — agreement summary, never six forecasts

New `formatModelComparisonForecast` in `forecastHandler.ts` (structure
mirrors `formatOpenMeteoForecast`'s header `:613-617`, per-day `##` headings
`:667-744`, and footer `:746-747`; spread-first style per
`formatEnsembleForecast`). Sketch (detail = standard):

```
# Weather Forecast (Model Comparison)

**Location:** 39.7392, -104.9903
**Timezone:** America/Denver
**Forecast Days:** 7
**Models compared:** GFS (NOAA), ECMWF IFS, ICON (DWD), GEM (Canada), UKMO (UK Met Office)
**Reference:** Open-Meteo best_match blend

**Model agreement:** Good through Thursday; diverging Friday–Saturday
(temperature spread up to 9°F; models split 3–2 on rain Saturday).

## Tuesday, August 18
**Best match:** High 84°F / Low 62°F — Partly cloudy
**Agreement:** Good
**Temperature (5 models):** high 82–86°F (spread 4°F — tight), low 60–64°F
**Precipitation:** 0 of 5 models predict measurable precipitation; probability 0–10% (4 models)
**Wind:** max 8–14 mph
**Conditions:** 4 of 5 models partly cloudy; GEM: rain showers

## Saturday, August 22 (4 of 5 models)
**Best match:** High 78°F / Low 58°F — Rain showers
**Agreement:** Low — driven by ICON
**Temperature (4 models):** high 71–80°F (spread 9°F — divergent)
**Precipitation:** 3 of 4 models predict measurable precipitation (0.05–0.31 in); probability 40–75% (3 models)
**Wind:** max 10–22 mph

*Note: 2 further days beyond most models' horizon were omitted*

*Data source: Open-Meteo (Global). Compared models: GFS, ECMWF IFS, ICON,
GEM, UKMO; reference line is Open-Meteo's best_match blend (not counted in
spreads). Forecast spread across models is a proxy for uncertainty, not a
guarantee — a tight spread can still be wrong. Model run times differ and
are not shown. The NOAA/NWS point forecast is not among the compared models.*
```

- The NWS sentence appears only for US points (D2). The UKMO
  no-probability disclosure appears only when the probability count is
  short. Dropped-model disclosure (D4 level 1) renders under the header.
- `detail: "summary"` collapses each day to one line
  (`- **Tue:** Partly cloudy, high 82–86°F — Good agreement`);
  `detail: "full"` appends the per-model values lines (D1).
- Attribution stays Open-Meteo; honest-framing sentences follow the FIRMS
  hotspots-not-incidents / GloFAS model-not-gauge / Fosberg
  derived-not-official precedents.

### D6. best_match — reference only, excluded from spread math

`best_match` renders as the headline **Best match** line (the narrative
anchor: "here is the forecast; here is how much the models behind it
disagree") but is **excluded from all statistics, bands, participation
counts, and trimming decisions**. Rationale: it is Open-Meteo's blend of
(largely) these same models, not an independent member — including it
double-counts and artificially tightens every spread. The exclusion is
stated in the footer ("not counted in spreads"). If best_match itself is
null for a day (unobserved but possible), the Best-match line is omitted
for that day and the comparison still renders.

### D7. Error handling — comparison is contract, not garnish

- **Transport/HTTP failures:** propagate sanitized via the existing
  `makeRequestToForecast` error mapping — no degraded fallback, no
  retry-without-models (contrast: fire-weather garnish retry). A user who
  asked for a comparison gets a comparison or an error, never a silent
  plain forecast.
- **HTTP 200 but unusable** (empty `daily.time`, or no suffixed keys):
  `DataNotFoundError` from `validateModelComparisonResponse` (D3).
- **After all-null drops, fewer than 2 comparison models remain:**
  `DataNotFoundError('OpenMeteo', 'Model comparison data is unavailable
  for this location')` — thrown by the handler from the pure module's meta,
  not rendered as an empty comparison.
- **Invalid model name 400** (fact c): unreachable with the curated
  constant; the exact-param-string service test (§Testing) is the lock
  against a typo ever shipping.

### D8. Cache

Key: `Cache.generateKey('openmeteo-model-comparison', latitude, longitude,
days, unitSignature(prefs))` — a distinct namespace so comparison responses
can never serve or be served by `openmeteo-forecast` entries. The model set
is a fixed constant, so it is **not** a key component; the cache is
in-process, so any future change to the set ships with a restart that
clears it (note this in a comment beside the key). TTL:
**`CacheConfig.ttl.forecast`** (2 h — `src/config/cache.ts:87`). Note the
known inconsistency: `getForecast:661` hardcodes `2 * 60 * 60 * 1000`; the
new method uses the config constant and the old method is **not** refactored
in this feature (byte-identical discipline).

### D9. get_weather_summary — strip the flag explicitly

`handleGetWeatherSummary` spreads raw caller args into every sub-handler
(`src/handlers/weatherSummaryHandler.ts:107-114`), so `compare_models` would
flow into its `handleGetForecast` sub-call **silently**. Settled: the
summary strips it — `compare_models: undefined` added to the `subArgs`
literal beside the existing `location_name: undefined` / `city_name:
undefined` nulling. A comparison block inside a summary is the wrong shape
for that tool; users wanting comparison call `get_forecast` directly.
Locked by an explicit test (§Testing).

### D-types. TypeScript strict, no `any`

The closed interfaces `OpenMeteoForecastDailyData`
(`src/types/openmeteo.ts:191-212`) and `OpenMeteoForecastResponse`
(`:328-342`) are **not** widened. New separate types:

```ts
export interface OpenMeteoModelComparisonDaily {
  time: string[];
  [key: string]: string[] | (number | null)[] | undefined;
}
export interface OpenMeteoModelComparisonResponse {
  latitude: number; longitude: number; elevation: number;
  timezone: string; timezone_abbreviation: string; utc_offset_seconds: number;
  daily: OpenMeteoModelComparisonDaily;
  daily_units?: Record<string, string>;
}
```

Dynamic suffixed access goes exclusively through the pure module's guarded
`extractModelSeries` (D4) — no casts, no `any`.

### D10. Schema, descriptions, docs

- `src/index.ts:296-347`: `compare_models` property added before
  `...DETAIL_SCHEMA_PROPERTY` (~`:342`) with the D1 description; the tool
  description gains one sentence ("Can compare multiple global weather
  models with compare_models=true to gauge forecast confidence."). Dispatch
  (`:781-784`) unchanged — args pass through.
- `src/config/tools.ts`: no change (no new tool); noted because
  `get_forecast` is in ALL presets — the description-size discipline in D1
  is the mitigation.
- CLAUDE.md tool table/notes; README.md features table; `docs/TOOLS.md`
  get_forecast section (including the ignored-flags interactions from D1);
  CHANGELOG.md under `[Unreleased]`.
- `docs/planning/README.md`: flip the "Multi-model forecast comparison" row
  💡 → 📝 when this doc lands, → ✅ at completion; also annotate the
  "Forecast uncertainty/confidence" row (FE §13.1) as substantially covered
  by this feature. `FORK_DERIVED_IDEAS.md` §4 gets a back-link to this doc.
  Record descoped 💡 rows: caller-selectable model list; single-model
  ensemble spread.

## Edge cases

| Case | Behavior |
|------|----------|
| `compare_models` absent/false | Byte-identical output on every path (locked by existing tests, unedited — §Testing) |
| `compare_models: true` + `granularity: "hourly"` | Validation error (comparison is the product; not silently ignored) |
| `compare_models: true` + `source: "noaa"` | Validation error — comparison is Open-Meteo-only |
| US point, `source: "auto"` + flag | Straight to Open-Meteo comparison; NOAA never called; NWS-not-compared disclosure in footer |
| A model returns HTTP 200 all-null (bom_access_global mode) | Dropped from stats; disclosure line; comparison proceeds with remaining models |
| Per-variable null (UKMO precipitation probability) | Model participates in temp/wind/conditions; probability line shows its own count "(4 models)" |
| `days: 16`, ragged horizons | Per-day "(N of 5 models)"; trailing days with < 2 comparison models trimmed with note |
| After drops, < 2 comparison models remain | `DataNotFoundError` — never an empty or one-model "comparison" |
| Response has `daily.time` but no suffixed keys | `DataNotFoundError` from the new validator (old validator would mis-handle this shape) |
| `best_match` null for a day | Best-match line omitted; spread stats unaffected (it was never in them) |
| Metric / mixed unit prefs | Values in caller's units; band thresholds scale (≤ 2.2 °C tight); precip threshold 0.25 mm |
| `include_normals` / `include_astronomy` + flag | Silently ignored (documented); `include_precipitation_probability: false` drops probability fragment |
| `get_weather_summary` with `compare_models: true` | Flag stripped in `subArgs`; summary forecast section unchanged |
| Saved/geocoded location name | `formatLocationLine` prepends as on every path (common code, unchanged) |

## Testing

- **Pure module (`tests/unit/modelComparison.test.ts`, new):** spread
  min/max/range/median; `classifyTempSpread` band edges at 4/8 °F and the
  scaled °C edges (2.2/4.4); precip consensus incl. threshold edges
  (0.01 in / 0.25 mm) and the UKMO-style missing-probability count;
  `weatherCodeBucket` boundaries; day-level agreement label rule
  (Good/Moderate/Low); outlier naming rule incl. the
  removing-it-must-drop-the-band condition; all-null model drop; per-day
  participation counts; trailing trim at < 2 models; interior-gap day
  retained; best_match excluded from every stat.
- **Service (`tests/unit/openmeteo-model-comparison.test.ts`, new; the
  `openmeteo-fire-variables.test.ts` pattern — spy on private
  `makeRequestToForecast`):** exact `models` param string
  `best_match,gfs_seamless,ecmwf_ifs025,icon_seamless,gem_seamless,ukmo_seamless`
  (the D7 typo lock); exact six-variable `daily` list; unit params present;
  `forecast_days`; cache key namespace `openmeteo-model-comparison` with
  unit signature; TTL = `CacheConfig.ttl.forecast`; validator throws
  `DataNotFoundError` on empty `daily.time` and on unsuffixed-only keys;
  **no retry-without-models on 400** (contract, not garnish).
- **Handler (`tests/unit/forecast-model-comparison.test.ts`, new; fake
  services per `forecast-fallback.test.ts` conventions):** fixture
  multi-model responses for — happy 5-model path; all-null-model drop with
  disclosure; UKMO per-variable null; ragged-horizon fixture asserting
  "(4 of 5 models)" and the trim note; hourly + flag error; `source:
  "noaa"` + flag error; US point + flag asserts **no NOAA service method is
  called** and the NWS disclosure renders; `include_precipitation_probability:
  false`; `detail` summary/standard/full shapes; < 2 models →
  `DataNotFoundError`.
- **Flag-off byte-identical locks (pass unedited):**
  `tests/unit/forecast-fallback.test.ts`, `tests/unit/astronomy.test.ts`,
  `tests/unit/normals.test.ts`, `tests/unit/almanac-handler.test.ts`,
  `tests/unit/weather-summary-handler.test.ts` — plus the service-level
  guarantee that `getForecast`'s params/cache key show no diff.
- **Weather-summary strip (append to
  `tests/unit/weather-summary-handler.test.ts`):** summary call with
  `compare_models: true` → `getModelComparison` never invoked; forecast
  section renders the standard shape.
- **Integration:** one live smoke test, flake-tolerant (project
  convention): real endpoint, stable location, asserts suffixed keys
  present and ≥ 4 of 5 comparison models return non-null temperature data.
- **Byte-identical verification (release gate, fire-weather precedent):**
  diff built-dist output against branch base for (a) default no-flag US
  request, (b) no-flag non-US request — both identical.

## Documentation / registration checklist (for /run-plan tracking)

- [x] `src/utils/modelComparison.ts` — D4 pure module + heuristic-band doc comments
- [x] `src/services/openmeteo.ts` — `COMPARISON_MODELS`, `getModelComparison`, `buildModelComparisonParams`, `validateModelComparisonResponse`, D8 cache
- [x] `src/types/openmeteo.ts` — D-types response interfaces
- [x] `src/handlers/forecastHandler.ts` — D1 arg + validation, D2 routing, D5 `formatModelComparisonForecast`
- [x] `src/handlers/weatherSummaryHandler.ts` — D9 strip
- [x] `src/index.ts` — D10 schema property + tool description
- [x] Tests per §Testing
- [x] README.md, CHANGELOG.md, CLAUDE.md, `docs/TOOLS.md`
- [x] `docs/planning/README.md` + `FORK_DERIVED_IDEAS.md` §4 — status flips, back-link, descoped 💡 rows
- [x] Move this doc to `docs/plans/` at completion (project convention)

## Implementation notes (2026-08-15)

Branch `feat/multi-model-comparison`, base `main` @ `bcb9672` (v1.20.0).
Final gate: `npm run build` 0 errors · `npm test` **2,058 passing** (1,961
baseline + 97 new) · `npm audit` 0 vulnerabilities.

**Design points that moved during implementation:**

- **`COMPARISON_MODELS` lives in the pure module, not the service.** D3's prose
  placed it "on the service", but D4 forbids the pure module importing services.
  The only compile-clean arrangement keeping a single source of truth is to
  define it in `src/utils/modelComparison.ts` and have `openmeteo.ts` import it —
  the normal service→util direction (cf. `openMeteoUnitParams`).
- **Entry point named `buildModelComparison(daily, tempUnit, precipUnit)`** —
  the design left the name open. It takes the two unit *fields* as plain
  arguments rather than a `UnitPreferences` object, so the module keeps zero
  imports.
- **Precipitation amount ranges cover only the wet models.** D5's sketch showed
  "(0.05–0.31 in)"; a naive implementation ranges over *all* participating
  models, so dry models pin every minimum to `0.00` and a confident forecast
  reads as "anywhere from nothing". Caught by reading real rendered output, not
  by a failing assertion. Derived by taking the `wetCount` largest values, which
  is exactly the wet set since "wet" is a `>=` threshold test.
- **An all-days-trimmed response yields `days: []`**, which the handler treats
  like the D7 `< 2 models` case rather than rendering an empty comparison. A day
  with `participantCount < 2` states that plainly instead of rendering a
  zero-width range that would read as perfect agreement.
- **The live smoke test re-throws assertion failures.** The sibling live files
  use a blanket `catch` that swallows them, leaving a test that can never fail.
  This one tolerates only transport failures — proven both directions (a forced
  threshold breach turns the suite red; an unroutable endpoint passes).

**Byte-identical sweep** (built dist vs. `bcb9672`, run by the orchestrator):

| # | Scenario | Result |
|---|----------|--------|
| 1 | No-flag US (Denver, 3 d) | **Byte-identical** to base |
| 2 | No-flag non-US (Milan, 3 d) | **Byte-identical** to base |
| 3 | Non-US + flag | Comparison renders; no NWS sentence |
| 4 | US + flag (`source: "auto"`) | Comparison renders with NWS disclosure; NOAA never contacted |
| 5 | `days: 16` (Seattle) | Per-day "(3 of 5 models)" → "(2 of 5)" counts; trim note fired for 1 day |
| 6 | Metric vs imperial (Milan) | Values in caller's units; labels consistent (6 °F and 3.3 °C both *moderate*) |
| 7 | `detail` summary / full | One line per day; per-model value lines |
| 8 | `get_weather_summary` + flag | Standard daily forecast; zero comparison output (strip holds live) |

Live behaviour observed during the sweep: 5/5 models returned data at Denver,
Milan and Seattle; the UKMO no-probability disclosure and the ragged-horizon
trim note both fired against real responses rather than only fixtures.
