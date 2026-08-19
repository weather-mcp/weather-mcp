# Heat/Cold Stress Indices (WBGT + Frostbite Time-to-Onset) — Design Plan

**Status:** IMPLEMENTED (2026-08-18) — shipped on `feat/heat-cold-stress` for the v1.24.0 line
**Parent:** `docs/planning/FUTURE_ENHANCEMENTS.md` §6.2; planning-index row "Heat/cold stress extras (WBGT, frostbite time-to-onset)"
**Target release:** next minor (v1.24.0 line; version settled at release time)
**Branch (for /impl-plan):** `feat/heat-cold-stress` off `main`
**Upstream verification:** live-probed 2026-08-18 — no new API variables are requested anywhere in this design, so verification is that the already-fetched inputs are non-null in the extreme conditions that trigger the new lines. Vostok Station (−78.45, 106.87; southern-winter probe) returned `temperature_2m: −70.3 °F`, `relative_humidity_2m: 61 %`, `wind_speed_10m: 19.6 mph` — computed wind chill ≈ −114 °F, squarely in the most severe frostbite band. Ushuaia returned complete values at a milder point. This complements the 2026-08-14 global fire-weather verification of the same three fields (Milan/Sydney/Reykjavik).

## What / Why

`get_current_conditions` already shows *how it feels* — `Feels Like (Heat
Index)` / `(Wind Chill)` on the NOAA path, `Feels Like`
(apparent temperature) on the Open-Meteo path — but never *what that means
for the body*. A wind chill of −40 °F and one of −5 °F render identically
in form, yet one freezes exposed skin in minutes. FE §6.2 catalogues the
gap: frostbite time-to-onset and a heat-stress index (WBGT), both
computable from temperature/humidity/wind the handler already has in hand.

This is the Fosberg pattern again (v1.20.0), in its purest form: a pure
computation module, disclosed heuristic bands, honest derived-not-official
framing — except this time there are **zero service changes, zero new
request variables, and zero cache-key changes**. Every input is already
fetched on every path. The entire diff is one new pure util module, handler
rendering, config thresholds, and docs.

**Two claims, one feature:**

- **Cold:** a computed North American Wind Chill Index banded into
  time-to-frostbite categories ("exposed skin can freeze in 10–30
  minutes"). Safety-critical, actionable, and the reason this idea was
  picked up.
- **Heat:** an estimated WBGT (wet-bulb globe temperature) via the
  simplified Australian Bureau of Meteorology formula, banded into
  exertion-risk categories. The complement on the hot side; heat index
  alone understates humid-heat risk for outdoor exertion.

## Scope

**In:** Automatic output enhancement on `get_current_conditions` —
**NOAA and Open-Meteo paths** (and therefore the `current` section of
`get_weather_summary`, which renders through the same formatters). No new
parameter, no new tool, no schema shape change. Lines render **only when
thresholds are crossed**, so moderate-weather output is byte-identical.

**Out (explicit non-goals, recorded so /impl-plan doesn't relitigate):**

- **METAR path** — a METAR carries temp/dewpoint/wind, enough for both
  indices, but the project ships one render path per release (the
  Fosberg-on-METAR precedent, still standing). Record as a 💡 row —
  natural companion to the deferred METAR-path Fosberg if a "computed
  indices on METAR" release ever happens.
- **Forecast-path thermal stress** (per-day WBGT / frostbite on
  `get_forecast`) — current conditions only, exactly like fire weather.
  Record as 💡 if wanted later.
- **Full Liljegren WBGT** — the gold-standard outdoor WBGT model needs
  solar radiation, wind, and an iterative solve. The simplified ABM
  estimate is the right cost/benefit for a disclosed heuristic; revisit
  only with user demand for occupational-grade numbers.
- **Mold spores / other FE §6 items** — not part of this row.
- **New tool** — rejected by principle 1 (parameters over proliferation,
  and automatic enhancement over parameters).

## Design decisions (settled)

### D1. Shape — automatic, gated, no schema change

Design principle 1 prefers automatic output enhancement over a parameter,
and these lines are the textbook case: one to two lines, only in dangerous
conditions, zero token cost otherwise. No `include_*` flag. The
`get_current_conditions` schema is untouched; the tool description gains a
half-sentence ("includes frostbite risk and heat-stress (WBGT) context in
extreme conditions").

**Byte-identity story:** the existing unit-test fixtures all sit at
moderate temperatures (45–64 °F, verified 2026-08-18 across
`current-conditions-global.test.ts` and `openmeteo-current.test.ts`), so
neither gate fires and every existing test passes unedited — that *is* the
lock. Default output changes only where conditions are genuinely
dangerous, which is the point of the feature (v1.13.0 output-completeness
precedent for changing default output; the byte-identical discipline
applies to the moderate case, verified in §Testing).

### D2. The computations — new pure module `src/utils/thermalStress.ts`

New file, **pure with zero imports** (the `fireWeather.ts` /
`modelComparison.ts` discipline). Four functions:

- `calculateWindChillF(tempF: number, windMph: number): number | null` —
  the North American Wind Chill Index (NWS/Environment Canada joint 2001
  model, Osczevski & Bluestein):
  `WC = 35.74 + 0.6215·T − 35.75·V^0.16 + 0.4275·T·V^0.16` (T °F, V mph).
  Validity domain: `T ≤ 50 °F` and `V ≥ 3 mph` → outside it, or on any
  non-finite input, return `null`. Cite the formula in the doc comment;
  the implementation plan verifies hand-computed vectors against the
  published NWS chart (e.g., 5 °F @ 30 mph → −19 °F).
- `getFrostbiteRisk(windChillF: number): { level, timeToFrostbite, description } | null` —
  bands adapted from Environment Canada's wind chill program (published in
  °C; °F equivalents used here), disclosed as a project heuristic in the
  doc comment. `windChillF > −18` → `null` (no line — frostbite from cold
  air alone is not a near-term risk above this):
  | Wind chill (°F) | `timeToFrostbite` | level |
  |---|---|---|
  | ≤ −18 to > −40 | "10–30 minutes" | High |
  | ≤ −40 to > −54 | "5–10 minutes" | Very High |
  | ≤ −54 to > −67 | "2–5 minutes" | Severe |
  | ≤ −67 | "under 2 minutes" | Extreme |
- `calculateSimplifiedWbgtF(tempF: number, rhPercent: number): number | null` —
  the ABM simplified WBGT: convert to °C, water-vapour pressure
  `e = (rh/100) · 6.105 · exp(17.27·T / (237.7 + T))` (hPa),
  `WBGT(°C) = 0.567·T + 0.393·e + 3.94`, convert back to °F. `null` on
  non-finite input. Doc comment must state the model's own published
  assumption: moderately high radiation and light wind — i.e., a
  full-sun outdoor estimate that can overestimate in shade/overcast.
- `getWbgtCategory(wbgtF: number): { level, description } | null` — bands
  aligned with the widely used flag-condition categories, disclosed as a
  project heuristic (regional acclimatization genuinely shifts these;
  say so in the rendered caveat, D5). `wbgtF < 80` → `null`:
  80–84 Elevated · 85–87 High · 88–89 Very High · ≥ 90 Extreme.

Category functions are called with the **rounded** display value, so the
shown number and its band never disagree at an edge (the v1.20.0
fire-weather lesson, recorded in its implementation notes).

### D3. Input normalization — reuse, don't invent

FFWI's D4 already solved this problem and left the tools in place:

- **Open-Meteo path:** values arrive in the caller's preferred units;
  normalize with the existing pure helpers
  `prefsTempToFahrenheit` / `prefsWindToMph`
  (`src/handlers/currentConditionsHandler.ts:657-662`). RH is unitless.
- **NOAA path:** QuantitativeValues; `convertToFahrenheit`
  (`src/utils/temperatureConversion.ts:14`) for temperatures, and the
  handler's existing inline km/h / m·s⁻¹ → mph conversion pattern for
  wind (`currentConditionsHandler.ts:400-404`).

No second fetch, no request change, no cache change — the indices are
identical regardless of unit preferences (unit-tested, as with Fosberg).

### D4. Which wind chill number drives the frostbite band

The number in the frostbite line must be the number the band was computed
from, and it must be *a wind chill*, not Open-Meteo's
`apparent_temperature` (Steadman apparent temperature includes radiation
and uses a different model — never band off it):

- **NOAA path:** when the station publishes `windChill`, use its °F
  conversion as the effective wind chill (it is the number already shown
  in `Feels Like (Wind Chill)` — the risk statement must match the
  displayed value). When absent but temp + wind are present, compute via
  D2.
- **Open-Meteo path:** always compute via D2 from `temperature_2m` +
  `wind_speed_10m` (normalized). The computed wind chill is **echoed in
  the frostbite line itself** (converted to the caller's unit), so the
  band's basis is always visible even though the `Feels Like` line above
  it shows apparent temperature.
- **Calm-air carve-out:** below the formula's 3 mph validity floor, use
  the air temperature itself as the effective value — −50 °F air freezes
  skin regardless of wind, and returning `null` there would suppress the
  warning exactly when it matters. (`calculateWindChillF` still returns
  `null` below 3 mph; the *handler* substitutes air temp — keeps the pure
  function faithful to the published formula's domain.)

### D5. Rendering

Both lines sit **directly after the temperature/feels-like block** on
their respective paths (safety context adjacent to the number it
qualifies), before the 24-hour/today's range line.

Cold (gate: effective wind chill ≤ −18 °F):

```
**Temperature:** -21°F
**Feels Like (Wind Chill):** -47°F
🥶 **Frostbite risk (Very High):** exposed skin can freeze in 5–10 minutes at this wind chill. Cover all skin and limit time outdoors.
```

On the Open-Meteo path the line carries its own number:
`🥶 **Frostbite risk (Very High):** wind chill −47°F — exposed skin can freeze in 5–10 minutes. …`

Heat (gate: air temp ≥ 80 °F **and** rounded WBGT ≥ 80 °F):

```
**Temperature:** 96°F
**Feels Like (Heat Index):** 108°F
🥵 **Heat stress (Extreme):** estimated WBGT 90°F — outdoor exertion is dangerous; rest often, hydrate, seek shade. *Estimated from temperature and humidity assuming full sun; thresholds vary with acclimatization.*
```

- Displayed temperatures render in the caller's preferred unit
  (`temperatureLabel`); bands are computed on the fixed-°F values.
- One line each, mutually exclusive by construction (their gates cannot
  both fire). Missing RH → no WBGT line; missing wind → calm-air
  carve-out (D4) or, above −18 °F effective, no frostbite line. Never a
  `⚠️ unavailable` note — absence of a *bonus* line needs no
  announcement (garnish, not contract).
- The italic caveat on the heat line is mandatory (the Fosberg
  derived-not-official discipline): the estimate's full-sun assumption
  and the acclimatization variance are the two ways this number can
  mislead, so both are stated where the number is.
- Frostbite copy states the claim's own scope: *exposed* skin. Times are
  for the most susceptible fraction of the population per the EC
  program — the conservative direction is correct for a safety line.

### D6. Gating thresholds live in config

`src/config/displayThresholds.ts` gains:

```typescript
thermalStress: {
  /** Render the frostbite line when effective wind chill (°F) is at or below this */
  showFrostbiteAtWindChillF: -18,
  /** Compute/render WBGT only when air temp (°F) is at or above showHeatIndex and rounded WBGT (°F) is at or above this */
  showWbgtF: 80,
},
```

Band boundaries themselves live in the pure module (where Fosberg's live);
these config values are display gates, consistent with the file's existing
role. The WBGT computation is additionally gated on
`DisplayThresholds.temperature.showHeatIndex` (80 °F) so no work happens
on the cold side of the year.

### D7. Honest framing

Three disclosed truths, all in-output (D5) or in doc comments (D2):

1. Both numbers are **computed by this server**, not observed or
   agency-published.
2. The WBGT is an **estimate with a stated bias** (full-sun assumption;
   acclimatization-dependent thresholds).
3. The frostbite bands are adapted from Environment Canada's published
   categories — a heuristic banding of a real model, same epistemic
   status as the Fosberg/VPD/spread bands already shipped.

### D8. Schema, descriptions, docs

- `src/index.ts` — `get_current_conditions` tool description gains the
  half-sentence from D1. **No inputSchema change.**
- CLAUDE.md — feature list line for `get_current_conditions`; status
  blurb at release time.
- README.md features table; `docs/TOOLS.md` current-conditions section
  (document both gates and both formulas' provenance).
- CHANGELOG.md under `[Unreleased]`.
- `docs/planning/README.md` — flip the "Heat/cold stress extras" row
  📝 → ✅ at completion; add 💡 rows for the two descoped follow-ups
  (METAR-path thermal stress; forecast-path thermal stress). FE §6.2 gets
  a resolution banner (the §6.1 pollen pattern).

## Edge cases

| Case | Behavior |
|------|----------|
| Moderate conditions (all existing fixtures) | No new lines; output byte-identical; existing tests pass unedited |
| Vostok live probe (−70.3 °F, 19.6 mph → WCI ≈ −114 °F) | Frostbite line, "under 2 minutes" band |
| Extreme cold, calm air (< 3 mph) | Effective value = air temp (D4 carve-out); line renders when ≤ −18 °F |
| Cold but wind chill > −18 °F | No line — `Feels Like (Wind Chill)` alone, as today |
| NOAA station publishes `windChill` | That value drives band and display (no computed/displayed divergence) |
| NOAA `windChill` absent, temp+wind present | Computed WCI drives the line |
| Hot but dry (WBGT rounds < 80 °F) | No line — heat index alone, as today |
| Temp ≥ 80 °F, RH missing | No WBGT line, no note (garnish) |
| Metric / kmh / kn / m·s⁻¹ preferences | Bands identical (fixed-°F computation); displayed values in caller's unit |
| Boundary values (−18, −40, −54, −67, 80, 85, 88, 90 °F) | Band computed on rounded value; edges unit-tested on both sides |
| `get_weather_summary` | Lines ride the current section automatically (same formatters) |
| METAR source | Byte-identical (out of scope; `metar-handler.test.ts` stays unedited as the lock) |
| Non-finite / null inputs | Pure functions return `null`; line omitted; never NaN in output |

## Testing

- **Unit (`tests/unit/thermalStress.test.ts`, new):**
  `calculateWindChillF` against hand-verified NWS-chart vectors (≥ 3,
  spanning the chart); domain nulls (T > 50 °F, V < 3 mph, non-finite).
  `getFrostbiteRisk` band edges both sides of −18/−40/−54/−67.
  `calculateSimplifiedWbgtF` against hand-computed ABM vectors (e.g.,
  35 °C @ 50 % RH → ≈ 34.8 °C / 94.6 °F); `getWbgtCategory` edges at
  80/85/88/90. All four with non-finite inputs.
- **Unit (handler):** append to `current-conditions-global.test.ts` and
  the NOAA-path tests — cold fixture (e.g., −21 °F, 25 mph) renders the
  frostbite line on both paths; published-`windChill` fixture uses the
  station value; calm-air carve-out; hot-humid fixture renders the WBGT
  line; hot-dry fixture does not; metric-prefs fixture produces the same
  band. **Never edit existing cases** — they are the moderate-weather
  byte-identity lock.
- **Locked unedited:** `metar-handler.test.ts`, all existing
  current-conditions tests, `fireWeather`/`fireWeatherContext` tests.
- **Byte-identical verification (release gate):** diff built-dist
  `get_current_conditions` output against the branch base for a moderate
  US point and a moderate non-US point (both paths, imperial and metric)
  — must be identical. Run keyless probes back-to-back per the
  feed-drift lesson.
- **Live verification sweep:** it is August — southern winter — so cold
  paths are live-testable now: Vostok / a high-Andes point via
  `source: "openmeteo"` for the frostbite line; Kuwait City / Phoenix
  (northern summer) for the WBGT line on both paths; Milan for
  no-new-lines. Record results in the implementation notes as usual.

## Documentation / registration checklist (for /run-plan tracking)

- [ ] `src/utils/thermalStress.ts` — D2 pure functions + doc comments citing the 2001 NA WCI model, EC frostbite categories, ABM simplified WBGT
- [ ] `src/config/displayThresholds.ts` — D6 gates
- [ ] `src/handlers/currentConditionsHandler.ts` — D4 effective-value selection + D5 rendering on both paths
- [ ] `src/index.ts` — D8 tool-description half-sentence (no schema change)
- [ ] Tests per §Testing
- [ ] README.md, CHANGELOG.md, CLAUDE.md, `docs/TOOLS.md`
- [ ] `docs/planning/README.md` + FE §6.2 — status flips and descoped-idea rows
- [ ] Move this doc to `docs/plans/` at completion (project convention)


---

## Implementation notes (filled at completion, 2026-08-18)

Executed via `docs/plans/heat-cold-stress-implementation-plan.md` (T1–T5) on
`feat/heat-cold-stress`, branched off `main` @ `8e5af48` (v1.23.0).

### What shipped, against the checklist

Every box in the checklist above is satisfied. Final gate: `npm run build`
0 errors, `npm test` **2,332 passing** (95 files, up from 2,274), `npm audit`
0 vulnerabilities.

- `src/utils/thermalStress.ts` — the four D2 functions, pure with zero imports,
  `null` sentinel throughout (deliberately *not* Fosberg's `NaN`).
- `src/config/displayThresholds.ts` — the two D6 gates.
- `src/utils/units.ts` — `fahrenheitToCelsius`, the mechanical inverse the
  caller's-unit display needed (the `knotsToMph` precedent).
- `src/handlers/currentConditionsHandler.ts` — one shared `formatThermalStress`
  renderer used by both paths, so wording cannot drift between them.
- `src/index.ts` — the D8 half-sentence; **no inputSchema change**.

### Deviation from D5: the calm-air carve-out names its own quantity

D5 specified the echoing form as `wind chill −47°F — …`. Under the D4 calm-air
carve-out the echoed value is *not* a wind chill — it is the air temperature,
substituted because calm −50 °F air freezes skin anyway — and rendering it as
"wind chill −25°F" mislabels the quantity in a safety line, contradicting D7's
honest-framing mandate. The basis is therefore a three-way discriminator
(`'shown' | 'windChill' | 'airTempCalm'`) and the carve-out renders
`air temperature −25°F in calm air — …`. The design settled *which value* to
use; it never mandated what to call it. Found by reading rendered output, not
by a failing test — the compare_models/pollen lesson repeating.

A second, smaller tightening: rather than hardcoding "NOAA published-`windChill`
⇒ no echo", the handler tracks whether the `Feels Like (Wind Chill)` line
actually rendered and echoes whenever it did not. This satisfies D4's "the
band's basis is always visible" in the edge case where a published wind chill
exists but the existing display gate does not fire.

### Pre-tag code review (2026-08-18)

A review of `main...feat/heat-cold-stress` before tagging, per the release
checklist's step 1 (the v1.20.0 release-review-hardening precedent). One
finding was acted on, and it was a consequence of the D5 deviation above:

**Missing wind was being reported as "calm air."** When a station reports no
wind at all (failed or absent anemometer), the carve-out substituted the air
temperature *and* the new wording announced "in calm air" — asserting a fact
nobody measured, while the air-temperature band understates the risk whenever
it is in fact windy. A −25 °F observation during a 30 mph blizzard rendered
High (10–30 min) instead of the true wind chill's Severe (2–5 min). The basis
enum gained a fourth case, `'airTempNoWind'`, rendering
`air temperature −25°F, wind not reported — … 10–30 minutes, sooner if it is
windy`. Measured-calm (`'airTempCalm'`) is unchanged. Note this hazard existed
before the deviation too — D5's original copy would have called the same value
a "wind chill" — but the explicit "calm air" wording made the false claim
louder, which is how the review caught it.

Also fixed: an orphaned JSDoc left pointing at the new type instead of
`formatNOAACurrentConditions`, and a config comment now records that the
`DisplayThresholds.thermalStress` gates are *upper* bounds only — the pure
module's own band floors mean lowering a gate past them is a no-op.

Not acted on, recorded instead:

- **The WBGT band renders its full-sun estimate at night.** The New Orleans
  probe below was taken at ~22:45 local and rendered `Heat stress (Extreme)`
  from a model whose published assumption is moderately high radiation. The
  mandatory caveat discloses the assumption, which is what D5/D7 settled as
  the mitigation, but both paths hold inputs that could bound it
  (`cloud_cover`, wind, the observation timestamp and station timezone).
  Deliberately left as a design question rather than changed days before a
  tag, and confirmed as such at release time — recorded as the 💡 row
  "Qualify the WBGT band by sun/cloud/time of day" in the planning index.
- Three copies of the °F→caller-unit rounding helper now exist in the
  handler's neighbourhood (`formatFahrenheitInPrefs`, a local `toPref`, and
  `normals.ts`'s `normalTempToPref`); consolidating touches paths with their
  own byte-identity locks, so it was not attempted pre-tag.
- `getFrostbiteRisk(...).description` is unused — the handler composes its own
  sentence from D5's copy. Kept because D2 specifies the shape.

### Live verification sweep (2026-08-18, against the built dist)

Byte-identity probes were run **back-to-back** against a `8e5af48` worktree
build (the feed-drift lesson), driver with `process.exit(0)`, no parallel live
drivers:

| Probe | Result |
|-------|--------|
| San Francisco `source: "noaa"`, imperial **and** metric (59 °F / 15 °C) | **byte-identical** to base |
| Milan `source: "openmeteo"`, imperial **and** metric (72 °F / 22 °C) | **byte-identical** to base |
| San Francisco `source: "metar"` | **byte-identical** to base (out-of-scope path) |

All five in one diff: **identical md5** (`37b6d3db05a0033587d87cb8a708228d`).

Extreme-condition probes:

| Probe | Rendered |
|-------|----------|
| Vostok, `openmeteo`, imperial (−70 °F, 19 mph) | `🥶 Frostbite risk (Extreme): wind chill -113°F — … under 2 minutes` |
| Vostok, metric | same band, `-81°C` — metric/imperial band invariance confirmed |
| New Orleans, `noaa` (90 °F, 71 % RH) | `🥵 Heat stress (Extreme): estimated WBGT 95°F` + italic caveat, directly under `Feels Like (Heat Index): 105°F` |
| New Orleans, metric | same band, `35°C` |
| Kuwait City, `openmeteo` (97 °F, 26 % RH) | `🥵 Heat stress (High): estimated WBGT 87°F` + caveat |
| Phoenix, `noaa` (109 °F, 15 % RH) | `Heat stress (Extreme)`, WBGT 92 °F — the hot-*dry* case still scoring high, which is the ABM full-sun bias the mandatory caveat exists to disclose |

The Vostok probe reproduced the design header's upstream figure (≈ −114 °F;
−113/−114 across runs as the feed refreshed). It also demonstrated *why* D4
forbids banding off `apparent_temperature`: `Feels Like` read −86 °F while the
wind chill driving the band was −113 °F, a 27° gap that would otherwise have
been invisible to the reader.

**Not live-verifiable this release:** the NOAA *cold* path. It is northern
August and no US station sat anywhere near a −18 °F wind chill, so that path
(published-`windChill` band, computed-WCI band, and the NOAA calm-air
carve-out) rests on the unit fixtures in `tests/unit/thermal-stress-handler.test.ts`
rather than on live output. The Open-Meteo cold path *was* live-verified.
Likewise the calm-air carve-out itself: every extreme-cold point probed was
windy, so it is unit-tested only.

### Test lock

`tests/unit/thermal-stress-handler.test.ts` is new (NOAA path, fake services);
`tests/unit/current-conditions-global.test.ts` was **appended to only** (194
insertions, zero deletions). Passing unedited throughout, as designed:
`metar-handler.test.ts`, `noaa-staleness.test.ts`, `openmeteo-current.test.ts`,
`fireWeather.test.ts`, `fireWeatherContext.test.ts`, and every pre-existing case
in `current-conditions-global.test.ts`.

Standing caveat observed: `tests/unit/bounds-checking.test.ts` carries a
machine-timing perf assertion (10 ms bound) that flakes under load and passes
in isolation. It flaked once on the baseline run and never again.
