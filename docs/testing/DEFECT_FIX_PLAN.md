# Defect Fix Plan — from Live Test Report v1.8.2

**Source:** [LIVE_TEST_REPORT_v1.8.2.md](./LIVE_TEST_REPORT_v1.8.2.md) (2026-07-07)
**Status legend:** ✅ Fixed | 🔄 In progress | ⬜ Not started

> **Work-in-progress note for future sessions:** F1 and F2 are being fixed first
> (2026-07-07). F3–F7 and O1–O8 are planned but NOT yet started — pick them up
> from this table. Update the Status column and "Fixed in" column as defects land.

## Defects

| ID | Sev | Summary | Status | Fixed in |
|----|-----|---------|--------|----------|
| F1 | High | Sunrise/sunset (and daily headings) double timezone shift on Open-Meteo forecasts | ✅ Fixed | main, 2026-07-07 |
| F2 | High | Lightning tool reports "SAFE, 0 strikes" from a cold/partial strike buffer — safety false negative | ✅ Fixed | main, 2026-07-07 |
| F3 | Med | River conditions leak raw `-999` NWPS sentinels and year-1 dates; "✅ NOT DEFINED" category; missing flood-stage thresholds | ⬜ | |
| F4 | Med | Wildfire safety assessment is distance-only (1-acre fire → "HIGH ALERT / prepare for evacuation"); size 0 = "0 acres" instead of "not reported" | ⬜ | |
| F5 | Med | Satellite imagery returns dead (404) tile URLs for locations outside GOES coverage | ⬜ | |
| F6 | Low | Saved-location smart update wipes `description`/`alternateNames`/`notes` (savedLocationsHandler.ts:192-194) | ⬜ | |
| F7 | Low | Saved-location output advertises `location_name` on tools that don't support it | ⬜ | |

## Observations (polish)

| ID | Summary | Status |
|----|---------|--------|
| O1 | `days>7` at US/NOAA location silently clamped with no notice | ⬜ |
| O2 | Alerts header says "N **active** alerts" even with `active_only=false` | ⬜ |
| O3 | Non-US alerts query leaks raw NOAA "out of bounds" error instead of friendly US-only message | ⬜ |
| O4 | Historical "Period:" header off by one day (server-local `toLocaleDateString()` on naive timestamps, historicalWeatherHandler.ts:56,121,200) — same family as F1 | ⬜ |
| O5 | Historical "Number of observations" shows pre-limit count; empty-hour headings; NOAA newest-first vs Open-Meteo oldest-first | ⬜ |
| O6 | Marine landlocked "Unknown" uses 🟤 (legend: extremely dangerous); should say "not an ocean location" | ⬜ |
| O7 | River/wildfire non-US empty states say "area is clear" without disclosing US-only coverage | ⬜ |
| O8 | Saved-location list shows UTC date, detail shows local datetime | ⬜ |

## Fix Notes

### F1 — Timezone double shift (fixed)

Root cause: `DateTime.fromISO(s, { setZone: false }).setZone(tz)` parses Open-Meteo's
timezone-naive location-local ISO strings in the **server's** zone, then converts to the
location zone — applying the offset twice. NOAA strings carry explicit UTC offsets, so they
were unaffected.

Fix: parse with `{ zone: tz }` so naive strings are interpreted directly in the location
zone; offset-bearing strings keep their instant and are converted for display (Luxon
semantics), so NOAA formatting is unchanged.

Sites fixed:
- `src/utils/timezone.ts` — `formatInTimezone`, `formatDateInTimezone`,
  `formatTimeInTimezone`, `formatTimeRangeInTimezone` (shared by Open-Meteo hourly
  forecast path and others)
- `src/handlers/forecastHandler.ts` — daily heading, sunrise, sunset

Remaining same-family work is tracked as **O4** (historical handler uses plain `Date` +
`toLocaleDateString()`, needs the same treatment).

### F2 — Lightning false "SAFE" from cold buffer (fixed)

Root cause: strikes are collected into an in-memory rolling buffer fed by per-geohash MQTT
subscriptions that begin on the **first query for an area** (plus a 10 s accumulation
wait). A fresh server — or a long-running server asked about a new area — has essentially
no coverage, yet reported "🟢 SAFE, 0 strikes" for the full requested time window.

Fix:
- `BlitzortungService` tracks when each geohash was first subscribed
  (`geohashFirstSubscribed`, cleaned up on LRU eviction and stale pruning) and exposes
  `getCoverageStart(lat, lon, radius)` = the moment the *entire* queried area became
  monitored (null if any part is unmonitored/disconnected).
- `LightningActivityResponse` gains a `coverage` block (`monitoringSince`,
  `coverageMinutes`, `isComplete`).
- Handler: when coverage < requested window and no strikes were seen, the safety message
  states the result is **inconclusive**, recommendations lead with a re-check suggestion,
  and the formatter renders "SAFE (LIMITED DATA)" plus a ⚠️ limited-coverage warning and a
  "Monitoring Coverage: X of Y minutes" statistics line.

Verification for both: `npm run build`, full `npm test` suite, plus live MCP calls
(Tokyo sunrise ≈ 4:32 AM; lightning report shows limited-coverage warning on fresh server).
