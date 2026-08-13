# Almanac (Moon, Twilight, Records) — Implementation Plan

**Status:** READY (2026-08-12)

Execution plan for `docs/almanac-plan.md` (the WHAT/WHY); rules live in
`docs/orchestration-playbook.md`.

## Kickoff

A fresh Opus session should run this with:

```
/run-plan docs/almanac-implementation-plan.md
```

Or, equivalently: read `docs/almanac-plan.md` (design),
`docs/orchestration-playbook.md` (rules of engagement), and this file, then
execute the task graph below — green baseline, one subagent per task, review the
diff, run the gate yourself, commit, tick the tracker, push.

The gate after every task, from `weather-mcp/`:

```bash
npm run build     # 0 errors
npm test          # 100% pass
npm audit         # no high/critical
```

**Gate caveat (standing):** three files under `tests/integration/` make **live
network calls** and flake independently — `visualization-lightning.test.ts`
(Blitzortung MQTT), `safety-hazards.test.ts` (live NOAA/USGS), and
`global-rivers.test.ts` (live Flood API). If the gate goes red only in those
files, re-run before suspecting the diff. T6 adds a fourth file in that category
(live ACIS smoke) and must follow the same tolerant-of-flake convention.

**Live-verification rule:** the astronomy math is pure and golden-tested, but
the ACIS station selection and 366-slot summary shape were verified live once
(2026-08-12) and can drift. At T4 and T7 the orchestrator must drive the
**built dist against live ACIS** (a well-instrumented US city — e.g. Seattle or
St. Louis — must produce a plausible records line with years), plus a
`include_normals` call abroad confirming **no** records line and **no** ACIS
request.

## Scope & branch

**Branch:** `feat/almanac`. Target release: **v1.16.0**.

⚠️ **Base-commit decision (Assumption A1):** v1.15.0 (`feat/global-rivers`) is
complete but **unmerged and unreleased** — its content currently occupies
CHANGELOG `[Unreleased]`. Cut `feat/almanac` from `main` **after** the
global-rivers PR merges (recommended); if it is still unmerged at kickoff, ask
the human whether to stack on `feat/global-rivers` instead. Do not start from a
`main` that lacks the rivers work if the human intends v1.15.0 to ship first —
the docs tasks would collide.

In scope: the design plan's D1–D4 — the `astronomy-engine` dependency, the
`src/utils/astronomy.ts` pure utility, `include_astronomy` on `get_forecast`
(both provider paths), and US records on the `include_normals` path via a new
ACIS service — plus the testing and documentation checklists.

### Deferred / out of scope

| Item | Reason |
|------|--------|
| A `get_astronomy` MCP tool | Considered and rejected 2026-08-12 (design principle #1 — parameters over proliferation). |
| Moonrise/set or twilight via any network API (Open-Meteo daily moon vars, USNO) | D1 rejects them: partial coverage, no twilight, no next-quarter dates; local math wins. |
| International records | No viable free source; parity with normals' US-only NCEI sourcing (D4). |
| `include_astronomy` pass-through on `get_weather_summary` | D3: summary stays lean in v1; noted as possible follow-up. Verified: `weatherSummaryHandler.ts` has no `include_normals` either, so records need zero summary work. |
| Astrology, tides, satellite passes | Explicitly out of scope (D5). |

## Findings that shape the graph

Spot-checks against the code, reconciled into the tasks below:

- **The NOAA daily path has NO Sunrise/Sunset lines.** The design's anchor
  ("immediately after the existing Sunrise/Sunset lines,
  `forecastHandler.ts:600–626`") exists only on the **Open-Meteo** path
  (`daily.sunrise`/`daily.sunset` at lines 619–627). The NOAA daily loop
  (lines 380–412) renders **day/night periods** (`period.name`,
  `period.isDaytime`) with no sun lines at all, and the first period can be
  "Tonight". T2 needs an explicit NOAA placement rule — see Assumption A2.
- **Timezone is available on both paths**: NOAA at `forecastHandler.ts:351`
  (`points.properties.timeZone || guessTimezoneFromCoords(...)`), Open-Meteo as
  `forecast.timezone`. `formatLuxonTime` lives at `src/utils/unitFormat.ts:274`
  and takes `(DateTime, UnitPreferences)` — the 12h/24h preference rides along
  for free. Luxon `^3.7.2` is already a dependency.
- **`include_normals` renders at exactly four sites**, and the records line
  (T4) appends at each, gated by `isInUS`:
  1. forecast / NOAA — `forecastHandler.ts:461–504`
  2. forecast / Open-Meteo — `forecastHandler.ts:670–700` (also serves the
     NOAA border-overrun fallback, so a US point can land here)
  3. current / NOAA — `currentConditionsHandler.ts:463–494`
  4. current / Open-Meteo — `currentConditionsHandler.ts:627–652` (reachable
     for a US point via explicit `source: 'openmeteo'`)
  Each site already computes `{ month, day }` via `getDateComponents`
  (`src/utils/normals.ts:201`) — records reuse the same components.
- **`isInUS` lives at `src/utils/geography.ts:322`** — the same routing
  primitive as forecast/current/rivers. Note the boxes overrun the border
  (Toronto is `isInUS === true`): for records this degrades gracefully — the
  ACIS bbox finds no station → warn + omit, per D4's garnish rule.
- **Handler signatures and call sites.** `handleGetForecast` already ends with
  an optional `nceiService?` (`forecastHandler.ts:201–208`);
  `handleGetCurrentConditions` has six required params
  (`currentConditionsHandler.ts:73–80`). `tsconfig.json` has
  `include: ["src/**/*"]`, so **tests are not type-checked by `npm run build`**
  and several test files call these handlers positionally
  (`tests/unit/forecast-fallback.test.ts`,
  `tests/unit/current-conditions-global.test.ts`,
  `tests/unit/weather-summary-handler.test.ts`, plus legacy scripts under
  `tests/`). Mitigation baked into T4: append `acisService?` as the **last,
  optional** parameter on both handlers — existing call sites keep working and
  simply omit records (which is also the correct test-isolation behavior:
  no service → no ACIS call). Update the two `src/index.ts` call sites
  (`:719`, `:724`).
- **`src/services/ncei.ts` is the template for `src/services/acis.ts`**: axios
  instance with `CacheConfig.apiTimeoutMs`, private `handleError`, `Cache`
  member, station-probe loop. `tests/unit/ncei.test.ts` is the mocked-axios
  test template. ACIS differs in being keyless (no token gate) and POST-based.
- **`CacheConfig.ttl` (`src/config/cache.ts:72–114`)** — `MINUTE`/`HOUR`/`DAY`
  constants exist at lines 12–14; add `records: 7 * DAY` and
  `recordsStation: 30 * DAY` with the design's be-a-good-citizen comment.
- **`validateOptionalBoolean`** (used at `forecastHandler.ts:224`) is the
  validator for `include_astronomy`; default `false`.
- **Schema touchpoints in `src/index.ts`**: `get_forecast` schema starts at
  `:255`; the forecast `include_normals` description at `:285–289` and the
  current-conditions one at `:315–319` both gain a "US locations also show
  record high/low" sentence (T4). `include_astronomy` slots in beside
  `include_normals` with the semantic triggers from D3 (T2).
- **`astronomy-engine` is CJS** with its own `.d.ts`; the project is ESM
  (`"type": "module"`, NodeNext resolution). T1 must verify the interop import
  style (`import * as Astronomy from 'astronomy-engine'` vs default import)
  compiles under strict NodeNext and works at runtime in the built dist.
- **CHANGELOG discipline**: the entry goes under `[Unreleased]` (repo
  convention — the version bump is a release step, not plan work), which is
  another reason A1 wants the rivers content released or at least merged first.

## Task graph

### Phase 1 — Astronomy (D1, D2, D3)

**T1 — `astronomy-engine` dependency + pure astronomy utility** (`opus`)

- Files: `package.json`, `package-lock.json`, `src/utils/astronomy.ts` (new),
  `tests/unit/astronomy.test.ts` (new)
- Add `astronomy-engine` (^2.1.x) as a **runtime** dependency; confirm
  `npm audit` stays clean (zero transitive deps) and the CJS/ESM interop point
  from Findings.
- `src/utils/astronomy.ts` — pure, deterministic, no I/O, no caching:
  - `computeDayAstronomy(lat, lon, date: DateTime): DayAstronomy` → phase name
    (8 buckets from `Astronomy.MoonPhase()` 0–360°), illumination % from
    `Astronomy.Illumination().phase_fraction`, moonrise/moonset via
    `SearchRiseSet(Body.Moon, …)`, civil/nautical/astro dawn+dusk via
    `SearchAltitude(Body.Sun, …)` at −6°/−12°/−18°. **All ten time fields
    nullable**; a null means the event does not occur that day (polar cases).
  - `nextMoonQuarters(from: DateTime): { nextFull; nextNew }` via
    `SearchMoonQuarter()`/`NextMoonQuarter()` iterated.
  - Formatters used by both provider paths (keep the strings in ONE place):
    `formatAstronomyBlock(astro, prefs)` → the two D3 lines (`**Moon:** …` /
    `**Twilight:** …`) rendering nulls as "none (polar day)" / "none (polar
    night)" — never silently omitting a field; and
    `formatNextQuarters(quarters, timezone, prefs)` → the one-per-response
    `**Next full moon:** Aug 27 · **Next new moon:** Sep 11` line. All times
    converted to the forecast's IANA zone and rendered with `formatLuxonTime`.
- Acceptance: full gate green. Golden-value tests against USNO-published
  times (Seattle 2026-08-12: New Moon, moonrise ≈ 5:48 AM PDT — tolerance
  ±3 min); phase-name bucket boundaries (e.g. 44°/46°, 315° edges);
  illumination at known quarters (0/50/100%); Tromsø in June → null astro
  twilight and "polar day" rendering; 12h vs 24h formatting; next-quarter
  search crossing a month boundary. Pure functions only — no mocks, and the
  suite must stay well inside the <2 s budget.
- Commit: `feat: Add astronomy utility for moon phase, rise-set, and twilight`
- Depends on: —

**T2 — `include_astronomy` on `get_forecast` (both paths) + schema** (`opus`)

- Files: `src/handlers/forecastHandler.ts`, `src/index.ts`
- Args/validation: add `include_astronomy?: boolean` to `ForecastArgs`,
  validated with `validateOptionalBoolean(…, 'include_astronomy', false)`
  beside `include_normals` (`forecastHandler.ts:224`); thread it into both
  `formatNOAAForecast` and `formatOpenMeteoForecast`.
- **Daily granularity only** (Assumption A3): silently ignored for
  `granularity === 'hourly'`, matching `include_normals`.
- Open-Meteo path: inside the daily loop, emit `formatAstronomyBlock` output
  immediately after the Sunset line (after `forecastHandler.ts:627`, before
  Daylight Duration), computing per-day astronomy from
  `DateTime.fromISO(daily.time[i], { zone: forecast.timezone })`.
- NOAA path (Assumption A2): group day/night periods by calendar date
  (`period.startTime` in the `timezone` from `:351`); emit the block once per
  calendar date, at the end of the **first** period belonging to that date
  (handles a "Tonight"-first response cleanly).
- Once per response on both paths: the next-quarters line immediately after
  the last day's block, **before** the `---` data-source footer, anchored at
  the first forecast day.
- Registration (`src/index.ts`): `include_astronomy` property in the
  `get_forecast` schema (type boolean, default false) with D3's semantic
  triggers in the description ("moon phase", "full moon", "moonrise", "golden
  hour", "when does it get dark"); `detail` interaction: none (both levels
  render the block when the flag is set).
- Acceptance: full gate green; existing forecast tests untouched and passing
  (flag defaults off → zero output diff). **Live check with the built dist:**
  Seattle daily + `include_astronomy: true` shows Moon/Twilight per day and
  one next-quarters line on the NOAA path; Paris shows the same on the
  Open-Meteo path; hourly + flag shows no block; flag absent → byte-identical
  output to pre-branch.
- Commit: `feat: Add include_astronomy moon and twilight block to get_forecast`
- Depends on: T1

### Phase 2 — US records (D4)

**T3 — ACIS types, service, cache TTLs, records formatting** (`sonnet`)

- Files: `src/types/acis.ts` (new), `src/services/acis.ts` (new),
  `src/utils/records.ts` (new), `src/config/cache.ts`,
  `tests/unit/acis-records.test.ts` (new)
- Types: `AcisStnMetaResponse`, `AcisStnDataResponse`, parsed `DailyRecords`
  (366 slots of `{ high?: { value, year }, low?: { value, year } }` plus
  station name + POR start year). ACIS values arrive as **strings** (`"96"`,
  `"M"` missing, `"T"` trace) — parse defensively; `"M"` → omit that side. No
  `any`.
- Service (`AcisService`, modeled on `src/services/ncei.ts` — axios instance,
  `CacheConfig.apiTimeoutMs`, `handleError`, `Cache` member, keyless):
  - `findRecordsStation(lat, lon)`: `POST /StnMeta`, ±0.25° bbox widened once
    to ±0.5° on empty, `elems: "maxt,mint"`,
    `meta: "name,sids,ll,valid_daterange"`; pick longest period-of-record,
    preferring threaded (`…thr`) station IDs. Cache
    `CacheConfig.ttl.recordsStation = 30 * DAY`.
  - `getDailyRecords(stationId)`: one `POST /StnData` with
    `smry: {reduce: max/min, add: date}`, `smry_only: 1`, `groupby: "year"` —
    the full 366-slot table in a single call (live-verified shape:
    `smry: [[["96","1977-08-12"], …], [["49","1953-08-12"], …]]`). Cache
    `CacheConfig.ttl.records = 7 * DAY`.
  - **Leap-calendar day-of-year indexing**: index by month/day position in a
    **leap** year (Aug 12 → 224); Feb 29 is a real slot; post-February dates
    in common years must not shift. Implement as an exported pure helper.
- `src/utils/records.ts`: `getRecordsLine(acisService, lat, lon, month, day):
  Promise<string | undefined>` — orchestrates station→records→format, returns
  the D4 line (`**Records for Aug 12:** High 96°F (1977) · Low 49°F (1953) —
  records since 1945`) plus the attribution line "Records: NOAA Regional
  Climate Centers (ACIS)"; converts °F→°C per `prefs` like `formatNormals`
  does; **returns `undefined` on ANY failure** (logs `warn`) — records are
  garnish, never load-bearing.
- Cache config: the two new TTLs with the design's rationale comments.
- Acceptance: full gate green. New unit tests (mocked axios per
  `tests/unit/ncei.test.ts`): day-of-year indexing incl. Feb 29 and
  post-February common-year dates; station selection (longest POR, `thr`
  preference, bbox widening on empty); `"M"`/`"T"` handling (one-sided line,
  both-missing → `undefined`); formatting incl. metric prefs; graceful
  `undefined` on network error / malformed body / no station; second call
  served from cache.
- Commit: `feat: Add RCC ACIS client for US daily temperature records`
- Depends on: — · **parallel-safe with T1 and T2** (disjoint files)

**T4 — Wire records into the four `include_normals` sites** (`sonnet`)

- Files: `src/handlers/forecastHandler.ts`,
  `src/handlers/currentConditionsHandler.ts`, `src/index.ts`
- Append `acisService?: AcisService` as the **last, optional** parameter of
  `handleGetForecast` and `handleGetCurrentConditions` (see Findings — keeps
  untypechecked test call sites working); thread it into the four formatter
  functions. Instantiate `const acisService = new AcisService()` in
  `src/index.ts` beside `nceiService` (`:130`) and pass it at both call sites
  (`:719`, `:724`).
- At each of the four normals sites: when `include_normals && isInUS(lat, lon)
  && acisService`, await `getRecordsLine(...)` in its **own** try/catch
  (independent of the normals fetch — Assumption A5) using the same
  `{ month, day }` the site already computed, appending the line + attribution
  after the normals output (or after the normals-unavailable notice). Forecast
  paths: day 1 only — exactly the date the normals block already uses.
  Non-US: no records line, no ACIS request (assert this in T5). Requests stay
  sequential with the normals fetch, both behind the same flag.
- Schema (`src/index.ts:285–289`, `:315–319`): both `include_normals`
  descriptions gain "For US locations, also shows the record high/low for the
  date and the year it was set."
- Acceptance: full gate green; all existing tests pass untouched (no service
  injected → no records → zero output diff). **Live check with the built
  dist:** Seattle/St. Louis `include_normals: true` renders the records line
  with plausible years + attribution on both tools; Paris renders normals with
  no records line; a second call hits the records cache (log shows one ACIS
  fetch).
- Commit: `feat: Append US record high-low to climate normals output`
- Depends on: T2 (shared files), T3

### Phase 3 — Tests

**T5 — Handler unit tests for astronomy and records gating** (`sonnet`)

- Files: `tests/unit/almanac-handler.test.ts` (new)
- Model on `tests/unit/forecast-fallback.test.ts` /
  `current-conditions-global.test.ts` (real handler, fake services injected).
  Cover: `include_astronomy` validation (non-boolean rejected naming the
  param); daily Open-Meteo path renders Moon/Twilight per day + exactly one
  next-quarters line before the footer; NOAA path renders once per calendar
  date incl. a "Tonight"-first fixture; hourly granularity ignores the flag;
  flag off → no astronomy strings. Records: line renders only when
  `include_normals` + US + service present; non-US with `include_normals`
  makes **no** ACIS call (assert on the fake); ACIS failure → normals still
  render, no records line, no throw; records line present even when the
  normals fetch itself failed (A5); attribution line accompanies the records
  line.
- Acceptance: new tests pass, deterministic, no live calls; full gate green.
- Commit: `test: Cover include_astronomy placement and records gating`
- Depends on: T4

**T6 — Integration tests (mocked ACIS end-to-end + tolerant live smoke)** (`sonnet`)

- Files: `tests/integration/almanac.test.ts` (new)
- Two blocks: (1) mocked `StnMeta` + `StnData` responses (captured live shapes
  from the design verification) through the **real** service + handler end to
  end, including the string-typed values and a `"M"` slot; (2) one live ACIS
  smoke test + one live `include_astronomy` forecast call, following the
  tolerant-of-flake convention of the existing integration files (generous
  timeout, assert shape not values, never fail the suite on a network error).
- Acceptance: mocked block deterministic; live block tolerant; full gate green
  (re-run once if only live files are red).
- Commit: `test: Add almanac integration coverage for ACIS records and astronomy`
- Depends on: T4 · **parallel-safe with T5** (disjoint files)

### Phase 4 — Live verification and docs

**T7 — Live sweep + documentation/registration checklist** (`opus`)

- Files: `CHANGELOG.md`, `README.md`, `docs/TOOLS.md`, `CLAUDE.md`,
  `docs/planning/README.md`, `docs/almanac-plan.md`
- **Live sweep against the built dist**, re-verifying T2 and T4's acceptance
  lists end to end, plus: a no-flags forecast call byte-identical to
  pre-branch output; a polar location in the current season (e.g. Longyearbyen)
  rendering the polar wording rather than blank fields; one saved-location and
  one `city_name` call with `include_astronomy` (the `**Location:**` header
  still leads).
- Docs: CHANGELOG entry under `[Unreleased]` (do **not** invent the version
  bump — Assumption A4); README feature list + example queries ("will there be
  a full moon this weekend?", "when does it get fully dark?", "is this a
  record high?"); `docs/TOOLS.md` — `include_astronomy` on `get_forecast`, the
  records behavior under both tools' `include_normals`, the ACIS attribution;
  `CLAUDE.md` — the new runtime dependency (first computational dep — data
  model note from D1), the `acis.ts` service in the architecture tree, the
  v1.16.0 status blurb; `docs/planning/README.md` — flip the three idea rows
  (§1.1 moon, §1.2 twilight, §2.2 records) to ✅ (the orchestrator may flip
  them to 🚧 at kickoff). Mark `docs/almanac-plan.md` status `IMPLEMENTED`.
- Leave the plan set in `docs/` — per the playbook, the move to `docs/plans/`
  happens when v1.16.0 actually ships.
- Acceptance: live sweep recorded in the commit message or a short note; full
  gate green; every box of the design plan's "Documentation / registration
  checklist" satisfied.
- Commit: `docs: Record almanac features — moon, twilight, US records`
- Depends on: T5, T6

## Assumptions to confirm before `/run-plan`

- **A1 — branch base.** `feat/global-rivers` (v1.15.0) is complete but
  unmerged, and owns CHANGELOG `[Unreleased]`. Recommended: merge/release it
  first and cut `feat/almanac` from `main`. If almanac must start sooner, stack
  on `feat/global-rivers` and say so — the docs tasks (CHANGELOG, README,
  CLAUDE.md, planning index) collide otherwise.
- **A2 — NOAA-path astronomy placement.** NOAA daily output has no
  Sunrise/Sunset anchor; assumed: one block per calendar date, emitted at the
  end of the first period of that date (works for "Tonight"-first responses).
- **A3 — daily-only.** `include_astronomy` is ignored for
  `granularity: "hourly"`, matching `include_normals`' daily-only behavior.
  (Design D3 says "each daily entry"; it never mentions hourly.)
- **A4 — CHANGELOG heading.** Design says "CHANGELOG.md v1.16.0"; repo
  convention (global-rivers precedent) puts the entry under `[Unreleased]` and
  leaves the version bump to the release step. Assumed: `[Unreleased]`.
- **A5 — records independence.** The records attempt runs in its own
  try/catch, so a records line can render even when the normals fetch failed
  (and vice versa). D4 only requires that ACIS failures never break the call.
- **A6 — optional `acisService`.** Appended last and optional on both
  handlers, so existing (untypechecked) test call sites keep working and
  simply get no records — which is the correct isolation behavior.

## Progress Tracker

- [x] T1 — astronomy-engine dep + pure astronomy utility (`opus`) — `73b3ab6`
- [x] T2 — include_astronomy on get_forecast, both paths + schema (`opus`) — `7470e19`
- [x] T3 — ACIS types, service, cache TTLs, records formatting (`sonnet`) — `c7cb23f`
- [ ] T4 — Wire records into the four include_normals sites (`sonnet`)
- [ ] T5 — Handler unit tests for astronomy and records gating (`sonnet`)
- [ ] T6 — Integration tests: mocked ACIS + tolerant live smoke (`sonnet`)
- [ ] T7 — Live sweep + documentation checklist (`opus`)

**Done when:** every box is ticked with its commit SHA, the full gate
(`npm run build`, `npm test`, `npm audit`) is green, the design plan's D1–D4
acceptance is demonstrably met live (astronomy on both provider paths, polar
wording, records line in the US and cleanly absent abroad), flag-off output is
byte-identical to pre-branch behavior, and `docs/almanac-plan.md` is marked
`IMPLEMENTED`. Opening the PR is the human's call.
