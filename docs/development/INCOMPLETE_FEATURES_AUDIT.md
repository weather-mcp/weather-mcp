# Incomplete Features Audit

**Date:** 2026-06-21
**Scope:** `src/` (excludes `dist/`, `node_modules/`, `tests/`)
**Purpose:** Catalog functions/features that are stubbed, partially implemented, or
deliberately simplified, so we can decide per item whether to **implement** or **trim**.

This document is a decision aid — for each item there's a description of intended
behavior, current behavior, blast radius (callers/tests), and a recommendation.

---

## Summary

| # | Feature | Location | Status | Resolution |
|---|---------|----------|--------|------------|
| 1 | NCEI climate normals | `src/services/ncei.ts` | ✅ **Implemented** | Done — NOAA CDO normals |
| 2 | Satellite imagery | `src/services/gibs.ts`, `weatherImageryHandler.ts` | ✅ **Implemented** | NASA GIBS GOES GeoColor (RainViewer satellite was discontinued — see DATA_SOURCE_BLOCKERS.md) |
| 3 | Imagery `layers` parameter | (removed) | ✅ **Trimmed** | No backing capability after RainViewer transition |
| 4 | Coordinate→timezone heuristic | `src/utils/timezone.ts` | ✅ **Implemented** | Replaced with `tz-lookup` (accurate global) |
| 5 | `getAllNWPSGauges` (full catalog) | `src/services/noaa.ts` | ✅ **Resolved** | Kept as fallback + added `securityEvent` warning log |

> **All audited items are now resolved.** Details below are kept for historical context.
> External-data-source caveats (RainViewer discontinuation, satellite "latest only", NCEI
> rate limits) are tracked in [`DATA_SOURCE_BLOCKERS.md`](./DATA_SOURCE_BLOCKERS.md).

---

## 1. NCEI Climate Normals — ✅ Implemented this session

**File:** `src/services/ncei.ts` — `getClimateNormals()`

**Intended:** Return official NOAA 1991–2020 climate normals (daily high/low temp,
precipitation) for US locations via the Climate Data Online (CDO) API.

**Previous state:** Placeholder that threw `DataNotFoundError` before any HTTP call,
always falling back to Open-Meteo computed normals. The token was never used.

**Current state:** Fully implemented:
- Finds nearby stations carrying daily normals (`NORMAL_DLY`) via a bounding-box
  `/stations` query, sorted by Haversine distance (expands the box once if empty).
- Reads `DLY-TMAX-NORMAL` / `DLY-TMIN-NORMAL` (°F via `units=standard`) for the
  requested month/day, probing up to 4 nearest stations for complete data.
- Reads the monthly `MLY-PRCP-NORMAL` and divides by days-in-month for a daily value.
- Handles Feb-29 (reference year 2010 is non-leap → clamps to Feb 28), missing-value
  sentinels (e.g. `-7777`), rate limits (429 → `RateLimitError`), and auth errors.
- Caches results indefinitely (normals don't change).

**Validated live:** Seattle, Denver, Miami, Chicago (Feb 29) all return correct
NCEI-sourced normals; mid-ocean correctly throws `DataNotFoundError` → Open-Meteo
fallback. Unit tests rewritten with mocked HTTP (no live calls).

**Recommendation:** Done. No further action.

---

## 2. Satellite Imagery — ❌ Stub

**File:** `src/handlers/weatherImageryHandler.ts:84-92`
**Tool:** `get_weather_imagery` with `type="satellite"`

**Intended:** Provide satellite imagery (cloud/thermal/visible) for a location,
alongside the working `precipitation`/`radar` types.

**Current behavior:** Throws `ValidationError`:
> `Satellite imagery is not yet implemented. Use type="precipitation" or type="radar" for precipitation radar.`

The tool schema in `src/index.ts` still advertises `satellite` as a valid `type` enum
value, so a user can request it and only then hit the error.

**Callers / tests:**
- Reachable from `src/index.ts` `get_weather_imagery` dispatch.
- `tests/integration/visualization-lightning.test.ts:102` explicitly asserts it
  rejects with `'not yet implemented'` — so trimming or implementing requires updating
  that test.

**Options:**
- **Implement:** integrate NOAA GOES-16/19 imagery (e.g., via NOAA STAR / NESDIS tiles
  or RealEarth). Non-trivial: tiling, layer selection, time steps.
- **Trim:** remove `satellite` from the `type` enum + the handler branch, and update the
  integration test. Smallest footprint; honest about supported capabilities.

**Recommendation:** **Trim unless satellite imagery is on the near-term roadmap.**
Advertising an enum value that always errors is a poor UX. Trimming is ~15 minutes;
implementing is a multi-day feature. (Tie this decision to item 3.)

---

## 3. Imagery `layers` Parameter — ⚠️ Accepted but ignored

**Files:** `src/index.ts:438-444` (schema), `src/handlers/weatherImageryHandler.ts:35-43` (validation)
**Tool:** `get_weather_imagery`, `layers` argument

**Intended:** Let callers request optional overlay layers in the returned imagery.
Schema description literally says *"(future enhancement)"*.

**Current behavior:** The parameter is type-checked (must be an array, ≤10 items) but is
**never read after validation** — it is not passed to `rainViewerService` or used
anywhere. It has no effect on output.

**Callers / tests:** No test depends on `layers` having an effect (only validation).

**Options:**
- **Implement:** define a concrete set of supported overlays and thread them through to
  the imagery service. Only meaningful if the underlying provider supports overlays.
- **Trim:** remove the `layers` property from the schema and the handler validation.
  Removes a misleading no-op parameter.

**Recommendation:** **Trim.** RainViewer (the current provider) doesn't expose arbitrary
overlay layers, so the parameter promises something we can't deliver today. Remove it;
re-add with a real implementation if/when a provider supports it.

---

## 4. Coordinate→Timezone Heuristic — ⚠️ Simplified by design

**File:** `src/utils/timezone.ts:121` — `guessTimezoneFromCoords()`

**Intended:** Best-guess IANA timezone from coordinates, used as a fallback when an API
doesn't return a timezone (e.g., river conditions formatting).

**Current behavior:** Longitude-banded mapping for the contiguous US
(`America/New_York|Chicago|Denver|Los_Angeles`); everything else returns `UTC`. The code
itself flags this as "simplified" and suggests `tz-lookup` / `@photostructure/tz-lookup`
for accurate global coverage.

**Known limitations:**
- No Alaska/Hawaii, US territories, or Arizona (no-DST) handling.
- All non-contiguous-US locations get `UTC` (predictable but not local).

**Callers:** River conditions handler and other time-formatting paths.

**Options:**
- **Implement:** add a `tz-lookup` dependency for accurate global coordinate→timezone.
  Small, well-bounded improvement (one dep, swap the function body).
- **Keep:** the current behavior is intentional and "predictable" (UTC) — acceptable for
  a primarily-US tool.

**Recommendation:** **Keep for now; consider `tz-lookup` if non-US time accuracy matters.**
This is a deliberate simplification, not a broken stub. Low priority.

---

## 5. `getAllNWPSGauges()` — ⚠️ Deprecated, still used as fallback

**File:** `src/services/noaa.ts:693` (marked `@deprecated`)

**Intended:** (Legacy) fetch all NWPS river gauges. Superseded by
`getNWPSGaugesInBoundingBox()`.

**Current behavior:** Still invoked as the **fallback** inside
`getNWPSGaugesInBoundingBox()` if the bounding-box query throws. It downloads the entire
~13 MB / ~12,700-gauge catalog — the exact heavy path the v1.7.1 fix was designed to
avoid. With the corrected bbox query now working, the fallback should rarely (if ever)
trigger, but it remains a latent expensive code path.

**Callers:** `getNWPSGaugesInBoundingBox()` catch block only.

**Options:**
- **Keep:** retain as a genuine last-resort fallback (defensive). Document that it's a
  heavy path.
- **Trim:** remove the deprecated method and the fallback; let bbox failures surface as
  errors (the handler already degrades gracefully with a user-facing message).

**Recommendation:** **Keep as fallback, but verify it still works** (the response-shape
fix in v1.7.1 updated both methods). Optionally add a `securityEvent`/warning log when
the fallback fires so we'd notice if the bbox query regresses. Low priority.

---

## Non-issues (reviewed, no action)

These matched incompleteness keywords but are **not** stubs:
- `riverConditionsHandler.ts:85`, `wildfireHandler.ts:164` — "Temporary service
  unavailability" is user-facing error copy.
- `wildfireHandler.ts:57` — user note about NIFC data coverage.
- `weatherImageryHandler.ts:64-65` — scope comments tied to item 2.

---

## Suggested decision order

1. **Items 2 + 3 together** (weather imagery): decide implement-vs-trim. Recommendation
   is to **trim both** unless satellite/overlays are roadmapped — this also tidies the
   `get_weather_imagery` schema. Requires updating one integration test.
2. **Item 5:** low-risk; add a fallback warning log, keep otherwise.
3. **Item 4:** optional polish; add `tz-lookup` only if global time accuracy is a goal.
