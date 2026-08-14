# Global Wildfire (NASA FIRMS) — Implementation Plan

**Status:** READY (2026-08-14)

Execution plan for `docs/plans/global-wildfire-plan.md` (the WHAT/WHY); rules live in
`docs/orchestration-playbook.md`.

## Kickoff

A fresh Opus session should run this with:

```
/run-plan docs/plans/global-wildfire-implementation-plan.md
```

Or, equivalently: read `docs/plans/global-wildfire-plan.md` (design),
`docs/orchestration-playbook.md` (rules of engagement), and this file, then
execute the task graph below — green baseline, one subagent per task, review
the diff, run the gate yourself, commit, tick the tracker, push.

The gate after every task, from `weather-mcp/`:

```bash
npm run build     # 0 errors
npm test          # 100% pass
npm audit         # no high/critical
```

**Gate caveat (standing):** several files under `tests/integration/` make
**live network calls** and flake independently (see the standing flaky-tests
caveat). If the gate goes red only in those files, re-run before suspecting
the diff. **T6 adds another file in that category** (keyless FIRMS live smoke)
and must follow the same tolerant-of-flake convention.

**Live-verification rule:** the design's API contract was live-verified
2026-08-13 and re-verified 2026-08-14 (headers, file names, sizes, the two CSV
shape variants — see the design's §Live re-verification notes). Two pieces can
only be trusted live: the **regional bbox constants** (T2 derives them; T7
spot-checks a few live) and the design's **acceptance points** (T7). The
orchestrator runs the T7 sweep personally against the built dist; a subagent's
claim that live verification passed is never the gate. The real
`FIRMS_MAP_KEY` sits in the gitignored `weather-mcp/.env` — usable for the
keyed-path sweep, **never committed, never echoed into logs or test fixtures**.

## Scope & branch

**Branch:** `feat/global-wildfire` (named in the design). Target release:
**v1.20.0**.

In scope: the design's D1–D8 — country-routed `get_wildfire_info` (US → NIFC
byte-identical, elsewhere → NASA FIRMS VIIRS hotspots), the `source` parameter
with no cross-fallback, keyless-first FIRMS access (flat regional/Global CSV)
with the optional `FIRMS_MAP_KEY` Area-API upgrade and key-rejection fallback,
the pure parsing/clustering/region-picker module, the D5 honest-framing
renderer with detection-tier safety assessment, `day_range`, caching, and the
testing + documentation checklists.

### Deferred / out of scope

| Item | Reason |
|------|--------|
| Smoke forecasts, Copernicus EFFIS | Design scope decision — out of v1. |
| Multi-satellite merging (NOAA-20/21 NRT, MODIS) | Design D3 — noted as future work; v1 is SNPP-only so both paths match. |
| Synthesizing named incidents from detections | Design scope decision — FIRMS has no incidents; D5 frames hotspots honestly instead. |
| FIRMS country API | Down (`Invalid API call`, re-confirmed 2026-08-14) — never build on it. |
| NIFC↔FIRMS auto cross-fallback | D2 doctrine — different claims (managed incidents vs heat detections), same as rivers. |
| Keyless 48 h / 7 d flat files | D6 — keyless serves the fixed 24 h files only; multi-day is the key's upgrade. |
| Refactoring `nifc.ts`'s hardcoded `1800000` TTL | D7 explicitly leaves it as-is in this feature. |
| `check_service_status` entry for FIRMS | Pre-existing gap (NIFC/ACIS/aviationweather also absent) — separate follow-up, same deferral as international-alerts. |

## Findings that shape the graph

Spot-checks against the code, reconciled into the tasks below:

- **`tests/unit/wildfire-handler.test.ts` calls `handleGetWildfireInfo` with
  exactly four arguments** (`:87-92` — `args, nifcService, locationStore,
  geocodingService`) at Sacramento (38.5816, −121.4944), and the design
  requires it to pass **unedited**. Therefore the new services are appended as
  **optional trailing parameters** (`firmsService?`, `nominatimService?` — the
  alerts A2 precedent). Absent `nominatimService` → skip the reverse lookup
  **silently** and fall through to `isInUS`; absent `firmsService` when the
  router picks FIRMS → fall through to the NIFC path (today's behavior), so
  no harness can crash. The D1 one-line note renders only when a real reverse
  lookup *throws* at runtime.
- **The bearing helpers do not live in `metarStation.ts`** (the design's
  shorthand): `bearingDegrees` is in `src/utils/distance.ts` and
  `windDirectionFromDegrees` (16-point compass) in `src/utils/units.ts` —
  `metarStation.ts:20-21` merely imports them. `firmsHotspots.ts` imports the
  same two helpers directly.
- **The routing template is `alertsHandler.ts:78-118`**: lowercase-normalize
  `resolved.country_code` → `nominatimService.reverseCountry` (guarded,
  try/catch with the one-line-note flag) → route, reverse answer wins over
  `isInUS`, no-country falls back to `isInUS`. Copy the structure and the
  failed-lookup note wording.
- **Wiring points in `src/index.ts`:** `nominatimService` is constructed at
  `:120` and already injected into `get_alerts`/summary (`:771`, `:783`); the
  wildfire schema/description is at `:613-615` (the "(US focus)" text the
  design quotes) and the dispatch at `:822-824`. `FIRMSService` gets
  constructed beside `nifcService`.
- **CHANGELOG `[Unreleased]` is currently empty** (v1.19.0 shipped
  2026-08-13) — this feature opens it. The version bump to v1.20.0 stays a
  release step, not a task.
- **`.env.example`'s "API TOKENS (Optional)" section is at `:112-121`**
  (the `NCEI_API_TOKEN` block) — `FIRMS_MAP_KEY` appends beneath it in the
  same comment style.
- **`CacheConfig.ttl` is additive-safe** — `tests/unit/config.test.ts` asserts
  individual keys, not an exhaustive snapshot, so the two new TTLs need no
  test churn (METAR/alerts precedent).
- **Key-rejection must be distinguishable** from other failures for the D3
  keyless fallback: the service throws a small exported
  `FIRMSKeyRejectedError extends Error` with a **fixed** sanitized message
  (still the plain-`Error` ACIS/NIFC doctrine — no `ApiError` union change);
  every other axios failure maps to fixed message strings in the
  `nifc.ts:147-164` style. **No thrown message, log line, or fixture may
  contain the key or the request URL.**
- **The planning index rows already exist**: idea row at
  `docs/planning/README.md:37` (📝) and viability row at `:101`; ICR Phase 4
  lives in `docs/planning/INTERNATIONAL_COVERAGE_ROADMAP.md`. T7 flips them.

## Task graph

### Phase 1 — Foundation (config, types, pure logic)

**T1 — `FIRMS_MAP_KEY` config + `.env.example`** (`haiku`)

- Files: `src/config/api.ts`, `.env.example`
- Copy the `NCEI_API_TOKEN` shape exactly: export `FIRMS_MAP_KEY` from
  `process.env`, add `isFIRMSKeyAvailable()`, with a docblock spelling out
  with-vs-without behavior (with: targeted Area-API bbox queries, `day_range`
  1–5, rate limit 5,000 tx/10 min; without: keyless 24 h regional flat files —
  the tool works globally either way; free signup at
  https://firms.modaps.eosdis.nasa.gov/api/map_key/). Append the matching
  commented block to `.env.example`'s "API TOKENS (Optional)" section
  (`:112-121`).
- Acceptance: full gate green; no behavior change anywhere (nothing consumes
  the export yet).
- Commit: `feat: Add optional FIRMS_MAP_KEY configuration`
- Depends on: — · **parallel-safe with T2** (disjoint files)

**T2 — FIRMS types + pure hotspot module** (`sonnet`)

- Files: `src/types/firms.ts` (new), `src/utils/firmsHotspots.ts` (new),
  `tests/unit/firms-hotspots.test.ts` (new)
- Types (D4): `FIRMSDetection` (latitude, longitude, frp, confidence enum
  `low | nominal | high | unknown`, acquiredAt ISO string, daynight,
  satellite, instrument?), `FIRMSCluster` (detections count, centroid,
  distanceKm, bearing, maxFrp, newestAcquiredAt, day/night mix, confidence
  summary), and the region-constant type. No `any`.
- Pure module (no I/O — the `metarStation.ts`/`composite.ts` precedent):
  - `parseFIRMSCsv(csv)` — **header-name-driven** parsing (D4: the two live
    paths differ — Area API has 14 cols incl. `instrument` + abbreviated
    confidence `l/n/h` + unpadded `acq_time` `215`; flat files have 13 cols,
    no `instrument`, spelled-out `nominal`, zero-padded `0048`). FIRMS CSV is
    unquoted so per-line comma-split is safe; never index by position.
    Dependency-free.
  - Normalization: confidence `l/n/h` ↔ `low/nominal/high` → the one enum
    (unrecognized → `unknown`); `acq_date` + `acq_time` (UTC, zero-pad to 4
    digits first) → ISO timestamp; `frp`/`bright_ti4` parsed defensively
    (non-numeric → row kept with `frp: 0` or dropped — pick one, document it).
  - `pickRegionFile(lat, lon)` — bundled **conservative inset bbox constants**
    for the 12 regional cuts (file-name constants from the design's verified
    table), derived from FIRMS' regional coverage map; a point not
    comfortably inside any region → `Global`. Correctness never depends on
    the mapping (bandwidth optimization only) — when in doubt, shrink the
    inset or omit; known gaps (Middle East) take Global by design.
  - `filterByRadius(detections, lat, lon, radiusKm)` — haversine via
    `calculateDistance` from `src/utils/distance.ts`, plus the **5,000-row
    cap** signal (return a truncation flag; the *handler* logs the
    `securityEvent: true` warn and renders the caveat).
  - `clusterDetections(detections, radiusKm = 2)` (D5) — greedy: sort by FRP
    descending, assign each detection to the nearest existing cluster
    centroid within 2 km, else start a new cluster; centroid recomputed as
    the running mean on each assignment, ties broken by cluster creation
    order (document the policy in a comment — determinism is the contract).
    Cluster distance/bearing from the requested point via `calculateDistance`
    + `bearingDegrees` (`distance.ts`) + `windDirectionFromDegrees`
    (`units.ts`). Raw brightness Kelvin is **omitted** from cluster output.
- Acceptance: full gate green. Tests against **both live-captured header
  variants in miniature** (never commit multi-MB captures): parsing each
  shape; confidence normalization incl. unknown; timestamp assembly for `215`
  and `0048`; clustering (many rows → one cluster, the 2 km boundary,
  FRP-descending determinism, empty input → `[]`); region picker
  (inside-region point, Middle East gap → Global, mid-ocean → Global); the
  row cap flag.
- Commit: `feat: Add FIRMS hotspot parsing, clustering, and region selection`
- Depends on: — · **parallel-safe with T1** (disjoint files)

### Phase 2 — Service

**T3 — `FIRMSService` + cache TTLs** (`sonnet`)

- Files: `src/services/firms.ts` (new), `src/config/cache.ts`,
  `tests/unit/firms-service.test.ts` (new)
- `FIRMSService` (construction shape: `nifc.ts` — axios instance with
  `CacheConfig.apiTimeoutMs`, `Cache` with `CacheConfig.maxSize`):
  - `getDetectionsByBbox(west, south, east, north, dayRange)` — keyed Area
    API `https://firms.modaps.eosdis.nasa.gov/api/area/csv/{KEY}/VIIRS_SNPP_NRT/{w},{s},{e},{n}/{dayRange}`;
    cache key on rounded bbox + dayRange, TTL
    `CacheConfig.ttl.firmsAreaQuery`. A 400/401 whose body contains
    `Invalid MAP_KEY` throws the exported `FIRMSKeyRejectedError` (fixed
    message, no key, no URL); other failures map to fixed message strings
    per the `nifc.ts` `queryFeatureServer` style.
  - `getDetectionsByRegion(regionFile)` — keyless flat file
    `https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_<Region>_24h.csv`;
    caches the **parsed rows per region file** (not per request), TTL
    `CacheConfig.ttl.firmsRegionalFile` — repeated queries anywhere in Europe
    cost one ~410 KB fetch per half hour; `Global` cached the same way.
  - Both return normalized `FIRMSDetection[]` via T2's parser. Logging via
    `logger` with `redactCoordinatesForLogging`; **never log the request
    URL** (the key is in it).
- `src/config/cache.ts`: add `firmsAreaQuery: 30 * MINUTE` and
  `firmsRegionalFile: 30 * MINUTE` to `CacheConfig.ttl` with the design's
  justifying comments (NRT detections land within ~3 h of overpass; 30 min
  matches the NIFC perimeter cadence). Do **not** touch `nifc.ts`.
- Acceptance: full gate green. Tests (mocked axios): both methods parse their
  respective live-captured shape; per-region cache hit on second call (one
  HTTP request); bbox cache keyed by dayRange; `Invalid MAP_KEY` body →
  `FIRMSKeyRejectedError`; timeout/400/503 → fixed sanitized messages; the
  **key-hygiene test** — configure a fake key, force every failure mode,
  assert no thrown message contains the key (D3, named in the design's
  testing section).
- Commit: `feat: Add NASA FIRMS fire detection client`
- Depends on: T1, T2

### Phase 3 — Routing, rendering, registration

**T4 — Country routing + FIRMS renderer in `get_wildfire_info`** (`opus`)

- Files: `src/handlers/wildfireHandler.ts`, `src/index.ts`
- Signature: append **optional trailing** `firmsService?`, `nominatimService?`
  to `handleGetWildfireInfo` (Findings; alerts A2 precedent).
  `tests/unit/wildfire-handler.test.ts`'s four-argument call must keep
  compiling and passing **unedited** — if it needs editing, stop and ask.
- Params (D6): `source?: 'auto' | 'nifc' | 'firms'` (validated per the rivers
  `source` contract; invalid → `auto`) and `day_range?: number` (1–5,
  default 1; clamped like `radius`). `radius`/`detail`/location inputs
  unchanged; `required: []` stays.
- Routing (D1/D2), template `alertsHandler.ts:78-118`: explicit `source`
  short-circuits (`nifc` anywhere — including finding nothing outside the US;
  `firms` anywhere — including the US, pre-WFIGS signal). `auto`:
  lowercase-normalized `resolved.country_code` → `reverseCountry` (guarded on
  service presence; thrown lookup → `isInUS` fallback + the one-line note,
  wording copied from alertsHandler; absent service → silent fallback) →
  `us` or no-country-`isInUS`-true → NIFC branch **completely unchanged**;
  otherwise → FIRMS (falling through to NIFC only if `firmsService` is
  absent — test harnesses). No cross-fallback in either direction.
- FIRMS branch (D5):
  - Fetch: key available → `getDetectionsByBbox` with the handler's existing
    bbox math + `day_range`; `FIRMSKeyRejectedError` → keyless retry + note
    "*Note: FIRMS_MAP_KEY was rejected; showing keyless 24-hour data.*"; no
    key → `pickRegionFile` → `getDetectionsByRegion` → `filterByRadius`
    post-filter; `day_range > 1` keyless → 24 h result + the D6 upgrade note.
    Other errors propagate to the handler's existing catch/❌ block (single
    formatter, message sanitized).
  - Render: the D5 header framing block verbatim (Source line + the
    ⚠️ satellite-detections-not-incidents disclosure); clusters via T2,
    nearest-first, each with count, distance + 16-point bearing, max FRP (MW),
    newest detection age, day/night mix, confidence summary, satellite;
    display caps 5 clusters (`full` → 25) with the NIFC-branch remainder
    wording; row-cap truncation caveat + `securityEvent: true` warn when T2's
    flag is set; safety assessment on the nearest **cluster** with the NIFC
    distance tiers (<5 EXTREME DANGER, <25 HIGH ALERT, <50 CAUTION, else
    AWARENESS), detection-adjusted wording, **no containment logic**;
    no-detections → "No satellite fire detections in the last 24 h within
    N km." + the not-all-clear caveat (cloud cover / small fires) — never
    reads as all-clear; D8 FIRMS attribution footer (both lines). NIFC footer
    stays on the NIFC branch only.
- Registration (`src/index.ts`): construct `FIRMSService` beside
  `nifcService`; pass `firmsService, nominatimService` at the dispatch
  (`:822-824`); rewrite the tool description (`:613-615`) — drop
  "(US focus)", describe the two data modes (US: NIFC named incidents with
  acreage/containment; elsewhere: NASA FIRMS satellite heat detections),
  document `source` and `day_range` (incl. "NIFC path ignores day_range");
  `LOCATION_SCHEMA_PROPERTIES` untouched.
- Acceptance: full gate green; `tests/unit/wildfire-handler.test.ts` passes
  **unedited** (the US no-change lock). Quick sanity against the built dist:
  Toronto → FIRMS framing (not NIFC), Sacramento → output diffs clean against
  `main` for the same arguments, Sacramento with `source: 'firms'` → FIRMS
  framing.
- Commit: `feat: Route get_wildfire_info by country — NIFC in the US, NASA FIRMS elsewhere`
- Depends on: T3

### Phase 4 — Tests

**T5 — Routing unit tests** (`sonnet`)

- Files: `tests/unit/wildfire-routing.test.ts` (new)
- Real handler, plain fake services — the rivers/alerts negative-assertion
  discipline (`tests/unit/river-conditions-global.test.ts:208`,
  `tests/unit/alerts-routing.test.ts:90`): auto-US touches only NIFC and
  **never** FIRMS; auto-non-US the reverse; both `source` overrides (incl.
  `firms` at a US point and `nifc` at a non-US point → empty NIFC result);
  no cross-fallback on a zero-result NIFC query; `reverseCountry` called with
  the exact coordinates / **skipped** when `country_code` came with the
  resolved location (uppercase `"CA"` normalized); Toronto canary
  (43.65, −79.38 — inside the CONUS overrun box) + fake reverse `ca` reaches
  FIRMS, NIFC not called; reverse `null` + US point → NIFC; reverse throws →
  `isInUS` fallback + the one-line note; absent `nominatimService` → silent
  fallback; key-rejected fake → keyless retry + disclosure note;
  `day_range > 1` with keyless fake → upgrade note; row-cap flag → truncation
  caveat; no-detections → not-all-clear caveat present; `detail: 'full'` →
  25-cluster cap with remainder note.
- Acceptance: deterministic, no live calls; full gate green.
- Commit: `test: Cover wildfire country routing and FIRMS rendering`
- Depends on: T4 · **parallel-safe with T6** (disjoint files)

**T6 — Integration tests: mocked shapes + tolerant keyless live smoke** (`sonnet`)

- Files: `tests/integration/global-wildfire.test.ts` (new)
- Two blocks: (1) mocked HTTP against the real service + handler end to end
  using trimmed captures of **both** CSV shapes (Area-API 14-col and
  flat-file 13-col — the design's live-captured headers); (2) one live smoke
  test on the **keyless** path (a regional flat file fetch through the
  handler — CI needs no secret), following the tolerant-of-flake convention:
  generous timeouts, assert shape not values, never fail on a network error.
  **This adds a file to the live-network set** — say so in the file header
  (`almanac.test.ts` header as template).
- Acceptance: mocked block deterministic; live block tolerant; full gate
  green (re-run once if only live files are red).
- Commit: `test: Add global wildfire integration coverage`
- Depends on: T4 · **parallel-safe with T5** (disjoint files)

### Phase 5 — Live verification and docs

**T7 — Live acceptance sweep + documentation/registration checklist** (`opus`)

- Files: `CHANGELOG.md`, `README.md`, `docs/TOOLS.md`, `CLAUDE.md`,
  `docs/planning/README.md`,
  `docs/planning/INTERNATIONAL_COVERAGE_ROADMAP.md`,
  `docs/plans/global-wildfire-plan.md` (status + move to `docs/plans/`)
- **Live sweep against the built dist**, run by the orchestrator personally
  (the real `FIRMS_MAP_KEY` is in the gitignored `.env`; remember the
  standing driver caveat — dist drivers need `process.exit(0)`, don't run
  live drivers in parallel):
  1. Toronto (raw coordinates) → FIRMS framing (Source line + hotspot
     disclosure), **not** NIFC.
  2. Sacramento → byte-identical to `main` for the same arguments (diff the
     built-dist output).
  3. Sacramento with `source: 'firms'` → FIRMS detections/empty, FIRMS
     framing, works in the US.
  4. An active-fire region (pick from today's regional files — southern
     Africa is reliably busy) → clusters with count/distance/bearing/FRP/age;
     caps respected; keyed vs keyless outputs comparable.
  5. `day_range: 3` **with** the key → multi-day Area-API result; with the
     key unset → 24 h + upgrade note; with a **bogus** key → keyless result +
     rejection note.
  6. Mid-ocean point → no-detections message **with** the not-all-clear
     caveat.
  7. A regional-gap point (e.g. Riyadh) → Global-file fallback (verify via
     debug logs), correct result.
  8. Two consecutive nearby European queries → one regional-file fetch
     (debug logs: fetch then cache hit).
  Also spot-check 2–3 of T2's regional bbox insets against the live files
  (a point inside the Europe inset actually appears in the Europe cut).
- Docs, per the design's checklist:
  - CHANGELOG under `[Unreleased]` (currently empty — this opens it; no
    version bump).
  - README: tool/coverage table `get_wildfire_info` → global; the
    hotspots-vs-incidents caveat in the limitations list; the optional-key
    note; test-count badge.
  - `docs/TOOLS.md`: wildfire section rewritten for both data modes.
  - CLAUDE.md: `firms.ts`/`firmsHotspots.ts` in the architecture tree,
    v1.20.0 status blurb, and **every remaining "US only" wildfire claim
    corrected** (tool list, the v1.15/v1.19 blurbs that say wildfire remains
    US-only).
  - `docs/planning/README.md`: idea row (`:37`) 📝 → ✅ with the Shipped
    link; viability row (`:101`) updated; Shipped table row; ICR Phase 4
    marked shipped in `INTERNATIONAL_COVERAGE_ROADMAP.md`.
  - Fill the design plan's "Implementation notes" section, mark it
    `IMPLEMENTED`, then **move the plan set (design plan + this file) to
    `docs/plans/`**, updating references (incl. the planning-README link).
- Acceptance: the sweep recorded in this file (tracker section) or the commit
  message; full gate green; every box of the design's checklist satisfied.
- Commit: `docs: Record global wildfire detection (NASA FIRMS)`
- Depends on: T5, T6

## Assumptions to confirm before `/run-plan`

- **A1 — CHANGELOG state.** `[Unreleased]` is empty; this feature opens it and
  ships as v1.20.0. The version bump stays a release step, not a task.
- **A2 — optional trailing services.** `handleGetWildfireInfo` gains
  `firmsService?`, `nominatimService?` appended last and optional, so
  `tests/unit/wildfire-handler.test.ts`'s four-argument call passes unedited.
  Production always injects both; absent `nominatimService` → silent `isInUS`
  fallback, absent `firmsService` on a FIRMS route → NIFC path (today's
  behavior).
- **A3 — key-rejection signal.** `FIRMSKeyRejectedError extends Error` with a
  fixed sanitized message (no `ApiError` union change) is how the handler
  distinguishes D3's fall-back-with-note case from ordinary failures.
- **A4 — clustering centroid policy.** Centroids are running means updated on
  each assignment, ties broken by creation order — deterministic under the
  FRP-descending sort; the policy is documented in a code comment.
- **A5 — regional insets are best-effort.** Derived conservatively from FIRMS'
  coverage map; any uncertainty shrinks the inset or drops the region (Global
  fallback is always correct). The Middle East gap → Global is expected, not
  a bug.
- **A6 — casing.** Country codes normalize to lowercase at the router
  boundary (alerts A6 precedent).
- **A7 — fixtures are trimmed.** Multi-MB CSV captures are never committed;
  fixtures preserve both live header variants in miniature and the < 2 s test
  budget.
- **A8 — keyless day_range.** The keyless path always serves the fixed 24 h
  files; `day_range > 1` without a key renders the 24 h result plus the
  upgrade note (D6), never an error.

## Progress Tracker

- [x] T1 — `FIRMS_MAP_KEY` config + `.env.example` (`haiku`) — `3d2d579`
- [x] T2 — FIRMS types + pure hotspot module (`sonnet`) — `1e520a8` (orchestrator tightened the US–Canada border-band insets: Canada south bound 50°N, CONUS split at −95° with a 47°N/41°N cap, border cities → Global)
- [x] T3 — `FIRMSService` + cache TTLs (`sonnet`) — `5dc4433`
- [x] T4 — Country routing + FIRMS renderer in `get_wildfire_info` (`opus`) — `9dbcef4` (mechanical addition: the keyed-path bbox is clamped to ±90/±180 before `getDetectionsByBbox`, since the service validates corners the NIFC path never did; sanity: Toronto → FIRMS/Global file, Sacramento auto → NIFC, Sacramento `source:'firms'` → FIRMS, locked test unedited)
- [x] T5 — Routing unit tests (`sonnet`) — `2dcbe8f`
- [x] T6 — Integration tests: mocked shapes + tolerant keyless live smoke (`sonnet`) — `1e2b24f` (mock/live split via per-instance client spies, the almanac `AcisService` pattern — no module-level `vi.mock`)
- [x] T7 — Live acceptance sweep + documentation checklist (`opus`) — `0328385` (+ `6387c5a`: sweep finding — Area-API day ranges are calendar UTC days vs the flat files' rolling 24 h; keyed path now requests +1 day and window-filters; Europe inset shrunk to 35°E). Sweep 2026-08-14 against the built dist, all 8 points pass: (1) Toronto → FIRMS via reverse-country, Global file; (2) Sacramento auto byte-identical to `main`; (3) Sacramento `source:'firms'` → FIRMS framing in the US; (4) southern Africa (−15, 28) clusters with count/distance/bearing/FRP/age, 5/25 caps + remainder notes, keyed rolling-24h = the ≤24 h subset of the laggy keyless file; (5) `day_range: 3` keyed → 87 detections "last 3 days" / keyless → upgrade note / bogus key → rejection note + keyless data; (6) mid-ocean → no-detections + not-all-clear caveat; (7) Riyadh → Global fallback (debug logs); (8) Vienna→Bratislava → one Europe fetch then cache hit. Inset spot-checks: Southern_Africa and Canada extents comfortably contain their insets; Europe shrunk to match.

**Done when:** every box is ticked with its commit SHA, the full gate
(`npm run build`, `npm test`, `npm audit`) is green, the T7 live acceptance
points are demonstrably met against the built dist (Toronto → FIRMS,
Sacramento byte-identical vs `main`, US `source: 'firms'`, active-region
clusters, all three key modes, ocean not-all-clear, Global-file gap fallback,
regional-file cache single-fetch), `tests/unit/wildfire-handler.test.ts`
passes unedited, and `docs/plans/global-wildfire-plan.md` is marked `IMPLEMENTED`
with the plan set moved to `docs/plans/`. Opening the PR is the human's call.
