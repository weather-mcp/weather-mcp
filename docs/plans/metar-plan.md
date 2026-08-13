# Worldwide Station Observations (METAR) — Design Plan

**Status:** IMPLEMENTED (2026-08-13) — shipped on `feat/metar` for v1.17.0.
Execution record: [`metar-implementation-plan.md`](./metar-implementation-plan.md).
**Parent:** `docs/planning/FUTURE_ENHANCEMENTS.md` §4 (aviation weather);
`docs/planning/INTERNATIONAL_COVERAGE_ROADMAP.md` Phase 1 leftover
**Target release:** v1.17.0
**Branch (for /impl-plan):** `feat/metar`
**Upstream verification:** live-tested 2026-08-13 — see the viability table in
`docs/planning/README.md` and the Verified API contract section below.

## What / Why

Outside the US, `get_current_conditions` has never returned an observation. It
returns a model, and the handler says so in its own footer
(`src/handlers/currentConditionsHandler.ts:692`):

```
*Data source: Open-Meteo (Global) — model-interpolated values, not station observations*
```

Inside the US the same tool serves real NOAA station observations. That
asymmetry is the largest remaining data-quality gap in the server, and ICR
Phase 1 named the fix when it shipped global current conditions — the
aviationweather.gov METAR supplement was "**not** taken up and remains
available as a future option" (ICR §Priority 1).

Fix: add **METAR station observations** as a source on `get_current_conditions`.
NOAA's Aviation Weather Center publishes decoded METARs worldwide as keyless
JSON — real instrument readings from real stations, on every continent. This
closes the observation gap without a new tool, a new key, or a new cost.

**Scope decision (2026-08-13):** observations only. TAF (forecasts), a
pilot-facing `get_metar` tool, and flight planning stay out — see D7.

**The design tension:** a METAR is a real measurement *at an airport*, which
may be tens of kilometres from the requested point; Open-Meteo is an
interpolated estimate *at the exact coordinates*. Neither strictly dominates,
so D1 makes the choice explicit rather than silent.

## Verified API contract (live 2026-08-13)

Base: `https://aviationweather.gov/api/data/metar` — keyless, v4, no signup.
Params: `ids=` (comma-separated ICAO), `bbox=minLat,minLon,maxLat,maxLon`,
`format=json`. Documented 100 req/min; a descriptive User-Agent is advised.

Field survey across **242 stations** in one bbox response:

| Field | Present | Type | Unit / notes |
|-------|---------|------|--------------|
| `icaoId`, `name`, `lat`, `lon`, `elev` | 100% | str/num | `elev` in metres |
| `obsTime` | 100% | int | **epoch seconds** |
| `reportTime`, `receiptTime` | 100% | str | **ISO 8601** — two time formats in one object |
| `rawOb`, `metarType`, `qcField` | 100% | str/int | `metarType` is `METAR` or `SPECI` |
| `temp`, `dewp` | 99% | number | °C |
| `wdir` | 98% | **`number \| string`** | degrees, or `"VRB"` for variable |
| `wspd` | 98% | number | **knots** |
| `altim` | 97% | number | hPa |
| `visib` | 97% | **`number \| string`** | statute miles; **strings are the majority** (`"10+"`, fractions) |
| `clouds`, `cover` | 96% | array/str | `[{cover, base}]`, **`base` in feet AGL** (verified: `SCT110`→`11000`, `BKN024`→`2400`) |
| `fltCat` | 96% | str | `VFR`/`MVFR`/`IFR`/`LIFR`, pre-computed |
| `slp` | 84% | number | hPa |
| `presTend` | 76% | number | hPa/3h |
| `wgst` | 14% | number | knots |
| `wxString` | 8% | str | present weather (`FG`, `FU`, …) |
| `pcp3hr`, `precip` | 5–7% | number | inches |

Load-bearing behaviours, all observed live:

- **Empty and invalid results return HTTP 204 with an empty body** — an ocean
  bbox and a bogus ICAO both did. This is not an empty JSON array; calling
  `.json()` on it throws. Must be handled before parsing.
- **Errors are not JSON.** A sustained burst produced **HTTP 502 with an HTML
  body** from the Azure gateway (`<html><head><title>502 Bad Gateway</title>`).
  Non-2xx must never be parsed as JSON. It recovered on retry — the endpoint is
  flaky enough that the existing retry/backoff wrapper is required, not optional.
- **No distance field, and results are not sorted usefully** (first five
  latitudes in a large bbox: 42.4, 42.21, 41.88, 44.38, 40.63). Nearest-station
  selection is entirely client-side.
- **Observation age is normal and material.** METARs are issued hourly near
  :53, with SPECIs between. In the 242-station sample, age was p50 ≈ 41 min,
  p90 ≈ 42 min, max ≈ 49 min. Output must always state the observation time.
- **Global coverage is real but thin.** 242 stations in a 19°×30° US box;
  0.5° boxes over Nairobi, Mumbai, Amazonia, and Patagonia each returned 1–2.

## Design decisions (settled)

### D1. Surface: a new `source` value, not a new tool, not a new default

- `get_current_conditions` gains `source: 'metar'`, joining
  `'auto' | 'noaa' | 'openmeteo'`. Works **worldwide, including the US**, where
  it is a useful second opinion (real airport obs, flight category, raw METAR).
- **`auto` is unchanged in v1.** US → NOAA, elsewhere → Open-Meteo, exactly as
  today. No existing call changes its output.
- Rationale for not auto-routing yet: this mirrors the rivers precedent
  (`docs/plans/global-rivers-plan.md` D1 — "no cross-fallback in v1 … the two
  outputs mean different things"). A model estimate at the caller's exact
  coordinates and a measurement at an airport 40 km away answer different
  questions, and silently swapping one for the other is a behaviour change we
  should make on evidence, not on assumption.
- Discoverability is handled in the schema description instead, with semantic
  triggers: "actual/real observation", "measured", "what is the station
  reporting", "METAR", "airport weather", "flight category".
- **Documented follow-ups** (not v1): (a) revisit `auto` preferring METAR
  outside the US once there is feedback; (b) use METAR for the border-overrun
  fallback — when `isInUS` misroutes Toronto or Vancouver and NOAA 404s, CYYZ
  and CYVR are real stations and would beat the current Open-Meteo fallback.

### D2. New service: `src/services/aviationWeather.ts`

`AviationWeatherService`, following the shape of `src/services/acis.ts` and
`nifc.ts` (retry + backoff + sanitized error mapping via the existing helpers):

```typescript
getMetarsInBoundingBox(bbox: BoundingBox): Promise<MetarObservation[]>
```

- Sends a descriptive `User-Agent` (project + contact), per the API's guidance
  and the met.no-style obligations the project already honours elsewhere.
- **Handles HTTP 204 as an empty result**, returning `[]` — never parsing an
  empty body.
- **Guards the content type on non-2xx** so an HTML 502 maps to
  `ServiceUnavailableError` with a sanitized message, not a JSON parse crash.
- Retries only on transient classes (502/503/504/network), consistent with the
  existing services; 204 is a success with no rows, not a retry trigger.
- Cache: new `CacheConfig.ttl.metarObservations = 10 * MINUTE` in
  `src/config/cache.ts` (obs are hourly; 10 min keeps a burst of calls to one
  fetch without serving a stale cycle). Key: the rounded bbox.

### D3. Station selection: a pure, unit-tested picker

New `src/utils/metarStation.ts`, mirroring how `pickChannelCell` isolates the
rivers heuristic:

```typescript
pickNearestStation(
  stations: MetarObservation[],
  latitude: number,
  longitude: number,
  now: DateTime
): StationPick | null
```

1. **Expanding bbox search** (the ACIS `findRecordsStation` widening precedent):
   ±0.5°, then ±2.0°, then ±5.0°, stopping at the first tier that yields an
   acceptable station. Longitude degrees shrink with latitude, so high-latitude
   boxes over-search in longitude — harmless, since distance sorting decides.
2. **Distance** via the existing `calculateDistance` (`src/utils/distance.ts`);
   direction via `compassPoint`, which already exists but is currently private
   to `src/utils/riverDischarge.ts`. **Move `bearingDegrees` and `compassPoint`
   into `distance.ts`** and have `riverDischarge.ts` import them — they are
   geometry, not hydrology, and METAR is the second consumer. Pure refactor, no
   behaviour change.
3. **Freshness filter:** prefer observations ≤ 90 min old (covers the hourly
   cycle plus reporting lag — the live max was 49 min). If none qualify, accept
   up to 6 h and set a `stale` flag that the formatter surfaces. Older than 6 h
   is treated as no station.
4. **Distance banding** on the result: ≤ 100 km renders normally; 100–250 km
   renders with a prominent "nearest station is far" caveat; beyond 250 km
   returns `null` (no usable station).

Returns the chosen observation plus `distanceKm`, `bearing`, `stale`, and the
tier that found it.

### D4. Types: model the mixed types honestly

New `src/types/aviationWeather.ts`. The two fields that are genuinely
polymorphic get union types — no `any`, no lying:

```typescript
wdir?: number | string;   // degrees, or "VRB"
visib?: number | string;  // statute miles, or "10+", or a fraction
```

Everything below 100% presence in the survey table is optional. Parsing helpers
live beside the picker as pure functions:

- `parseVisibilityMiles(v)` → `{ miles: number; qualifier?: 'plus' }` — handles
  `"10+"` (the common case), fractions (`"1/2"`), and plain numbers.
- `parseWindDirection(v)` → `number | 'variable'`.
- `relativeHumidityFromDewpoint(tempC, dewpC)` → % via the Magnus formula, in
  `src/utils/units.ts`. METAR carries no humidity field; this is pure math and
  restores a field users expect. Unit-tested against known pairs.
- `windDirectionFromDegrees(deg)` → 16-point compass, added to `units.ts`, with
  the existing `formatWindDirection` delegating to it (no behaviour change).

### D5. Output

Station identity, distance, and observation age are not decoration here — they
are what makes the number interpretable. All three are always shown.

```
# Current Conditions — Seattle-Tacoma Intl (KSEA)

**Location:** Seattle, WA
**Station:** Seattle-Tacoma Intl, WA, US (KSEA) — 12 mi SSW of the requested point, elev 377 ft
**Observed:** 8:53 AM PDT (41 minutes ago)

**Temperature:** 56°F (dew point 55°F, humidity 96%)
**Wind:** S (190°) at 7 mph
**Visibility:** 0.5 mi
**Sky:** Overcast (vertical visibility 200 ft)
**Weather:** Fog
**Pressure:** 29.94 inHg (sea level 1014.3 hPa)
**Flight category:** LIFR

`METAR KSEA 131453Z 19006KT 1/2SM R16L/2000VP6000FT FG VV002 13/13 A2994 …`

---
*Data source: NOAA Aviation Weather Center (aviationweather.gov) — METAR station observation*
```

- `**Location:**` comes from the existing `prependLocationLine` when the caller
  used a name, unchanged.
- The raw METAR is always included (one line, and it is the observation of
  record — the pilot-facing value without a pilot-facing tool).
- Absent fields are **omitted, not rendered empty** — `wgst` at 14% and
  `wxString` at 8% mean most reports are sparse.
- Caveat lines when they apply: far station (D3), stale observation (D3),
  `SPECI` (a special off-cycle report, worth naming).

### D6. Units

METAR units differ from every existing path, so conversion is explicit and
respects the caller's resolved `UnitPreferences`:

| METAR | Native | Route |
|-------|--------|-------|
| `temp`, `dewp` | °C | existing `formatTemperatureFromC` |
| `wspd`, `wgst` | knots | kt → m/s (×0.514444), then `convertWindFromMps`; `kn` is already a supported preference |
| `altim`, `slp` | hPa | hPa → Pa (×100), then `convertPressureFromPa` |
| `visib` | statute miles | mi → km, then `convertDistanceFromKm` |
| `elev` | metres | existing `metersToFeet` |
| cloud `base` | feet AGL | shown as feet; metric preference converts to metres |

### D7. Out of scope for v1

- **TAF** — a forecast, and `get_current_conditions` is an observation tool.
  The endpoint is verified working (`/api/data/taf`) and stays available for a
  future forecast-side idea.
- **A `get_metar` / aviation tool** — design principle #1. If pilot demand
  appears, the raw METAR is already in the output and TAF is one endpoint away.
- **`get_weather_summary` pass-through** — the summary stays lean, as the
  almanac plan decided for `include_astronomy` (D3 there).
- **`include_fire_weather` on the METAR path** — it needs NOAA gridpoint inputs
  (transport wind, Haines). Requesting it with `source: 'metar'` renders a
  one-line note that it is unavailable on this source, rather than silently
  dropping it.
- **`include_normals`** *is* supported on the METAR path — it only needs
  lat/lon and the date, so the existing normals + ACIS records helpers are
  called exactly as the other two paths call them.

## Edge cases

| Case | Behavior |
|------|----------|
| Mid-ocean / no station within 250 km | Friendly "no reporting station near this location" message, not an error (rivers precedent); no fallback to Open-Meteo, per D1 |
| API returns HTTP 204 | Treated as zero stations → widen a tier, then the message above |
| API returns HTML 502 | Retried; on exhaustion, sanitized `ServiceUnavailableError` |
| Nearest station 100–250 km away | Rendered with a prominent distance caveat |
| Only stale obs (90 min – 6 h) | Rendered with an explicit staleness note and the observation time |
| `wdir: "VRB"` | "Variable at 7 mph" — no bogus compass point |
| `visib: "10+"` | "10+ mi" — the qualifier is preserved, never parsed to a bare 10 |
| Station present but `temp` missing (1%) | Temperature line omitted; the rest still renders |
| bbox crossing the antimeridian | Clamp to ±180 and issue the two halves, or accept the narrower box; must not send an inverted bbox |
| `source: 'metar'` for a US point | Fully supported — real obs plus flight category |

## Testing

- **Unit — parsing** (`tests/unit/metar-parsing.test.ts`): `"10+"`, fractional
  and numeric visibility; `"VRB"` and numeric wind direction; humidity from
  temp/dewpoint against known pairs; kt/hPa/mile conversions; sparse reports
  where `wgst`/`wxString`/`slp` are absent.
- **Unit — station picking** (`tests/unit/metar-station.test.ts`): nearest wins;
  bbox tier widening; freshness preference and the stale flag; the 100 km and
  250 km bands; empty input → `null`; bearing/compass correctness.
- **Unit — geometry refactor:** existing `riverDischarge` tests must stay green
  after `bearingDegrees`/`compassPoint` move to `distance.ts` — that is the
  regression guard for D3 step 2.
- **Unit — handler routing:** `source: 'metar'` selects the new path; `auto`
  behaviour is **byte-identical to pre-branch output** for both a US and a
  non-US point (the D1 no-change guarantee); `include_fire_weather` note;
  `include_normals` still renders on the METAR path.
- **Integration** (`tests/integration/metar.test.ts`): mocked 200/204/502-HTML
  responses against the real captured shapes; one live smoke test following the
  project's flake-tolerant convention (this is a fifth live-network file — see
  the standing gate caveat).

**Acceptance (live, against the built dist):**

1. A US point (Seattle) with `source: 'metar'` returns KSEA or a nearer field
   with plausible values and a raw METAR.
2. A non-US point (London, Nairobi, Sydney) returns a real station — the
   feature's whole reason for existing.
3. A mid-ocean point returns the friendly no-station message, not an error.
4. `auto` output for a US and a non-US point is unchanged from `main`.
5. Metric and imperial preferences both render correctly.

## Documentation / registration checklist

- [x] `src/index.ts`: `'metar'` added to the `source` enum and the description
      rewritten with D1's semantic triggers
- [x] README.md: tool table, coverage notes, feature highlight, test-count badge
- [x] CHANGELOG.md under `[Unreleased]` (repo convention; the version bump is a
      separate release step)
- [x] `docs/TOOLS.md` §2 — the third source, what a METAR means, the caveats,
      and a "Returns (worldwide, via `source="metar"`)" block
- [x] `docs/planning/README.md`: METAR row 📝 → ✅, aviation-tool row updated to
      note only TAF and a pilot-facing tool remain; ICR Phase 1 leftover closed
- [x] CLAUDE.md: new service, types, and utility in the architecture tree,
      v1.17.0 status blurb, tool-list line
- [x] Move this plan set to `docs/plans/` at completion
