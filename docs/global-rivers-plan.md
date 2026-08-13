# Global River Conditions — Design Plan

**Status:** IMPLEMENTED (2026-08-12, on `feat/global-rivers` for v1.15.0)
**Parent:** `docs/planning/INTERNATIONAL_COVERAGE_ROADMAP.md` (Phase 2)
**Target release:** v1.15.0
**Branch (for /impl-plan):** `feat/global-rivers`
**Upstream verification:** live-tested 2026-08-12 — see ICR §Live verification
notes and the viability table in `docs/planning/README.md`.

## What / Why

`get_river_conditions` is US-only: `src/handlers/riverConditionsHandler.ts`
calls `noaaService.getNWPSGaugesInBoundingBox()` unconditionally. Any non-US
location returns nothing useful.

Fix: replicate the auto-select pattern from
`src/handlers/currentConditionsHandler.ts` — US → NOAA NWPS gauges
(unchanged), elsewhere → **Open-Meteo Flood API** (GloFAS v4 river discharge,
~5 km grid, daily, ensemble percentiles, forecast to 210 days, keyless,
CC-BY). No new provider: extends the existing `OpenMeteoService`.

**Scope decision (2026-08-12):** Open-Meteo Flood only. The UK Environment
Agency gauge supplement stays 💡 in the planning index as its own follow-up.

**The verified design risk:** discharge is per ~0.05° grid cell, and a cell
off the river channel returns local-runoff noise — live probe: Memphis
35.125,-90.075 → 0.63 m³/s while 35.125,-90.125 (the Mississippi channel, one
cell west) → 11,640 m³/s. D3 exists to solve exactly this.

## Design decisions (settled)

### D1. Routing

- `auto` (default): `isInUS(lat, lon)` (`src/utils/geography.ts`) → NOAA NWPS
  path, completely unchanged; else → Open-Meteo Flood path.
- New `source` parameter: `'auto' | 'noaa' | 'openmeteo'`, same contract as
  `get_current_conditions`. Explicit `noaa` outside the US keeps today's
  behavior (gauge search finds nothing). Explicit `openmeteo` works anywhere,
  including the US (useful for comparison and for US rivers with no nearby
  NWPS gauge).
- No cross-fallback in v1 (US point with zero gauges does **not** silently
  switch to model discharge — the two outputs mean different things). Note as
  a possible future enhancement.

### D2. Service method

`OpenMeteoService.getRiverDischarge(latitudes, longitudes, forecastDays)` in
`src/services/openmeteo.ts`:

- New constructor URL `floodURL = 'https://flood-api.open-meteo.com/v1'` and a
  `makeRequestToFlood<T>()` wrapper following the existing
  `makeRequestToForecast` / `makeRequestToAirQuality` pattern (retry +
  backoff + error mapping identical).
- Request: `daily=river_discharge,river_discharge_mean,river_discharge_median,`
  `river_discharge_max,river_discharge_min,river_discharge_p25,river_discharge_p75`
  with `past_days=31` (context window for trend/typical level),
  `forecast_days` (validated 1–210, default 7 — the live API accepts 366 but
  210 is the documented contract), `timezone=auto`.
- **Multi-point form:** `latitude`/`longitude` accept comma-separated lists
  (standard Open-Meteo behavior — response becomes an array). D3's cell probe
  uses this so the whole neighborhood is **one** HTTP request.
- Types: new `OpenMeteoFloodResponse` interface in `src/types/openmeteo.ts`
  (`daily` block + `daily_units`; note the `m³/s` unit string contains
  Unicode `³`). No `any`.
- Cache: new `CacheConfig.ttl.floodDischarge = 6 * HOUR` in
  `src/config/cache.ts` (GloFAS updates daily; 6h balances freshness against
  the 9-point probe cost). Key: rounded requested coords + forecast_days —
  cache the *assembled probe result*, not individual cells.

### D3. Channel snapping (the load-bearing decision)

A single-point query near a major river can be off by 4+ orders of magnitude.
Solution, verified feasible live:

1. Build a 3×3 probe grid centered on the target: offsets of −0.05, 0, +0.05
   degrees in lat and lon (≈ one GloFAS cell pitch; covers ~±5–8 km).
2. Fetch all 9 cells in one multi-point request (D2).
3. `pickChannelCell(cells)` — a **pure, unit-tested function** in a new
   `src/utils/riverDischarge.ts`: select the cell with the highest mean
   discharge over the past-31-day window, ignoring cells whose series is
   all-null.
   - All 9 cells null → "no river data for this location" (ocean, desert —
     the API returns HTTP 200 with null arrays, never an error; live-verified).
   - Max mean < 0.1 m³/s → report it, but label it "minor local drainage —
     no significant river within ~8 km".
4. Output discloses the snap when the chosen cell is not the center:
   "Nearest modeled river channel: ~5 km W of requested point" (distance via
   the existing haversine util `src/utils/distance.ts`).

### D4. Presentation without flood stages

GloFAS gives discharge + ensemble spread — no NWPS-style flood categories.
Present discharge **against its own history and ensemble**:

- **Current level:** today's `river_discharge` in m³/s, with ft³/s (cfs) when
  the resolved unit preference is imperial (add a discharge conversion to
  `src/utils/units.ts`; discharge is a new quantity, follows
  `WEATHER_UNITS`).
- **Context:** ratio vs the past-31-day mean ("~2.1× the recent average" /
  "near the recent average" / "well below").
- **Trend:** rising/falling/steady from the past-7-day series — reuse the
  wording style of the NWPS `formatStageTrend` (do not reuse the function; ft
  thresholds don't apply to m³/s — use a relative ±10% threshold).
- **Forecast:** per-day median with p25–p75 band. Ensemble spread is only
  meaningful from ~day 4 (live finding: earlier days are near-identical
  across percentile variables) — show the band from day 1 anyway but label
  the section "ensemble forecast".
- `detail` levels (existing `validateDetail`): `basic` = current + trend +
  7-day median/band summary; `full` = adds min/max envelope and the full
  requested day range.

### D5. Args and schema

`RiverConditionsArgs` gains `source?: string` and `forecast_days?: number`.
Existing `radius` keeps its meaning **on the NOAA path only**; schema
description updated: "US gauge search radius; ignored for the global model
path". `LOCATION_SCHEMA_PROPERTIES` already provides
latitude/longitude/location_name/city_name. `required: []` unchanged.

Tool description in `src/index.ts` updated: remove "(US only)", describe the
two data modes (US: gauge observations + flood categories; elsewhere: GloFAS
model discharge vs. historical/ensemble context).

### D6. Output framing and attribution

Non-US output header, mirroring the current-conditions precedent for model
data:

```
**Location:** <resolved place>          ← prependLocationLine, unchanged
**Source:** Open-Meteo Flood API (GloFAS v4, ~5 km model grid)

⚠️ Model-estimated river discharge — not gauge observations. No official
flood-stage thresholds exist for this data; levels are shown relative to
recent history and the forecast ensemble.
```

Footer credit: "River discharge data by Open-Meteo.com (CC-BY 4.0)" —
matches existing Open-Meteo attribution elsewhere in the server.

## Edge cases

| Case | Behavior |
|------|----------|
| Ocean / no river (all cells null) | Friendly "no river data" message, not an error |
| Requested point in US, `source: 'openmeteo'` | Works; output uses the model framing (D6) |
| Border cities routed US by `isInUS` overrun (Toronto-style) | NWPS finds no gauges → existing empty-result message; unchanged in v1 (documented limitation; cross-fallback is future work) |
| `forecast_days` out of 1–210 | Validation error via existing patterns |
| One probe request fails | Whole tool call fails with sanitized `ServiceUnavailableError` (single request — no partial state) |

## Testing

- **Unit** (`tests/unit/river-discharge.test.ts`): `pickChannelCell` — max
  selection, all-null, mixed-null, minor-drainage threshold, tie behavior;
  trend classification at ±10%; m³/s→cfs conversion; formatting incl. the
  snapped-distance line and Unicode `³` unit handling.
- **Unit (routing):** handler routes by `isInUS` and honors explicit
  `source`, mirroring `tests/unit/` routing tests for current conditions.
- **Integration** (`tests/integration/`): mocked multi-point flood response
  (9-cell array shape); one live smoke test tolerant of network flake (see
  project convention for live-network tests).

## Documentation / registration checklist

- [x] `src/index.ts` schema + description (D5)
- [x] README.md tool table: `get_river_conditions` → global (plus the coverage
      table row and a modeled-discharge caveat in the limitations list)
- [x] CHANGELOG.md — recorded under `[Unreleased]`; the version bump to 1.15.0
      is a separate release step
- [x] `docs/planning/README.md`: idea row flipped to ✅, Shipped table updated,
      UK EA supplement listed as its own open idea; ICR Phase 2 marked shipped
- [x] CLAUDE.md tool list note (rivers no longer "US only") + status blurb
- [x] `docs/TOOLS.md` §12 rewritten for both data modes, index line at §12

## Implementation notes (added at completion)

Two things the live sweep settled that the design could not:

- **`forecast_days=N` counts from the location's local today**, not the day
  after — `forecast_days=1` returns today and nothing else. Day 1 of the
  ensemble is therefore today, which is also why today's ensemble median can
  differ from the Current Discharge figure (the latter is the deterministic
  run, the former the ensemble median).
- **Ensemble spread confirmed absent before ~day 4**: p25 and p75 were
  identical for the first three forecast days at every location probed, then
  widened sharply. D4's decision to show the band from day 1 with the caveat in
  the section wording holds up — the early rows are honest, just narrow.

The Memphis probe reproduced exactly as predicted against the built dist:
35.125,-90.075 snapped ~5 km W to 11,640 m³/s, rejecting the 0.63 m³/s
off-channel cell.
