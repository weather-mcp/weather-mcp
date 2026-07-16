# Output Completeness (Range-Audit Follow-ups) — Design Plan

**Status:** SETTLED (2026-07-16) — all four decisions made; ready for `/impl-plan`
**Parent:** `docs/max-range-expansion-plan.md` (the 2026-07-16 full-codebase
range audit; these are its Tier 2 findings, deferred by user decision
2026-07-16 so the range-gap batch could proceed alone)
**Sibling evidence:** `docs/max-range-expansion-verification.md` (2026-07-16) —
its observations O1/O2 are related; see "Noted, not settled" below
**Target release:** next minor after the max-range-expansion batch ships
**Branch (for /impl-plan):** `feat/output-completeness`, cut from `main` once
`feat/max-range-expansion` merges

## What / Why

The 2026-07-16 range audit (see parent plan) found, beyond the three true
range gaps, a second tier of findings: data that is fetched and paid for but
never displayed, display caps with no escape hatch, and one attribution error.
None block the range work; all are user-visible polish.

Decisions were settled 2026-07-16 after a live evidence-gathering pass; the
measurements below are what each decision rests on. **Two of the four open
questions were answered by evidence rather than preference** — see D2 and D4.

### Live evidence gathered (2026-07-16)

| Probe | Result | Decides |
|---|---|---|
| AQI hourly fetch vs. formatter reads | Fetches **24** hourly vars (`openmeteo.ts:980-999`); formatter reads only `us_aqi` / `european_aqi` (`airQualityHandler.ts:220`) — **22 unused** | D1 |
| NWPS gauges, Boston 100 km bbox | **126** gauges (tool showed nearest 5, disclosed 98 more) | D2 |
| NWPS gauges, Boston 500 km bbox | **1,247** gauges | D2 |
| NWPS gauges, Chicago 500 km bbox | **1,939** gauges → ~582k chars / **~145k tokens** if listed unbounded (**6× a 25k client cap**) | D2 |
| NIFC fires, NorCal 500 km, peak season | **11** fires (tool showed 5, disclosed 6 more) | D2 |
| NWPS stageflow, 5 real gauges from live tool output | **observed: 5/5** rich (2,800–7,100 pts / 30 days); **forecast: 1/5** (only the tidal harbor gauge; the 4 small rivers return 0 pts) | D4 |
| NWPS stageflow, 3 major rivers (Mississippi/Ohio/Potomac) | observed 1,383–7,071 pts; forecast 20–72 pts (3–14 days) | D4 |

Method note: an earlier probe of invented LIDs returned 404s — those were bad
gauge IDs, **not** evidence of missing coverage, and are excluded. The coverage
figures above use real LIDs taken from live `get_river_conditions` output.

## Settled decisions

### D1. AQI forecast: add per-day peak UV, trim the fetch to 3 variables (was C1)

**Decision (2026-07-16):** add peak UV to each day header **and** trim the 21
now-unused hourly variables.

- **Display** (`formatHourlyForecast`, `src/handlers/airQualityHandler.ts`): add
  peak UV to the day header alongside peak AQI, using the same null-guarded
  scan the AQI values use:
  `### Friday, Jul 17 — peak US AQI 133 (Unhealthy for Sensitive Groups) · UV 9 (Very High)`
  Reuse the existing UV level/description mapping from the current-conditions
  block (`airQualityHandler.ts:133-148`) — do not fork the thresholds.
- **Fetch** (`src/services/openmeteo.ts:980-999`): reduce the hourly list from
  24 variables to **3** — `us_aqi`, `european_aqi`, `uv_index`. Drop the 21
  unused: all raw pollutant concentrations, `aerosol_optical_depth`, `dust`,
  `ammonia`, `uv_index_clear_sky`, and every per-pollutant AQI sub-index
  (`us_aqi_pm2_5`, `european_aqi_ozone`, …). Current-conditions variables
  (the `current=` param) are **untouched** — pollutant concentrations still
  display for the current hour.
- **Open question resolved:** hourly pollutant forecasts are **never** shown, at
  any detail level (audit lean confirmed) — hence the trim is safe.
- **Null handling:** UV must use the same finite-number guard as AQI. A day
  whose UV is all-null shows the AQI header without the UV clause — it must not
  render "UV 0 (Low)", which is the same null-coercion bug class the parent
  batch fixed twice.

### D2. `detail="full"` lifts top-N caps to a **capped 25**, disclosed (was C2)

**Decision (2026-07-16):** `full` = nearest **25**, uniformly across the three
tools, remainder still disclosed. **Not unbounded.**

The open question ("is unbounded acceptable for wildfire?") was settled by
evidence, and the answer generalized in the opposite direction from the audit's
framing — the danger is rivers, not fires:

- Unbounded rivers would list **1,939** gauges within 500 km of Chicago
  (~145k tokens) — it would reliably exceed client token limits across most of
  the eastern US. That is verification finding O1's failure mode, ~6× worse.
- Wildfire's worst realistic case is small (**11** fires within 500 km in peak
  NorCal season), so unbounded would *probably* be safe there — but a uniform
  contract is worth more than squeezing out a cap that never binds in practice.
  25 does not bind at 11.

Shape: add the shared `detail` parameter (schema + `validateDetail`) to
`get_river_conditions`, `get_wildfire_info`, `get_lightning_activity`.

| Tool | `summary`/`standard` (unchanged) | `full` |
|---|---|---|
| River gauges (`riverConditionsHandler.ts:113-122`) | 5 | 25 |
| River historic crests (`riverConditionsHandler.ts:223`) | 3 | 25 |
| Wildfire fires (`wildfireHandler.ts:129-138`) | 5 | 25 |
| Lightning strikes (`lightningHandler.ts:369`) | 10 | 25 |

- Lower detail levels keep current behavior **plus** a "use detail=\"full\" for
  more" pointer, matching the escape-hatch contract from the parent batch's D3.
- The remainder note stays accurate at `full` too — e.g.
  `*Note: 1,914 additional gauges found within radius (showing nearest 25)*`.
  A capped escape hatch that hides the cap would be the original defect again.
- Lightning statistics already aggregate **all** strikes; that is unchanged —
  only the listed-strike cap moves.

### D3. Wildfire: surface the ArcGIS transfer-limit caveat (was C3, no open question)

Accepted as written. `queryFirePerimeters` logs `exceededTransferLimit`
(`src/services/nifc.ts:123,143`) but never tells the user the result set was
truncated upstream. When the flag is set, add a caveat line to the report:
*"Results may be incomplete — the fire data service truncated the response."*

Interacts with D2: when the upstream response is truncated, `detail="full"`
cannot deliver "everything" and must not imply it. The caveat must render at
**all** detail levels.

### D4. River: observed trend on all shown gauges; forecast series at `full`; attribution fixed now (was C4)

**Decision (2026-07-16):** the live probe reframed this item. The plan assumed
the prize was the multi-day forecast series; the evidence says otherwise:

- **Observed series: 5/5 gauges** (2,800–7,100 points over 30 days) → a rise/
  fall **trend** can be computed for *every* gauge the tool shows.
- **Forecast series: 1/5 gauges** — and the one that had it (BHBM3, a tidal
  harbor gauge) is exactly the one already showing a forecast point today. So
  wiring the series adds **no new gauges** to forecast coverage; it only adds
  *resolution* where a forecast already appears.

So the genuinely new capability is the **trend**, not the series.

- **Trend (always-on, all shown gauges):** call `getNWPSStageFlow`
  (`src/services/noaa.ts:666-683` — currently dead code) per shown gauge; derive
  direction and magnitude from the observed series and render inline:
  `**River Stage:** 0.97 ft  ↘ falling (-0.4 ft / 6h)`.
  Cost: **1 extra API call per shown gauge** (5 today at default detail; 25 at
  `full` under D2 — cache aggressively, these share the existing NWPS client
  and TTL policy).
- **Forecast series (at `detail="full"` only):** render the multi-point series
  with per-point flood category, for gauges that have one. Gauges without a
  forecast series (4/5) must render **nothing** — not an empty section.
- **Sentinel guard (mandatory):** NWPS is a known source of `-999` and year-0001
  placeholders — the v1.11.1 fix already strips these from the single forecast
  point (`riverConditionsHandler.ts`). Any series work **must** apply the same
  filter per-point, or the fix regresses at higher resolution. The probe script
  checked for `-999` in observed values and found none in the sample, but the
  guard is not optional.
- **Attribution: fix now, severed from the above.** `getUSGSStreamflow`
  (`noaa.ts:819-866`) and `getUSGSStreamflowForSite` (`noaa.ts:873`) are dead
  code, yet the footer credits USGS (`riverConditionsHandler.ts:134`). One-line
  accuracy fix, shippable independently of this plan:

  ```diff
  - *Data sources: NOAA National Water Prediction Service (NWPS), USGS Water Services*
  + *Data source: NOAA National Water Prediction Service (NWPS)*
  ```

  Wiring USGS in for real was considered and rejected for this batch.

## Noted, not settled (no decision taken — do not implement from this section)

From `docs/max-range-expansion-verification.md`:

- **O1 — historical `limit` ≳ 490 exceeds client token caps** (744 → ~38k
  tokens; the *old* 500 ceiling was already ~25.5k, so this is not a regression
  from that branch). Candidate: note payload size in the `limit` schema
  description. Related to D2's reasoning but a separate tool and decision.
- **O2 — historical truncation note names no escape hatch.** Today:
  `3 (of 744 available)`. D2 and the parent batch's D3 both settle on
  *disclose + name the lever*; historical discloses without naming `limit`.
  Cheap consistency fix, but it was not among the four decisions.

From `docs/testing/DEFECT_FIX_PLAN.md` (observed live during this pass):

- **F4** reproduces: the ROCK fire renders **"Size: 0 acres"** where NIFC
  reported no size. It lives in `wildfireHandler.ts` — the same handler D2 and
  D3 touch, so it is a natural bundling candidate for the `feat/output-completeness`
  branch. Not pulled in here; F4 remains owned by the defect plan.
- **O5** (defect plan) claims historical shows a pre-limit observation count.
  Live output today reads `3 (of 744 available)` — **appears already fixed**;
  the defect plan's table may be stale and should be re-checked before that item
  is scheduled.

## Out of scope

- Anything already shipped or settled in `docs/max-range-expansion-plan.md`
  (marine `forecast_days`, historical `limit` 744, imagery frames/nowcast).
- Tools verified clean in the audit (forecast, summary, lightning window,
  current conditions, alerts).
- Wiring USGS streamflow in as a live source (rejected in D4).
- Hourly pollutant forecast display (rejected in D1).

## Acceptance criteria

**D1**
- Each forecast day header shows peak UV alongside peak AQI, with the level word
  matching the current-conditions UV mapping.
- A location/day with null UV shows the AQI header and **no** UV clause — never
  "UV 0 (Low)".
- The hourly request carries exactly 3 variables; current-conditions pollutant
  output is unchanged.
- Unit tests in `tests/unit/air-quality-forecast.test.ts`: peak-UV selection,
  null-UV omission, all-null day, header format.
- Live: 7-day AQI forecast at a high-UV location shows plausible peak UV per day.

**D2**
- `detail="full"` lists up to 25 on all three tools; `summary`/`standard`
  unchanged (5/3/5/10) and carry the "use detail=\"full\"" pointer.
- The remainder note remains correct and present at `full` when >25 exist.
- `validateDetail` rejects bad values consistently with existing tools.
- Unit tests per handler: cap-at-25, note text at each detail level, note
  accuracy when the total exceeds 25.
- Live: river query at Chicago 500 km (≈1,939 gauges) at `detail="full"` returns
  25 gauges and a correct remainder note, and the response stays well inside
  client token limits.

**D3**
- With `exceededTransferLimit` set, the caveat renders at all three detail
  levels; with it unset, no caveat appears.
- Unit tests with both stubbed NIFC responses.

**D4**
- Every shown gauge with an observed series displays a trend (direction +
  magnitude + window); gauges without one omit the trend silently.
- `detail="full"` renders the forecast series only for gauges that have one;
  no empty sections for the ~4/5 that don't.
- `-999` / year-0001 sentinels never reach output, at any point in the series.
- Attribution footer credits NWPS only (shippable as a standalone commit).
- Unit tests: trend direction/magnitude math, sentinel filtering per-point,
  missing-series omission, footer text.
- Live: Boston 100 km — confirm trends on all 5 shown gauges and a series on
  BHBM3 only, matching the probe.

**All:** `npm run build` (0 errors), `npx vitest run tests/unit` green,
live end-to-end verification against real APIs (the null/sentinel bug classes in
this codebase have never been visible in the mocked suite), CHANGELOG +
`docs/TOOLS.md` updated.

## Touch set

| Item | Files |
|---|---|
| D1 | `src/handlers/airQualityHandler.ts`, `src/services/openmeteo.ts` (hourly var list), `tests/unit/air-quality-forecast.test.ts` |
| D2 | `src/handlers/riverConditionsHandler.ts`, `src/handlers/wildfireHandler.ts`, `src/handlers/lightningHandler.ts`, `src/index.ts` (3 schemas), unit tests per handler |
| D3 | `src/services/nifc.ts` (surface flag), `src/handlers/wildfireHandler.ts`, wildfire unit tests |
| D4 | `src/handlers/riverConditionsHandler.ts`, `src/services/noaa.ts` (wire `getNWPSStageFlow`), `src/index.ts`, new unit tests |
| All | `CHANGELOG.md`, `docs/TOOLS.md` |

## Suggested sequencing

1. **D4 attribution one-liner** — severable, ship anytime (fixes a factual error).
2. **D1** — self-contained, no schema surface beyond the fetch list.
3. **D2 + D3** — both touch `wildfireHandler.ts`; D3's caveat interacts with D2's
   `full` semantics, so land them together. Consider bundling defect **F4** here.
4. **D4 trend + series** — largest; depends on D2's `detail` param existing on
   `get_river_conditions`.
