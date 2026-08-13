# Live-Test Hardening — Implementation Plan

**Status:** READY (2026-08-13)

Execution plan for `docs/live-test-hardening-plan.md` (the WHAT/WHY); rules live
in `docs/orchestration-playbook.md`.

## Kickoff

A fresh Opus session should run this with:

```
/run-plan docs/live-test-hardening-implementation-plan.md
```

Or, equivalently: read `docs/live-test-hardening-plan.md` (design),
`docs/orchestration-playbook.md` (rules of engagement), and this file, then
execute the task graph below — green baseline, one subagent per task, review the
diff, run the gate yourself, commit, tick the tracker, push.

The gate after every task, from `weather-mcp/`:

```bash
npm run build     # 0 errors
npm test          # 100% pass
npm audit         # no high/critical
```

**Gate caveat (standing):** five files under `tests/integration/` make **live
network calls** and flake independently — `visualization-lightning.test.ts`,
`safety-hazards.test.ts`, `global-rivers.test.ts`, `almanac.test.ts`, and
`metar.test.ts`. If the gate goes red only in those files, re-run before
suspecting the diff.

## Scope & branch

**Branch:** `fix/live-test-hardening` off `main` — the design plan names this
branch explicitly (all five findings are pre-existing, none are METAR/almanac
regressions), overriding the default `feat/<name>` convention. Target: the
release after v1.17.0.

⚠️ **Branch-base decision (Assumption A1):** the design plan and this file
currently live only on `feat/metar`, and T1's age-helper extraction targets the
METAR rendering code, which also exists only there. **Recommended: merge
`feat/metar` (v1.17.0) to `main` first, then cut `fix/live-test-hardening` from
the updated `main`** — the plan docs arrive with it and T1 is a clean
extraction. If the fix must start before that merge: cherry-pick the two plan
docs onto the new branch as a first `docs:` commit, and T1 *creates* the shared
age helper fresh (same format) instead of extracting it; `feat/metar` adopts it
at its own rebase. Everything else in this plan is identical either way, since
none of the five touched handlers except `currentConditionsHandler.ts` differ
between `main` and `feat/metar`. Resolve A1 before `/run-plan`.

In scope: the design plan's D1–D6 — saved-location metadata preservation,
NOAA current-conditions observation age + stale warning + fresher-station
retry, the historical early-end note, the containment-aware wildfire
assessment, the NOAA-marine water-body disclosure, the UTC-dates documentation,
and the D6 test matrix.

### Deferred / out of scope

| Item | Reason |
|------|--------|
| Refining `shouldUseNOAAMarine` regions / true inland detection | Design defers — F4 gets the disclosure line only; distance-to-shore needs a new dependency. |
| Localized (non-UTC) historical date-range interpretation | Design defers — F5 is docs-only; behavior is fine. |
| Cross-source staleness fallback (METAR or Open-Meteo when all NOAA stations are stale) | Design defers — contradicts the measurement-vs-estimate separation the METAR release established. |
| Lightning live-strike rendering verification | Not a code change; re-run the live test during active weather. |
| Wildfire risk modeling beyond the containment gate (size/age weighting) | Design defers — containment is the one field that cleanly means "no longer spreading". |

## Findings that shape the graph

Spot-checks against the code, reconciled into the tasks below:

- **The METAR "age helper" is inline, not a function** —
  `currentConditionsHandler.ts:903–907` on `feat/metar` computes the age string
  in place (`'just now'` / `N minutes ago` / `X hours ago`, from
  `pick.ageMinutes`). T1 extracts it into a shared helper and **adds a days
  band** (≥ 48 h → `N days ago`) so the F2 live repro renders "(2 days ago)" as
  the design shows. Extraction is byte-safe for the METAR path: the picker
  rejects anything over 6 h, so METAR ages never reach the new band —
  `tests/unit/metar-handler.test.ts` passing untouched is the guard.
- **Existing NOAA fixtures will trip the new staleness logic.**
  `tests/unit/current-conditions-global.test.ts:56` builds observations with
  `timestamp: '2024-01-01T12:00:00+00:00'` — ~2.7 years old against a real
  clock, so after T3 every existing NOAA-path test would render a huge age, the
  stale warning, and retry attempts. T3 therefore pins the clock
  (`vi.setSystemTime` near the fixture timestamps) in the affected files.
  **These test edits are expected and disclosed** — this fix intentionally
  changes NOAA-path output, unlike the METAR plan's "untouched" rule for the
  same file. Sweep `tests/unit/weather-summary-handler.test.ts` for the same
  hazard.
- **The retry loop belongs in the handler; `noaa.ts` needs no change.**
  `getStations` (`noaa.ts:414`) and `getLatestObservation` (`:438`) are already
  public — the design's "expose station-list iteration (if not already
  reachable)" is satisfied as-is. The handler currently calls the convenience
  wrapper `noaaService.getCurrentConditions` (`:526`, first-station-that-
  answers) *and separately* re-fetches the station list just for the timezone
  (`currentConditionsHandler.ts:196–208` on `main`). T3 collapses this: one
  `getStations` call drives the freshness loop, and the *chosen* station's
  `properties.timeZone` / `name` / `stationIdentifier` feed the clock and the
  substitution note. The wrapper stays in place, unused by the handler (it's
  public API; fakes in several test files still implement it).
- **Test fakes implement `getCurrentConditions` + `getStations`**
  (`current-conditions-global.test.ts:95–101`). T3's handler change means NOAA
  fakes also need `getLatestObservation`; call-count assertions for the retry
  cap hang off that spy.
- **Wildfire assessment picker is one line** —
  `wildfireHandler.ts:160`: `firesWithDistance.find(f => f.fire.type ===
  'Wildfire')`. Containment is already parsed at `:102`
  (`attrs.attr_PercentContained || 0`). T5 changes the find predicate to
  `&& f.fire.containment < 100` and adds the two ℹ️ notes; the fire *list*
  rendering (`:145`) is untouched.
- **Marine disclosure has an obvious anchor** — `formatNOAAMarineConditions`
  (`marineConditionsHandler.ts:157`) opens with `# Marine Conditions Report -
  ${region}` then `**Region:** ${region}`. The disclosure line lands directly
  under the header. No existing unit test asserts NOAA-marine output
  (`marine-forecast.test.ts` is Open-Meteo-only), so T6 adds a small one.
- **Historical early-end note anchor** — the NOAA recent path formats
  observations at `historicalWeatherHandler.ts:279–302`; the note compares the
  newest `props.timestamp` across `observations.features` (don't assume sort
  order) against the effective NOAA end time (`noaaEndTime`, already capped at
  now) using the T1 threshold.
- **Both `src/index.ts` description edits are single strings** — SMART UPDATES
  wording at `:614`, `get_historical_weather` description at `:373`. T2 and T7
  each touch `index.ts`, so they are **not** parallel-safe with each other.
- **F1's shape is exactly as designed** — the partial-update branch
  (`savedLocationsHandler.ts:121–134`) preserves coords/name/geo/activities via
  the `activitiesProvided` flag pattern, but the `locationStore.set` call
  (`:184–196`) writes `saveArgs.description/alternateNames/notes` raw —
  `undefined` whenever omitted, and on **both** the partial-update and
  full-re-save paths. The fix mirrors `activitiesProvided` for all three
  fields at the `set` site, normalizing cleared values (`""`/`[]`) to
  `undefined` in storage.

## Task graph

### Phase 1 — Foundation

**T1 — Staleness thresholds + shared observation-age helper** (`sonnet`)

- Files: `src/config/displayThresholds.ts`, `src/utils/timezone.ts`,
  `src/handlers/currentConditionsHandler.ts` (METAR call site only, if on a
  post-METAR base — see A1), `tests/unit/timezone.test.ts`
- Add to `DisplayThresholds` a `currentConditions` block with rationale
  comments:
  - `staleWarningMinutes: 120` — NOAA stations report at least hourly, so 2 h
    means ≥ 2 missed cycles (D2b);
  - `staleAcceptanceMinutes: 360` — METAR's outer acceptance bound, reused as
    the retry trigger (D2c);
  - `maxStationAttempts: 3` — total stations whose observations are fetched,
    including the first (A5).
- Add `formatObservationAge(ageMinutes: number): string` to
  `src/utils/timezone.ts`: `'just now'` at 0, `N minute(s) ago` under 60,
  `X hours ago` (one decimal, as the METAR code rounds today) under 48 h,
  `N day(s) ago` at ≥ 48 h. Replace the inline METAR expression
  (`currentConditionsHandler.ts:903–907`) with a call to it — output must stay
  byte-identical for ages ≤ 6 h.
- Acceptance: full gate green; `tests/unit/metar-handler.test.ts` passes
  **untouched**; new `timezone.test.ts` cases cover all four bands and both
  boundary edges (59/60 min, just-under/over 48 h).
- Commit: `refactor: Add staleness thresholds and shared observation-age helper`
- Depends on: — · **parallel-safe with T2** (disjoint files)

### Phase 2 — Priority fixes (F1, F2)

**T2 — Preserve saved-location metadata on updates (F1/D1)** (`sonnet`)

- Files: `src/handlers/savedLocationsHandler.ts`, `src/index.ts` (`:614`
  SMART UPDATES sentence), `tests/unit/saved-locations-activities.test.ts`
  and/or a new `tests/unit/saved-locations-metadata.test.ts`
- Extend the preserve-when-omitted contract to `description`,
  `alternateNames`, and `notes` on **any** update to an existing alias — both
  the partial-update path and a full re-save with coordinates:
  - omitted (`undefined`) → keep the stored value;
  - explicitly empty (`""` for strings, `[]` for arrays) → clear, mirroring
    `activitiesProvided`; normalize cleared fields to `undefined` in storage
    (never persist empty strings/arrays).
  - Follow the existing `activitiesProvided` flag pattern for consistency; the
    confirmation output should reflect the *effective* (post-merge) values,
    not just `saveArgs`.
- Rewrite the SMART UPDATES sentence in the `save_location` description: all
  unspecified fields are preserved on update; pass an empty value to clear one.
- Tests (D6, the exact live repro first): create with all three metadata
  fields → activities-only update → all three intact; explicit `""`/`[]`
  clears while omitted keeps; full re-save with new coordinates but omitted
  metadata → metadata preserved; new-location save persists all provided
  fields (regression guard).
- Acceptance: full gate green; the F1 repro test passes; existing
  saved-locations tests pass (any fixture that *encoded* the drop-on-update
  behavior gets corrected and called out in the commit message).
- Commit: `fix: Preserve saved-location metadata on partial updates`
- Depends on: — · **parallel-safe with T1** (disjoint files)

**T3 — Observation age, stale warning, fresher-station retry (F2/D2a–c)** (`opus`)

- Files: `src/handlers/currentConditionsHandler.ts`,
  `tests/unit/noaa-staleness.test.ts` (new),
  `tests/unit/current-conditions-global.test.ts` (clock pinning only),
  `tests/unit/weather-summary-handler.test.ts` (clock pinning if needed)
- Rework `formatNOAACurrentConditions`'s data acquisition: one
  `noaaService.getStations` call, then iterate the station list —
  1. fetch `getLatestObservation` for the station; a fetch error means "try
     the next station" (today's behavior, preserved);
  2. if the observation's age ≤ `staleAcceptanceMinutes`, use it; stop;
  3. otherwise keep it as the fallback candidate (first successful fetch =
     nearest) and continue, up to `maxStationAttempts` total fetches;
  4. nothing fresh → use the fallback candidate; **never error where today
     succeeds** (all fetches failing throws, exactly as today).
  - Derive timezone from the **chosen** station's `properties.timeZone`
    (dropping the separate stations re-fetch), falling back to
    `guessTimezoneFromCoords` as today.
- Rendering:
  - **D2a (always):** `**Time:** <formatted> (<formatObservationAge(...)>)`.
  - **D2c note (on substitution):** `*Nearest station (<ID>) has not reported
    since <time>; showing <name> (<ID>) instead.*` — degrade gracefully to
    "has not reported recently" when the nearest station's fetch errored (no
    timestamp to show).
  - **D2b (age > `staleWarningMinutes`, after any retry):** `⚠️ **This
    observation is <duration> old** — the station may have stopped reporting.
    Conditions may have changed substantially.`
  - `noaaService.getCurrentConditions` stays in `noaa.ts`, unchanged.
- Tests (new file, real handler + fakes per `current-conditions-global.test.ts`
  patterns, `vi.setSystemTime` throughout): fresh observation → age suffix,
  no warning, exactly one `getLatestObservation` call; stale first + fresh
  second station → substitution note + second station's data; all stale →
  nearest station's data + D2b warning, no substitution note; five stale
  stations → exactly 3 `getLatestObservation` calls; first-station fetch error
  + fresh second → second's data, today's silent-skip behavior (no stale
  machinery note beyond the substitution wording decision above).
- Cross-task consequence: pin the clock in
  `current-conditions-global.test.ts` (2024 fixtures, see Findings) and add
  the age suffix to any exact-output assertions there; the change flows into
  `get_weather_summary`'s current section automatically — sweep its test file
  for the same fixture-clock hazard.
- Acceptance: full gate green; all five new scenarios pass; edits to existing
  test files are limited to clock pinning + the age-suffix expectation and are
  called out in the commit message.
- Commit: `fix: Surface observation age and retry stale NOAA stations`
- Depends on: T1 · **parallel-safe with T4, T5, T6** (disjoint files)

**T4 — Early-end note on NOAA recent historical (F2/D2 scope note)** (`sonnet`)

- Files: `src/handlers/historicalWeatherHandler.ts`,
  `tests/unit/historical-routing.test.ts` (or a small new file if fakes don't
  fit)
- **No behavioral change to the data**: after formatting the NOAA recent-path
  observations (`:279–302`), compute the newest `props.timestamp` across
  `observations.features` (don't assume sort order). If it precedes the
  effective end (`noaaEndTime`) by more than
  `DisplayThresholds.currentConditions.staleWarningMinutes`, append:
  `*Observations end <time>; the reporting station may have gone offline.*`
- Tests: response ending ~2 days before the requested end → note present;
  response reaching the end → no note; `vi.setSystemTime` as needed.
- Acceptance: full gate green; existing historical tests untouched except any
  that assert full output text.
- Commit: `fix: Note early-ending NOAA historical observations`
- Depends on: T1 · **parallel-safe with T3, T5, T6** (disjoint files)

### Phase 3 — Polish fixes (F3, F4, F5)

**T5 — Containment-aware wildfire assessment (F3/D3)** (`sonnet`)

- Files: `src/handlers/wildfireHandler.ts`,
  `tests/unit/wildfire-handler.test.ts`
- Choose the escalation tier from the nearest fire whose `type === 'Wildfire'`
  **and `containment < 100`** (`wildfireHandler.ts:160`). Fully-contained
  fires keep appearing in the fire list (`:145`) exactly as today.
- Notes, only when exclusion changes the picture:
  - a contained fire is nearer than the tier-driving fire →
    `ℹ️ Nearest fire (<name>, <dist> km) is 100% contained and excluded from
    the danger assessment.`
  - wildfires exist but all are 100% contained → render the assessment at
    **AWARENESS** with `ℹ️ All fires within radius are 100% contained.`
  - no wildfires at all (only prescribed burns) → no assessment section,
    exactly as today.
- Tests (fake NIFC per existing patterns): 100%-contained fire at 2.5 km, no
  others → AWARENESS + all-contained note, not EXTREME DANGER (the live Boise
  repro); contained near + active far → tier from the far fire + exclusion
  note; nearest fire uncontained → output byte-identical to today (regression
  guard).
- Acceptance: full gate green; the three scenarios pass; existing wildfire
  tests pass untouched.
- Commit: `fix: Exclude fully contained fires from the wildfire danger assessment`
- Depends on: — · **parallel-safe with T3, T4, T6** (disjoint files)

**T6 — Water-body disclosure on NOAA marine path (F4/D4)** (`haiku`)

- Files: `src/handlers/marineConditionsHandler.ts`, plus one small test
  (extend `tests/unit/marine-forecast.test.ts` or add
  `tests/unit/marine-noaa-disclosure.test.ts` — no NOAA-path unit test exists
  yet)
- In `formatNOAAMarineConditions` (`:157`), directly under the header, always
  add: `*Conditions describe <region> — the nearest covered water body, which
  may be distant from the requested point.*`
- Open-Meteo path unchanged.
- Tests: NOAA-path output contains the disclosure line with the region name;
  an Open-Meteo-path case asserts the line is absent.
- Acceptance: full gate green; both assertions pass.
- Commit: `fix: Disclose the reported water body on NOAA marine conditions`
- Depends on: — · **parallel-safe with T3, T4, T5** (disjoint files)

**T7 — Document UTC date bounds for historical weather (F5/D5)** (`haiku`)

- Files: `src/index.ts` (`get_historical_weather` description, `:373`),
  `README.md` (historical section, if it discusses date ranges)
- Append to the tool description: "Dates are interpreted as UTC calendar days;
  for US timezones the range may include the prior local evening." One
  matching line in README if applicable.
- Acceptance: full gate green (description strings are compiled); wording
  present in both places.
- Commit: `docs: Document UTC date interpretation for historical weather`
- Depends on: T2 (shared `src/index.ts` — **not** parallel-safe with T2;
  fine beside T5/T6)

### Phase 4 — Wrap-up

**T8 — Docs, changelog, spot-check, plan closure** (`opus` — orchestrator)

- Files: `CHANGELOG.md`, `CLAUDE.md`, `docs/planning/README.md`,
  `docs/live-test-hardening-plan.md`
- CHANGELOG: one `[Unreleased]` block covering F1–F5 as Fixed/Changed items
  (no version bump — that's a release step, A7).
- `CLAUDE.md`: short status blurb for the hardening pass (per repo convention
  for unreleased content).
- `docs/planning/README.md`: add/update the row for this work per the index's
  conventions.
- **Best-effort live spot-check against the built dist** (findings were
  live-discovered; the stale-station repro cannot be forced live):
  `get_current_conditions` for a US point → age suffix renders, output
  otherwise normal; the lower-Michigan marine point → disclosure line;
  Boise wildfire → assessment no longer EXTREME if the contained fire still
  shows. Record results in the tracker. The D2c retry path stays covered by
  mocks only — that is expected.
- Mark `docs/live-test-hardening-plan.md` status `IMPLEMENTED`, then move the
  plan set (design plan + this file) to `docs/plans/` and update references,
  per the playbook and METAR precedent.
- Acceptance: full gate green; spot-check recorded; design plan marked
  `IMPLEMENTED` and plan set moved.
- Commit: `docs: Record live-test hardening fixes`
- Depends on: T1–T7

## Assumptions to confirm before `/run-plan`

- **A1 — branch base.** Merge `feat/metar` first (recommended), then cut
  `fix/live-test-hardening` from updated `main`; otherwise cherry-pick the plan
  docs and have T1 create (not extract) the age helper. See Scope & branch.
- **A2 — age-helper home.** `src/utils/timezone.ts` (it owns time display
  already); the days band (≥ 48 h) is additive and unreachable on the METAR
  path, keeping `metar-handler.test.ts` untouched.
- **A3 — retry lives in the handler.** `getStations`/`getLatestObservation`
  are already public, so `noaa.ts` is untouched; the design's touch-set row
  for it ("if not already reachable") resolves to no-op. The
  `getCurrentConditions` wrapper stays for compatibility.
- **A4 — existing test edits are expected for T3.** The 2024-dated fixtures
  in `current-conditions-global.test.ts` (and possibly the weather-summary
  tests) need clock pinning and an age-suffix expectation. Disclosed in the
  commit message; limited strictly to that.
- **A5 — "3 total attempts"** counts stations whose observation fetch was
  *made* (including the nearest), not stations skipped by list exhaustion.
- **A6 — all-contained still renders an assessment** (at AWARENESS with the
  note), rather than omitting the Safety Assessment section; "capping at
  AWARENESS" in the design reads as "show AWARENESS", and hiding the section
  would remove today's signal that fires exist nearby.
- **A7 — CHANGELOG under `[Unreleased]`**; the version bump stays a release
  step. On a post-METAR base the block sits beneath the v1.15–v1.17 content.
- **A8 — disclosure/warning wording** is taken verbatim from the design plan
  where it gives exact text (D2b, D2c, D3, D4); minor grammatical joins (e.g.
  pluralizing durations) are at the implementer's discretion.

## Progress Tracker

- [x] T1 — Staleness thresholds + shared observation-age helper (`sonnet`) — `a7a9d56`
- [x] T2 — Preserve saved-location metadata on updates (`sonnet`) — `e5d2c6b`
- [x] T3 — Observation age, stale warning, fresher-station retry (`opus`) — `0d1586f`
- [x] T4 — Early-end note on NOAA recent historical (`sonnet`) — `36c5efa`
- [x] T5 — Containment-aware wildfire assessment (`sonnet`) — `cc11237`
- [x] T6 — Water-body disclosure on NOAA marine path (`haiku`) — `def8646`
- [ ] T7 — Document UTC date bounds for historical weather (`haiku`)
- [ ] T8 — Docs, changelog, spot-check, plan closure (`opus`)

**Done when:** every box is ticked with its commit SHA, the full gate
(`npm run build`, `npm test`, `npm audit`) is green, the design plan's six
feature-level acceptance points hold (F1 repro preserved-metadata, mocked
stale-station age/warning/substitution, contained-fire AWARENESS, marine
disclosure, UTC wording, gate green), and `docs/live-test-hardening-plan.md`
is marked `IMPLEMENTED` and moved to `docs/plans/` with this file. Opening the
PR is the human's call.
