# v1.20.0 Pre-Release Review Hardening — Design Plan

**Status:** IMPLEMENTED (2026-08-14) — see [Implementation notes](#implementation-notes)
**Parent:** Pre-release code review + security review of `main...feat/global-fire-weather`
(2026-08-14), covering both v1.20.0 features: global wildfire (NASA FIRMS) and
global fire weather (computed Fosberg FFWI).
**Target release:** v1.20.0 — these are findings *against the release branch*, so
they should land before the tag rather than after.
**Branch (for /impl-plan):** `fix/release-review-hardening` off
`feat/global-fire-weather` (which already carries the wildfire work as an
ancestor). If the release branch merges to `main` first, fork off `main` instead.
**Priority order:** F1 (fabricated safety number) > F2 (coverage regression) >
F3 (false all-clear) > F4 (wrong advice) > F5 (blast radius) > F6 (dateline gap)
> F7 (perf note, may be deferred).

## Security review — no findings

A separate security pass over the same diff returned **no HIGH or MEDIUM
severity vulnerabilities**. Recorded here so it isn't re-run without cause:

- **`FIRMS_MAP_KEY` hygiene (the branch's main new risk) is clean.** The key is
  interpolated into the Area-API URL, and every path that could surface that URL
  was traced: the log line carries only a redacted bbox and `dayRange`; the catch
  extracts `status`/`code` rather than passing the axios error (whose
  `config.url` would carry the key) to the logger; `mapAreaApiError` /
  `mapRegionFileError` return fixed pre-written strings on every branch;
  `FIRMSKeyRejectedError` carries a constant message. The handler's user-facing
  catch prints `error.message`, and everything reachable there was enumerated —
  none contains the key. `tests/unit/firms-service.test.ts:264` asserts the key
  does not leak even when FIRMS echoes it back in a 400 body.
- **No SSRF.** Keyed path: all four bbox corners pass through
  `validateLatitude`/`validateLongitude` (rejecting `NaN`/`Infinity`/out-of-range)
  before reaching the template literal. Keyless path: `regionFile` is a closed
  union of 13 hard-coded literals. Host and scheme are compile-time constants.
- **Remote CSV parsing is safe.** Fields resolve by header name; `confidence`
  and `daynight` are coerced to closed enums *before* being used as object keys,
  so no remote value becomes a dynamic property name (no prototype-pollution
  vector). No `JSON.parse`, no regex built from remote data.
- **No new sinks.** The diff introduces no `eval`, `new Function`,
  `child_process`, filesystem, or deserialization calls.
- The modified `scripts/check-doc-versions.sh` quotes its new `TEST_OUTPUT`
  capture properly and pipes to `grep` on stdin — no injection.

## What / Why

The review cleared the load-bearing claims — the Fosberg transcription matches
the published formulation, the `pickRegionFile` inset boxes were verified
against the real extents of all 12 downloaded regional files (mutually disjoint,
each inside its file's coverage), the Area-API `fetchDays` compensation is
correct, and the US NIFC path body is unchanged. What follows is what it found.

- **F1 (Medium — a safety number invented from missing data):**
  `formatOpenMeteoFireWeather` guards its three index inputs with
  `!== undefined`, which does not catch `null`. Open-Meteo returns `null` for
  absent values (the same HTTP-200-with-nulls behaviour the dryness fields are
  already written to expect), and the type declares `?: number`, so `null` is
  outside the type but reachable at runtime. Under **metric** preferences the
  null survives conversion — `celsiusToFahrenheit(null)` returns `32` and
  `kphToMph(null)` returns `0` — so a null temperature or wind renders a
  fabricated `**🟢 Fosberg Fire Weather Index:** 2 (Low)` instead of the designed
  unavailable note. Under **imperial** the same null passes through unconverted,
  reaches `Number.isFinite`, and correctly renders the note. The behaviour is
  therefore silently unit-dependent. **Independently reproduced** against the
  built dist: metric → `2 (Low)`; imperial → `NaN` → note.
- **F2 (Medium — coverage regression for US territories):**
  `useFirms = countryCode !== 'us'` routes US territories to FIRMS.
  Nominatim's `reverseCountry` returns `pr` for Puerto Rico, but `isInUS`
  carries an explicit Puerto Rico box (`geography.ts:327`), and *before* the
  wildfire PR the handler had no routing at all — every location went to NIFC.
  So a coordinate-only query for San Juan regresses from NIFC named incidents
  (name, acreage, containment, containment-aware safety tiering) to anonymous
  satellite hotspots, for a territory WFIGS does cover. Same for `gu`, `vi`,
  `as`. **Verified:** the Puerto Rico box exists in `isInUS`, and the routing
  line tests `'us'` alone.
- **F3 (Low — affirmative false all-clear on a safety-critical tool):**
  `source: 'nifc'` outside the US falls into the NIFC branch, whose empty-result
  path prints `✅ **No active wildfires found within N km**` plus "The area is
  currently clear of reported wildfire activity." For a user in Athens during an
  active fire that is a green checkmark over a fire, with nothing saying NIFC
  has no coverage there. The FIRMS branch is careful to carry a not-all-clear
  caveat; this override path carries none.
- **F4 (Low — the note now gives wrong advice):** the METAR path's fire-weather
  note still reads "…not available on the METAR source … Use `source: \"noaa\"`
  for a US location." After this release a non-US caller *can* get a Fosberg
  index by dropping `source: "metar"`, but the note points them only at `noaa`,
  which will reject their coordinates. METAR exists for non-US station
  observations, so this misdirects exactly the callers most likely to hit it.
- **F5 (Low — blast radius out of line with precedent):** `include_fire_weather`
  now mutates the `current=` variable list of the primary current-conditions
  request. Open-Meteo returns HTTP 400 on unsupported `current` variables, so if
  either new variable is ever rejected for the model selected at some
  coordinate, the **entire** `get_current_conditions` call fails — where before
  the flag could not break it. Elsewhere the codebase treats this class of
  enrichment as garnish (ACIS, NIFC, composite: catch, omit, note).
- **F6 (Low — antimeridian gap on the keyed path only):** the keyed bbox clamps
  with `Math.max(-180, …)`/`Math.min(180, …)`, truncating rather than wrapping.
  A 500 km query near the dateline (Fiji at 178°E, northern NZ, Chukotka)
  computes `east = 180` instead of `182.7`, silently dropping detections across
  the antimeridian. The keyless path filters the whole region file by haversine
  and finds them — so the same location returns different results depending on
  whether `FIRMS_MAP_KEY` is set.
- **F7 (Low — measured perf note, deferral is reasonable):**
  `clusterDetections` compares each detection against every existing cluster
  centroid — O(n·k), no spatial index. Measured: 5,000 detections (the
  `MAX_RADIUS_DETECTIONS` cap) → 4,790 clusters in **426 ms** of straight-line
  haversine, blocking the event loop, on top of a ~10 MB `Global` download and a
  236 ms parse. Bounded by the cap, so this is a "if the cap ever rises" note.

## Scope

**In:** F1–F6. F7 is recorded but **out of scope** for v1.20.0 unless the
implementation plan finds it trivial — it is bounded by an existing cap and
changing the clustering algorithm this close to a tag buys risk, not safety.

**Out (explicit non-goals):**

- Re-verifying the Fosberg formula, the region-file insets, or the `fetchDays`
  compensation — all three were checked against live data this pass.
- Any change to the US NIFC rendering body or the NOAA fire block — the
  byte-identical guarantees stand and their locked tests must keep passing
  unedited.
- Adding examples that exercise the new features (see Follow-ups).

## Design decisions (settled)

### D1. F1 — null-safe core inputs, matching the dryness pattern

Replace the `!== undefined` guards on `temperature_2m`, `relative_humidity_2m`,
and `wind_speed_10m` with the `!= null` + `Number.isFinite` treatment the
dryness fields already use ten lines below in the same function. The unavailable
note is the designed behaviour for any missing core input; it must not depend on
the caller's unit preference. Widen the `OpenMeteoCurrentWeather` types for these
three fields to `?: number | null` if that is what the runtime actually returns,
so the compiler stops hiding the case.

### D2. F2 — route on the territory set, not the string `'us'`

Treat the `isInUS` territory set as NIFC-eligible rather than testing
`countryCode !== 'us'`. The cleanest expression is a small allowlist of
NIFC-covered country codes (`us`, `pr`, `vi`, `gu`, `as`, `mp`) checked against
the reverse-geocode answer. WFIGS coverage — not political status — is the
criterion; confirm the territory set against what WFIGS actually publishes
before hard-coding it.

### D3. F3 — disclose coverage on the forced-NIFC empty result

When `source: 'nifc'` is forced and the point is outside NIFC coverage, the
empty result must not render as an all-clear. Prefer a coverage disclosure over
an error (the `source` override is deliberate and the rivers/FIRMS doctrine is
no cross-fallback): keep the result, drop the ✅, and state that NIFC covers the
US and its territories only, suggesting `source: "firms"`.

### D4. F4 — correct the METAR note's advice

The note keeps its asserted substring ("Fire weather indices are not available
on the METAR source") so `tests/unit/metar-handler.test.ts` stays meaningful,
but the advice clause changes to point at both routes: `source: "noaa"` for a US
location, or dropping `source` for a computed Fosberg index elsewhere. The test's
asserted substring will need its expectation updated — that is expected here, not
a locked file.

### D5. F5 — make the fire variables best-effort

Bring the fire-weather fetch in line with the garnish precedent. Preferred: on a
400 from a request carrying the two extra variables, retry once without them and
render the section's unavailable note (or omit the section) rather than failing
the whole call. A separate best-effort second request is the fallback design if
the retry proves awkward; do **not** issue a second request on the happy path.

### D6. F6 — two bbox queries across the antimeridian

When the computed span crosses ±180, issue two bbox queries (east slice and west
slice) and merge before clustering, so the keyed and keyless paths agree. Pole
clamping stays as-is (latitude genuinely ends at ±90).

## Edge cases

| Case | Expected behaviour |
|------|--------------------|
| Null `temperature_2m`, metric prefs | Unavailable note — **not** an index (F1) |
| Null `temperature_2m`, imperial prefs | Unavailable note (unchanged) |
| All three core inputs present, dryness null | Index renders, dryness omitted (unchanged) |
| San Juan PR, coordinate-only | NIFC named incidents (F2) |
| Athens, `source: 'nifc'`, no fires | Coverage disclosure, no ✅ all-clear (F3) |
| Non-US, `source: 'metar'`, `include_fire_weather` | Note names both routes (F4) |
| Open-Meteo 400 on a fire variable | Conditions still render; fire section degrades (F5) |
| Fiji 178°E, 500 km, key set | Same detections as the keyless path (F6) |

## Testing

- **Unit:** null-input matrix for `formatOpenMeteoFireWeather` across both unit
  systems (F1 — this is the gap that let it through: the existing tests cover
  `undefined`, never `null`); territory routing for `pr`/`vi`/`gu`/`as` (F2);
  forced-NIFC-outside-coverage rendering (F3); the corrected METAR note (F4);
  the 400-retry path (F5); antimeridian bbox splitting (F6).
- **Locked unedited:** `tests/unit/fireWeatherContext.test.ts`,
  `tests/unit/wildfire-handler.test.ts`, and the NOAA-path fire rendering tests
  — the US byte-identical guarantees.
- **Expected to change:** `tests/unit/metar-handler.test.ts`'s asserted advice
  substring (D4 only — the leading clause stays).
- **Full gate** after every task: `npm run build`, `npm test`, `npm audit`.
  Several `tests/integration/` files make live calls and flake independently —
  re-run before suspecting the diff.

## Documentation / registration checklist (for /run-plan tracking)

- [x] `src/handlers/currentConditionsHandler.ts` — D1 null guards, D4 note
- [x] `src/types/openmeteo.ts` — D1 nullable core fields
- [x] `src/handlers/wildfireHandler.ts` — D2 territory routing, D3 disclosure, D6 bbox split
- [x] `src/services/openmeteo.ts` — D5 best-effort fire variables
- [x] Tests per §Testing
- [x] CHANGELOG under `[Unreleased]` (rides v1.20.0 — these are pre-tag fixes,
      so they fold into the existing entries rather than announcing themselves)
- [x] Move this doc to `docs/plans/` at completion

## Implementation notes

Executed on `fix/release-review-hardening` off `feat/global-fire-weather`
(2026-08-14), one commit per finding:

| Finding | Commit | Notes |
|---------|--------|-------|
| F1 / D1 | `65f962a` | Widening the three `OpenMeteoCurrentWeather` fields to `?: number \| null` compile-forced `!= null` guards at the main formatter's temperature/humidity/wind display lines too — a null now omits its line instead of rendering a converted zero. Necessary mechanical consequence, taken deliberately. |
| F5 / D5 | `9180be0` | The retry lives in a private `fetchCurrentConditions` helper shared by the cached and uncached branches. Only `InvalidLocationError` (the 400 mapping) triggers it; `validateCurrentResponse` throws `DataNotFoundError`, so a validation failure never retries. |
| F4 / D4 | `40e60fc` | A3 held: `tests/unit/metar-handler.test.ts` asserts only the surviving leading clause, so the change was additive — three assertions appended, none rewritten. |
| F2 / D2 | `456a6a6` | **Territory set is evidence-gated (A5).** Verified live against the WFIGS ArcGIS all-years layers (`WFIGS_Interagency_Perimeters`, `WFIGS_Incident_Locations`): distinct `POOState` carries `US-GU` (90 perimeters), `US-VI` (5), `US-PR` (4); `US-AS` and `US-MP` return **zero** rows in either layer. The design's nominal `us, pr, vi, gu, as, mp` therefore ships as **`us, pr, vi, gu`** — American Samoa and the Northern Marianas route to FIRMS, which is the honest answer where WFIGS publishes nothing. |
| F3 / D3 | `ddf713f` | Country resolution extracted to a `resolveCountryCode` helper; the forced-`nifc` branch now resolves too (A4). One pre-existing `wildfire-routing.test.ts` case asserted the old all-clear and no lookup — precisely the behaviour D3 changes — and was updated. `wildfire-handler.test.ts` passed unedited. |
| F6 / D6 | `5d81446` | Longitude is sliced rather than clamped; latitude clamps stay. Slices awaited sequentially and concatenated before the existing rolling-window and radius filters. |

**Locked files held:** `tests/unit/fireWeatherContext.test.ts` and
`tests/unit/wildfire-handler.test.ts` are absent from the branch diff
(`git diff feat/global-fire-weather...HEAD --stat`).

### Edge-case sweep (2026-08-14, against the built dist)

All eight rows of the edge-case table pass:

| # | Case | Result |
|---|------|--------|
| 1 | Null `temperature_2m`, metric prefs | Unavailable note, no index, no `NaN` — the reproduced F1 case, now fixed |
| 2 | Null `temperature_2m`, imperial prefs | Unavailable note (unchanged) |
| 3 | Core inputs present, dryness null | Index renders, dryness omitted |
| 4 | San Juan PR, coordinate-only | NIFC path, FIRMS never touched |
| 5 | Athens + `source: 'nifc'`, empty | Coverage disclosure, no ✅, no "currently clear", `source: "firms"` suggested, no cross-fallback |
| 6 | Non-US + `source: 'metar'` + `include_fire_weather` | Note names both routes |
| 7 | Degraded (retried) fire-variable response | Conditions render in full; index renders, dryness omitted (A2) |
| 8 | Fiji 178°E, 500 km, keyed | Two slices `[173.27, 180]` / `[-180, -177.27]`, both corners valid, detections merged |

Row 8 was checked both mocked (both-slice merge, in the unit tests) **and
live** with `FIRMS_MAP_KEY` set: the handler issued exactly the two slices
above, the keyed and keyless paths agreed on the 83 in-radius western
detections, and the eastern slice happened to be empty at Fiji that day — so
the live run proves the split is issued and merged correctly, while the mocked
test covers the recovered-detection case. (Incidental observation, not acted
on: for that bbox the keyless 24 h `Global` file and a keyed `day_range` 2
fetch both returned 83 rows, of which 23 fell inside the rolling 24 h window.
The `fetchDays` compensation was a declared non-goal, already verified live
this review pass.)

### Live MCP verification (2026-08-14, over the real protocol)

Run after restarting the MCP servers against the rebuilt `dist/` — all four
weather server configs point at the same `dist/index.js`, and `FIRMS_MAP_KEY`
loaded from `.env` (confirmed by a `day_range: 3` Athens query being honored
with no keyless-upgrade note), so the keyed FIRMS path was genuinely exercised.

**New features**

| Case | Result |
|------|--------|
| Athens, coords only | FIRMS — 3 detections / 3 clusters, disclosure header, per-cluster distance + bearing, peak FRP, age, confidence, satellite |
| Sacramento, 300 km | NIFC — 13 named incidents with acreage/containment, cap-5 + remainder note; tier correctly **AWARENESS** (the 96 %-contained CHUTE did not drive it) |
| Sacramento + `source: "firms"` | FIRMS in the US — 9 detections / 5 clusters |
| Reykjavík (no fires) | Not-all-clear caveat, no ✅ |
| Athens, `include_fire_weather` | Fosberg **11 (Low)**, dryness context (VPD 2.0 kPa, topsoil 0.07 m³/m³), derivation disclosure |
| Denver, `include_fire_weather` | NOAA published indices (seasonal risk, mixing height, transport wind) — US path unchanged |
| Sydney, `include_fire_weather` | Fosberg **3 (Low)** at 50 °F / 92 % RH — southern-hemisphere winter read from actual conditions, no northern seasonality wording |

**Fixes exercised live**

- **F2** — San Juan PR, coordinate-only → NIFC (WFIGS footer, no FIRMS source
  line). The ✅ is correct here: PR is *inside* coverage and genuinely clear.
- **F3** — Athens + `source: "nifc"` → no ✅, no "currently clear", explicit
  coverage statement, `source: "firms"` suggested, no cross-fallback.
- **F4** — Paris + `source: "metar"` + `include_fire_weather` → the note names
  both routes.
- **F6** — Fiji 178°E / 500 km keyed → 23 detections / 16 clusters, matching the
  standalone driver exactly. The eastern slice was legitimately empty that day;
  the driver separately confirmed both slices are issued at `[173.27, 180]` and
  `[-180, -177.27]`.

**F1's strongest live evidence is indirect but decisive:** Athens returned the
**same index — 11 (Low)** — on the imperial and metric servers, with identical
dryness values, while displayed temperature and wind differed (77 °F / 5 mph vs
25 °C / 8 km/h). The bug class F1 describes is a safety number that changes with
the caller's unit preference; that is now demonstrably gone. It is *not* the
null path itself, which stays covered by the 6-cell unit matrix and sweep rows
1–2.

**Not live-triggerable, by nature:** F1's null path (needs Open-Meteo to return
`null` for a core input) and F5's retry (needs a 400 on a fire variable).
Neither can be provoked on demand against the live API; both rest on unit tests
plus the dist sweep.

**Regressions checked, all clean:** US alerts (NOAA), Canada alerts (Toronto →
ECCC, so the reverse-geocode answer still beats `isInUS`), non-US
`get_weather_summary` (current + forecast + Greek MeteoAlarm warnings), US
current conditions without the flag, and `composite: true` radar (image block
returned, correctly centered on the marker).

**Unrelated cosmetic observation, not from this branch:** the Paris METAR
station renders as `Paris/De Gaulle Arpt, ID, FR` — the `, ID,` comes from the
upstream AWC `name` field, passed through verbatim since v1.17. Recorded here
so it isn't mistaken for release fallout; not a tag blocker.

## Follow-ups (not tasked here)

- **`examples/` does not exercise either new feature.** The capture manifest was
  regenerated (`5fa1058`) so the output is current, but no scenario passes
  `include_fire_weather` for a non-US point or hits a FIRMS-routed location, so
  neither v1.20.0 feature appears in the examples folder. Adding scenarios means
  editing the manifest plus writing the conversational layer — a content task,
  worth doing but not a review finding.
- **F7** (clustering without a spatial index) — see above.
