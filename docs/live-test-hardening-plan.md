# Live-Test Hardening (2026-08) — Design Plan

**Status:** PLANNED
**Parent:** Full-suite live test of 2026-08-13 against the `feat/metar` build (all
17 tools, US + international + unit-variant servers). Raw outputs and the issue
log live in the local `saved-forecasts/` folder (gitignored — personal
locations), so this plan is self-contained: every finding is restated here with
enough repro detail to work from.
**Branch (for /impl-plan):** `fix/live-test-hardening` off `main` — all five
findings are pre-existing (none are METAR/almanac regressions), so they don't
belong on `feat/metar`. If `feat/metar` merges first, rebase and ride the next
release; otherwise target the release after v1.17.0.
**Priority order:** F1 (silent data loss) > F2 (stale data presented as current)
> F3 (alarmist safety messaging) > F4, F5 (polish).

## What / Why

The live test passed every feature (v1.14 default location, v1.16 almanac +
records, v1.17 METAR, and all pre-existing tools) but surfaced one bug, one
data-quality gap, and three polish items:

- **F1 (Medium, silent data loss):** `save_location`'s documented "smart
  update" drops `description`, `alternateNames`, and `notes` on any partial
  update. Repro: save an alias with all metadata fields → call
  `save_location(alias, activities=[...])` → the three fields are gone from
  `~/.weather-mcp/locations.json`. Only `activities` (and name/coords/geo) have
  preserve logic.
- **F2 (Medium, data quality):** the NOAA path of `get_current_conditions`
  serves whatever the chosen station's latest observation is — however old —
  titled "Current Weather Conditions" with no age indication. Live repro:
  station KMOP had been dark for **2 days**; the NOAA path served its Aug 11
  observation as current, while the v1.17 METAR path independently proved the
  staleness by skipping KMOP for a fresh neighbor (KGDW). Also surfaces in
  `get_weather_summary`'s current section and as a silent truncation in NOAA
  recent-date `get_historical_weather`.
- **F3 (Low-Medium, alarmist messaging):** the wildfire safety assessment is
  distance-only. Live repro (Boise): a fire 2.5 km away that was **100%
  contained** for weeks still produced "⚠️ EXTREME DANGER — Evacuate
  immediately if advised by authorities."
- **F4 (Low, polish):** `get_marine_conditions` for a point ~60 mi inland
  (lower-Michigan test point) returned a "Lake Huron" report (calm, 0.0 kn)
  with nothing telling the user the data describes a distant water body.
- **F5 (Cosmetic, docs-only):** `get_historical_weather` date bounds are
  interpreted as UTC midnights, so a US-eastern request for `2026-08-10 →
  2026-08-12` includes observations from the evening of Aug 9 local time.
  Behavior is fine; it's just undocumented.

## Design decisions (settled)

### D1. Preserve all metadata on saved-location updates (fixes F1)

`src/handlers/savedLocationsHandler.ts`: the partial-update branch (lines
~121-135) preserves name/coords/timezone/geo/activities, but the final
`locationStore.set` (lines ~184-196) writes `description: saveArgs.description`
(and likewise `alternateNames`, `notes`) — `undefined` whenever omitted.

- Extend the preserve-when-omitted contract to the three metadata fields, on
  **any** update to an existing alias (both the partial-update path and a full
  re-save with coordinates — silent loss is wrong in both):
  - omitted (`undefined`) → keep the stored value;
  - explicitly empty (`""` for strings, `[]` for arrays) → clear the field,
    mirroring the existing `activitiesProvided` semantics (empty array clears).
- Implementation shape: `provided`-style flags or `saveArgs.description !==
  undefined ? saveArgs.description : existing?.description` at the `set` call;
  follow the existing `activitiesProvided` pattern for consistency. Normalize
  cleared fields to `undefined` in storage (don't persist empty strings).
- Update the tool description's SMART UPDATES sentence to state that **all**
  unspecified fields are preserved and how to clear one.

### D2. Observation age + freshness on the NOAA current-conditions path (fixes F2)

Two parts, both in `formatNOAACurrentConditions`
(`src/handlers/currentConditionsHandler.ts`, Time line at ~254):

- **D2a — transparency (always):** render the observation's age next to its
  timestamp, exactly like the METAR path does: `**Time:** Aug 11, 2026, 12:15
  PM (2 days ago)`. Reuse the METAR path's age-formatting helper (extract it to
  a shared util if it's currently module-local).
- **D2b — stale caveat:** when age exceeds a threshold, append a warning block:
  `⚠️ **This observation is N old** — the station may have stopped reporting.
  Conditions may have changed substantially.` Add the threshold to
  `src/config/displayThresholds.ts` (e.g. `currentConditions.staleWarning`)
  rather than hardcoding; default **2 hours** (NOAA stations report at least
  hourly, so 2h means ≥2 missed cycles; METAR's own bands are 90 min/6 h).
- **D2c — fresher-station retry (the substantive fix):** the NOAA service
  currently takes the gridpoint's first station and its latest observation.
  When that observation is older than the acceptance window (reuse METAR's 6 h
  outer bound, also via config), try the next stations in the gridpoint
  station list (cap at 3 total attempts) and use the first fresh one, noting
  the substitution: `*Nearest station (KMOP) has not reported since <time>;
  showing <name> (KGDW) instead.*` If none are fresh, fall back to the nearest
  station's observation with the D2b warning — never error where today
  succeeds.
- Scope: `get_current_conditions` NOAA path only (auto-inherited by
  `get_weather_summary`). The historical-handler truncation gets **no
  behavioral change** — add one note line when the newest returned observation
  is older than the requested end by more than the stale threshold
  (`*Observations end <time>; the reporting station may have gone offline.*`).
- Accepted cost: up to 2 extra NOAA round-trips in the (rare) stale case;
  cached like other station observations.

### D3. Containment-aware wildfire safety assessment (fixes F3)

`src/handlers/wildfireHandler.ts` (~line 166): the assessment tier is chosen
from the nearest fire's distance alone.

- Compute the escalation tier from the nearest fire **whose containment is
  < 100%** (field already parsed at line ~102, default 0). Fully-contained
  fires still appear in the fire list exactly as today.
- When exclusion changes the picture (a fully-contained fire is nearer than the
  tier-driving fire, or all fires in radius are contained), say so in the
  assessment: `ℹ️ Nearest fire (<name>, <dist>) is 100% contained and excluded
  from the danger assessment.` / `ℹ️ All fires within radius are 100%
  contained.` — capping at AWARENESS in the all-contained case.
- Deliberately **not** factoring size or days-active into tiers — containment
  is the one field that cleanly means "no longer spreading"; anything more is
  speculative risk modeling this tool shouldn't do.

### D4. Water-body disclosure on the NOAA marine path (fixes F4)

`src/handlers/marineConditionsHandler.ts` uses `shouldUseNOAAMarine` (bounding
regions for the Great Lakes and major bays) and reports whatever the gridpoint
returns, titled with the detected region.

- Modest fix, no geography rework: on the NOAA marine path, always add one
  disclosure line under the header: `*Conditions describe <region> — the
  nearest covered water body, which may be distant from the requested point.*`
- Do **not** attempt inland detection (distance-to-shore data isn't available
  without a new dependency); the disclosure plus the existing
  not-for-navigation disclaimer is proportionate. Open-Meteo path unchanged
  (it already reports for the exact coordinates).

### D5. Document UTC date bounds in historical weather (fixes F5)

Docs-only:

- `get_historical_weather` tool description (`src/index.ts`): add "Dates are
  interpreted as UTC calendar days; for US timezones the range may include the
  prior local evening."
- One line in README's historical section if it discusses date ranges.

### D6. Tests (Vitest, all mocked, gate stays green)

- **Saved locations** (extend existing saved-locations tests):
  - create with description/alternateNames/notes → activities-only update →
    all three preserved (the exact live repro);
  - explicit `""`/`[]` clears the field; omitted keeps it;
  - full re-save with new coordinates but omitted metadata → metadata
    preserved;
  - new-location save persists all provided fields (regression guard).
- **NOAA staleness** (`tests/unit/` current-conditions):
  - fresh observation → age suffix present, no warning, no station retry;
  - stale observation (>2 h) with a fresh second station → substitution note +
    second station's data;
  - all stations stale → nearest station's data + stale warning block;
  - station-list fetch capped at 3 attempts (assert the fake's call count);
  - historical: response ending early relative to requested end → note line.
- **Wildfire:** nearest fire contained + farther active fire → tier from the
  farther fire + exclusion note; all contained → AWARENESS + note; nearest
  fire uncontained → byte-identical to today (regression guard).
- **Marine:** NOAA path output contains the disclosure line; Open-Meteo path
  unchanged.
- All existing tests pass untouched; any fixture that encodes the
  drop-on-update behavior gets corrected as part of the fix and called out in
  the commit message.

## Out of scope / deferred

- Refining `shouldUseNOAAMarine` regions or true inland detection (F4 gets the
  disclosure line only).
- Localized (non-UTC) date-range interpretation for historical weather.
- NOAA staleness handling beyond the 3-station retry (e.g., falling back to
  the METAR feed or Open-Meteo — cross-source substitution contradicts the
  measurement-vs-estimate separation the METAR release just established).
- Lightning live-strike rendering verification — not a code change; re-run the
  live test during active weather.
- Wildfire risk modeling beyond the containment gate (size/age weighting).

## Acceptance (feature-level)

1. The live F1 repro (create-with-metadata → activities-only update) leaves
   `description`, `alternateNames`, and `notes` intact in
   `~/.weather-mcp/locations.json`; explicit empty values still clear.
2. A mocked 2-day-old NOAA observation renders an age suffix, a stale warning,
   and — when the gridpoint offers a fresh alternative station — that
   station's data with a substitution note.
3. A mocked 100%-contained fire at 2.5 km with no other fires yields an
   AWARENESS-level assessment with the contained note, not EXTREME DANGER.
4. NOAA-path marine output always names the water body with the
   may-be-distant disclosure.
5. `get_historical_weather`'s tool description states the UTC interpretation.
6. Full gate green: `npm run build`, `npm test`, `npm audit`.

## Expected touch set

| File | Change |
|------|--------|
| `src/handlers/savedLocationsHandler.ts` | preserve/clear semantics for description, alternateNames, notes |
| `src/handlers/currentConditionsHandler.ts` | age suffix, stale warning, fresher-station retry (NOAA path) |
| `src/services/noaa.ts` | expose station-list iteration for the retry (if not already reachable) |
| `src/handlers/historicalWeatherHandler.ts` | early-end note on NOAA recent path |
| `src/handlers/wildfireHandler.ts` | containment-aware tier + exclusion notes |
| `src/handlers/marineConditionsHandler.ts` | NOAA-path water-body disclosure line |
| `src/config/displayThresholds.ts` | stale-warning + stale-acceptance thresholds |
| `src/index.ts` | historical tool description (UTC dates); save_location SMART UPDATES wording |
| `tests/unit/…` | new/extended tests per D6 |
| `CHANGELOG.md`, `CLAUDE.md`, `docs/planning/README.md` | changelog entry, status blurb, index row |
