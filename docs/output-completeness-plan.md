# Output Completeness (Range-Audit Follow-ups) — Design Plan

**Status:** DRAFT (2026-07-16) — decisions NOT settled; do not run `/impl-plan`
until the open questions below are answered and this header says SETTLED
**Parent:** `docs/max-range-expansion-plan.md` (the 2026-07-16 full-codebase
range audit; these are its Tier 2 findings, deferred by user decision
2026-07-16 so the range-gap batch could proceed alone)
**Target release:** unscheduled (after the max-range-expansion batch ships)
**Branch (for /impl-plan, once settled):** `feat/output-completeness`

## What / Why

The 2026-07-16 range audit (see parent plan) found, beyond the three true
range gaps, a second tier of findings: data that is fetched and paid for but
never displayed, display caps with no escape hatch, and one attribution error.
None block the range work; all are user-visible polish. Each item below
carries its audit evidence so no re-discovery is needed when this plan is
picked up.

## Candidate items (each needs a settle/reject decision)

### C1. AQI forecast: per-day peak UV (fetched, never displayed)

The air-quality service requests hourly `uv_index`, `uv_index_clear_sky`, and
all pollutant concentrations for every forecast hour
(`src/services/openmeteo.ts:980-999`), but the day-grouped forecast formatter
(`formatHourlyForecast`, `src/handlers/airQualityHandler.ts`) renders AQI only.
Only current UV is shown (`airQualityHandler.ts:133-148`).

- **Cheap win candidate:** add peak UV to each day header (e.g.
  `### Friday, Jul 17 — peak US AQI 199 (Unhealthy) · UV 9 (Very High)`), using
  the same null-guarded scan as the AQI values. Useful for the same
  event-planning question the AQI forecast serves.
- **Counterpart cleanup:** if UV display is rejected, trim `uv_index`,
  `uv_index_clear_sky`, and unused hourly pollutant variables from the fetch
  instead (smaller payloads); if accepted, trim only the still-unused
  variables.
- **Open question:** show hourly pollutant forecasts at any detail level, or
  never? (Audit lean: never — noise; peak-UV-only is the right scope.)

### C2. `detail="full"` overrides for top-N proximity caps

Three tools display nearest-N of everything fetched, disclose the remainder
count, and offer no way to see the rest — inconsistent with the
`detail="full"` escape-hatch contract used by `get_forecast` and (after the
parent plan's D3) `get_weather_imagery`:

- River: top 5 gauges (`src/handlers/riverConditionsHandler.ts:113-122`), top
  3 historic crests (`riverConditionsHandler.ts:223`).
- Wildfire: top 5 fires (`src/handlers/wildfireHandler.ts:129-138`).
- Lightning: 10 nearest strikes listed; statistics already aggregate all
  strikes (`src/handlers/lightningHandler.ts:369,386-388`).

Proposal shape: add the shared `detail` parameter to these three tools
(schema + `validateDetail`), where `full` lifts the N-caps; `summary`/
`standard` keep current behavior + a "use detail=full" note.

- **Open question:** is unbounded listing acceptable for wildfire in a bad
  fire season (bbox could contain dozens of fires), or should `full` mean a
  higher cap (e.g. 25) with the count disclosed?

### C3. Wildfire: surface the ArcGIS transfer-limit caveat

`queryFirePerimeters` logs `exceededTransferLimit`
(`src/services/nifc.ts:123,143`) but the user is never told the result set was
truncated upstream. Add a caveat line to the report when the flag is set
("results may be incomplete — the fire data service truncated the response").
Small, likely uncontroversial; bundled here because it touches the same
handler as C2.

### C4. River conditions: forecast time series + attribution fix

- The handler shows a single forecast point per gauge from the NWPS bbox
  response; the existing multi-day series method `getNWPSStageFlow`
  (`src/services/noaa.ts:666-683`) is never called. Wiring it in (crest
  timing, rise/fall trend per gauge) is a genuine feature addition — the
  largest item in this plan.
- `getUSGSStreamflow` (`noaa.ts:819-866`) is dead code for this tool, yet the
  footer credits USGS (`riverConditionsHandler.ts:134`). Either wire USGS in
  as part of the series work or fix the attribution.
- **Attribution fix is severable:** one-line change, could ride any earlier
  batch if desired.
- **Open questions:** per-gauge series for all shown gauges or nearest-only?
  Behind `detail="full"` or always-on? Does NWPS stageflow data cover enough
  gauges to be worth it (needs live probing)?

## Out of scope

- Anything already shipped or settled in `docs/max-range-expansion-plan.md`
  (marine `forecast_days`, historical `limit` 744, imagery frames/nowcast).
- Tools verified clean in the audit (forecast, summary, lightning window,
  current conditions, alerts).

## Acceptance (to be written per-item once decisions are settled)

Each accepted item follows the house pattern: unit tests alongside the change,
`npm run build` + `npx vitest run tests/unit` green, live end-to-end
verification against the real APIs, CHANGELOG + `docs/TOOLS.md` updates.

## Touch set (indicative, per candidate)

| Item | Files |
|---|---|
| C1 | `src/handlers/airQualityHandler.ts`, `src/services/openmeteo.ts` (variable list), `tests/unit/air-quality-forecast.test.ts` |
| C2 | `src/handlers/riverConditionsHandler.ts`, `src/handlers/wildfireHandler.ts`, `src/handlers/lightningHandler.ts`, `src/index.ts` (schemas), unit tests per handler |
| C3 | `src/services/nifc.ts` (surface flag), `src/handlers/wildfireHandler.ts` |
| C4 | `src/handlers/riverConditionsHandler.ts`, `src/services/noaa.ts` (wire `getNWPSStageFlow`), `src/index.ts`, new unit tests |
