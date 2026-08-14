# Global Fire Weather Indices — Design Plan

**Status:** DESIGN — settled, ready for `/impl-plan`
**Parent:** `docs/planning/INTERNATIONAL_COVERAGE_ROADMAP.md` (Phase 5, item 3)
**Target release:** rides the next release alongside global wildfire (v1.20.0 line; version settled at release time)
**Branch (for /impl-plan):** `feat/global-fire-weather` — create off `feat/global-wildfire` if it has not merged yet (this feature's docs touch CLAUDE.md lines that branch rewrote), off `main` otherwise
**Upstream verification:** live-tested 2026-08-13 (ICR §Live verification notes) and re-verified 2026-08-14 — Milan, Sydney, and Reykjavik all return complete, non-null `current` values for `temperature_2m`, `relative_humidity_2m`, `wind_speed_10m`, `wind_gusts_10m`, `soil_moisture_0_to_1cm` (m³/m³), and `vapour_pressure_deficit` (kPa) on the forecast endpoint `getCurrentConditions` already calls.

## What / Why

`include_fire_weather` on `get_current_conditions` is US-only. The non-US
(Open-Meteo) path renders a two-line stub — `Fire weather indices are
currently available for US locations only.` — at
`src/handlers/currentConditionsHandler.ts:766-769`, and makes no attempt to
compute anything. With v1.20.0 making `get_wildfire_info` global, fire
*weather* is the remaining US-only piece of the fire-safety story.

**Corrected premise (found during design exploration).** The roadmap said
"run the existing `fireWeather.ts` formulas off Open-Meteo hourly variables."
There are no formulas: `src/utils/fireWeather.ts` is a pure
*interpretation* layer over five series NOAA pre-computes on the gridpoint
API (`hainesIndex`, `grasslandFireDangerIndex`, `redFlagThreatIndex`,
`mixingHeight`, `transportWindSpeed`). Nothing in the codebase computes a
fire-weather index today. The global path therefore **computes one
in-house**: the **Fosberg Fire Weather Index (FFWI)** — the standard
surface-inputs index (temperature °F, relative humidity %, sustained wind
mph), all three inputs verified present and non-null globally. The numbers
are *derived by this server from model data*, a materially different claim
from the NOAA path's agency-published indices — the output framing (D6)
carries that distinction, the same way rivers distinguish gauge vs. model
and current conditions distinguish station vs. model.

## Scope

**In:** FFWI computed on the Open-Meteo current-conditions path (non-US via
`auto`, anywhere via explicit `source: "openmeteo"` — the FIRMS/rivers
precedent: the model path works in the US too), plus dryness context
(soil moisture, vapour-pressure deficit) as secondary lines.

**Out (explicit non-goals, recorded here so /impl-plan doesn't relitigate):**

- **Haines index globally** — needs 850/700 hPa temperature and dewpoint
  depression. Open-Meteo does expose pressure-level variables, so this is
  *possible* later, but it adds a second request shape and a
  verification burden for one index; descope to a future idea.
- **METAR-path Fosberg** — a METAR carries temp/dewpoint/wind, enough for
  FFWI. Deliberately deferred: one render path per release (project
  precedent), and the existing METAR note's asserted-in-tests substring
  (`'Fire weather indices are not available on the METAR source'`,
  `tests/unit/metar-handler.test.ts:603-621`) stays untouched this release.
- **US NOAA path** — byte-for-byte unchanged. `getFireWeatherContext`'s
  US-hardcoded geography boxes (`fireWeather.ts:213-216`) and
  northern-hemisphere seasonality (`:232`) are **not** touched or
  generalized — the global path never calls it (D5), so its US-locked tests
  (`tests/unit/fireWeatherContext.test.ts`) pass unedited.
- **Forecast/hourly fire weather** — current conditions only, like the NOAA
  path today.

## Design decisions (settled)

### D1. Routing — no new routing at all

The handler already routes; the change is confined to what
`formatOpenMeteoCurrentConditions` renders when `include_fire_weather` is
true. No new `source` values, no schema shape change beyond the
`include_fire_weather` description losing "US only". Default
(`include_fire_weather: false`) output is byte-identical on every path.

### D2. The Fosberg computation — pure module addition

New pure functions appended to `src/utils/fireWeather.ts` (the file is
already pure with zero imports; keep it that way):

- `calculateFosbergIndex(tempF: number, rhPercent: number, windMph: number): number`
  — the standard FFWI: equilibrium moisture content (EMC) from the
  three-branch RH piecewise (RH < 10 / 10–50 / > 50), moisture damping
  coefficient `η = 1 − 2(m/30) + 1.5(m/30)² − 0.5(m/30)³` (clamped ≥ 0),
  `FFWI = η · √(1 + U²) / 0.3002`, clamped to 0–100. Reference: Fosberg
  (1978), as implemented in NWS/WFAS documentation — cite in the module
  doc comment; the implementation plan should verify a few hand-computed
  vectors against a published table.
- `getFosbergCategory(ffwi: number): { level, description, color }` — same
  shape as the existing category functions. Bands (a project choice —
  published FFWI usage treats ≥ 50 as significant fire weather; disclose as
  heuristic in the doc comment): `< 25` Low/Green, `25–39` Moderate/Yellow,
  `40–49` High/Orange, `≥ 50` Extreme/Red.
- Dryness-context banding, also pure and disclosed as heuristic:
  `describeVpd(kPa)` (`< 1` low drying power, `1–2` moderate, `2–3` high,
  `> 3` extreme) and `describeTopsoilMoisture(m3m3)` (`< 0.1` very dry,
  `0.1–0.2` dry, `0.2–0.3` moist, `> 0.3` wet).

Guard rails: any non-finite input → the caller omits the index and renders
the unavailable note (never NaN in output). High RH / low wind legitimately
computes ~0 → renders as Low, which is correct, not a failure.

### D3. Data supply — two extra request variables, fire-flag-keyed cache

`OpenMeteoService.getCurrentConditions` already fetches temp, RH, wind, and
gusts. Extend `buildCurrentParams` (`src/services/openmeteo.ts:717`) with an
optional `includeFireWeather` flag that appends
`soil_moisture_0_to_1cm,vapour_pressure_deficit` to the `current=` list —
**only when requested**, so every existing call's request URL is unchanged.
The two new variables are not affected by `openMeteoUnitParams` (always
m³/m³ and kPa). The cache key (`openmeteo-current`, `:693-702`) must
incorporate the flag so a cached non-fire response is never served to a
fire-weather request. Types: extend `OpenMeteoCurrentWeather`
(`src/types/openmeteo.ts:273-291`) with the two optional fields.

### D4. Unit normalization — the verified gotcha

The request carries `openMeteoUnitParams(prefs)`, so returned temperature
and wind arrive **in the caller's preferred units** (°F/°C, mph/kmh/ms/kn).
FFWI needs fixed °F and mph. Normalize *back* from prefs before computing —
a small pure helper in the handler (or alongside D2) that switches on
`prefs.temperatureUnit`/`prefs.windSpeedUnit` and uses the existing
converters in `src/utils/units.ts` (`celsiusToFahrenheit:20`,
`kphToMph:34`, `mpsToMph:27`; knots→mph is the one missing scalar —
add `knotsToMph` with the standard 1.15078 factor, unit-tested). Do **not**
issue a second fixed-unit fetch. Sustained wind (`wind_speed_10m`) feeds
the index; gusts are display context only.

### D5. Rendering — replace the stub, never call `getFireWeatherContext`

The stub at `currentConditionsHandler.ts:766-769` becomes (structure
mirrors the NOAA fire block's emoji/level conventions, `:517-583`):

```
## Fire Weather

**🟠 Fosberg Fire Weather Index:** 47 (High)
Computed from current temperature, humidity, and sustained wind. Higher
values mean faster potential fire spread in fine fuels.

**Dryness context:**
- **Vapour-pressure deficit:** 3.7 kPa (extreme drying power)
- **Topsoil moisture (top 1 cm):** 0.18 m³/m³ (dry)

*Derived by this server from Open-Meteo model data — not an official
fire-danger rating. Heed warnings from your national fire authority.*
```

- Index inputs echo in the caller's preferred units elsewhere in the
  output already (temp/wind lines) — don't repeat them in this section.
- Either dryness line whose value is null (open ocean behaves like the
  Flood-API precedent: HTTP 200, null fields) is omitted; both null →
  omit the whole `**Dryness context:**` block. The index itself still
  renders (its three inputs are never null in practice; if any is, render
  `⚠️ Fire weather inputs unavailable for this location.`).
- `getFireWeatherContext` (US geography boxes, northern-hemisphere
  seasons) is never called on this path — no seasonal-risk guessing; the
  index reflects actual current conditions, hemisphere-proof by
  construction.
- Existing Open-Meteo footer/attribution on the path is unchanged; the
  derivation disclosure lives in the section itself (shown above).

### D6. Honest framing

The section must never read as an agency product. Three claims, stated
in-output (D5): what it is (a computed index), what it's computed from
(current model values), and what it is not (an official rating —
deference to national authorities). This mirrors the FIRMS
hotspots-not-incidents framing and the GloFAS model-not-gauge framing.

### D7. Schema, descriptions, docs

- `src/index.ts:356-359`: `include_fire_weather` description drops
  "US only" → "US locations get NOAA fire-weather indices (Haines,
  grassland, red-flag); elsewhere a computed Fosberg Fire Weather Index
  with dryness context."
- Tool description (`src/index.ts:351`) updated to match.
- CLAUDE.md: the two "fire weather indices are US-only" statements
  (~lines 90 and 579) and the v1.20.0 status blurb; note the METAR-path
  note is unchanged.
- README.md feature/limitations tables; `docs/TOOLS.md` current-conditions
  section; CHANGELOG.md under `[Unreleased]`.
- `docs/planning/README.md`: flip the "Global fire weather indices" row
  💡 → ✅ at completion; ICR Phase 5 item 3 marked shipped; record the
  descoped ideas (global Haines via pressure levels, METAR-path Fosberg)
  as 💡 rows so they aren't lost.

## Edge cases

| Case | Behavior |
|------|----------|
| `include_fire_weather` absent/false | Byte-identical output on all paths (locked by existing tests) |
| US point, `auto` | NOAA path, byte-identical (existing fire block untouched) |
| US point, explicit `source: "openmeteo"` | Fosberg section renders (model path works anywhere — rivers/FIRMS precedent) |
| METAR source | Existing "not available on the METAR source" note, byte-identical |
| Open ocean / null soil-moisture or VPD | Null dryness lines omitted; index still computed |
| Any core input (temp/RH/wind) missing | `⚠️ Fire weather inputs unavailable for this location.` — no NaN, no throw |
| Metric / knots / m·s⁻¹ unit prefs | Index identical regardless of prefs (normalization is pure and unit-tested) |
| Cold/wet conditions (Reykjavik live probe: 16.6 °C, 59 % RH) | Low FFWI renders as Low — correct, not suppressed |

## Testing

- **Unit (`tests/unit/fireWeather.test.ts` — append, never edit existing):**
  `calculateFosbergIndex` against hand-verified vectors from the published
  formula (include one per EMC branch: RH < 10, 10–50, > 50); clamping at
  0 and 100; η floor at high EMC; band boundaries of `getFosbergCategory`
  at 24/25, 39/40, 49/50; `describeVpd`/`describeTopsoilMoisture` bands;
  non-finite inputs.
- **Unit (units):** `knotsToMph`; prefs→fixed-unit normalization round
  trips for all four wind units and both temperature units.
- **Unit (handler):** replace the test at
  `tests/unit/current-conditions-global.test.ts:475-492` (it asserts the
  US-only stub verbatim) with: non-US + `include_fire_weather` renders the
  Fosberg section **and still makes no NOAA gridpoint call**
  (`getGridpointDataByCoordinates` not called — keep that assertion);
  null-dryness omission; unavailable-note path.
- **Locked unedited:** `tests/unit/fireWeatherContext.test.ts`,
  `tests/unit/metar-handler.test.ts`, all NOAA-path fire-weather rendering
  tests — these are the byte-identical guarantees.
- **Integration:** mocked Open-Meteo response with the two new variables;
  one live smoke test tolerant of network flake (project convention).
- **Byte-identical verification (release gate):** diff built-dist output
  against the branch base for (a) a default no-flag request, (b) a US
  `include_fire_weather` request — both must be identical.

## Documentation / registration checklist (for /run-plan tracking)

- [ ] `src/utils/fireWeather.ts` — D2 pure functions + doc comments citing Fosberg (1978)
- [ ] `src/utils/units.ts` — `knotsToMph`
- [ ] `src/services/openmeteo.ts` + `src/types/openmeteo.ts` — D3 flag, variables, cache key
- [ ] `src/handlers/currentConditionsHandler.ts` — D4 normalization + D5 rendering
- [ ] `src/index.ts` — D7 schema/description
- [ ] Tests per §Testing
- [ ] README.md, CHANGELOG.md, CLAUDE.md, `docs/TOOLS.md`
- [ ] `docs/planning/README.md` + ICR — status flips and descoped-idea rows
- [ ] Move this doc to `docs/plans/` at completion (project convention)
