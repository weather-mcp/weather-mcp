# Output Completeness — Live Verification Record

**Date:** 2026-07-17 · **Branch:** `feat/output-completeness` · **Against:** built `dist/` driving the real APIs

Companion to `docs/output-completeness-plan.md` (D1–D4 acceptance criteria) and
`docs/output-completeness-implementation-plan.md` (task tracker).

## Sweep results

| # | Check | Result |
|---|---|---|
| 1 | **D1** — AQI 7-day forecast, Phoenix (33.4484, -112.074) | ✅ Every day header carries peak UV with the current-conditions level words (`peak US AQI 63 (Moderate) · UV 10 (Very High)`); model horizon ended at 5 days and the trailing 53 no-data hours trimmed with the existing note, **no** "UV 0 (Low)" artifact; current-conditions pollutant block unchanged; hourly request carries exactly `us_aqi,european_aqi,uv_index` (unit-asserted) |
| 2 | **D2** — River, Chicago (41.8781, -87.6298), 500 km, `detail="full"` | ✅ 1,493 gauges found, exactly 25 shown, note `*1,468 additional gauges … (showing nearest 25)*` accurate; response 8.5 KB (≈2k tokens) — far inside client caps; 22/25 gauges carried a trend; zero sentinels |
| 3 | **D4** — River, Boston (42.3601, -71.0589), 100 km, default | ✅ Trend on all 5 shown gauges (tidal rise `+8.9 ft / 6h` on Boston Harbor BHBM3; steady on the four rivers) — matches the probe's 5/5 observed coverage |
| 4 | **D4** — Same at `detail="full"` | ✅ 25 gauges, 24 trends; of the 5 nearest, a forecast series renders on **BHBM3 only** (matching the probe); 10 of the full 25 have series (tidal/major gauges); 19.5 KB total; zero `-999`/year-0001 in output |
| 5 | **D2** — Wildfire, Redding CA (40.5865, -122.3917), 500 km | ✅ 12 fires found; default shows 5 + `use detail="full" for more` pointer; `full` lists all 12 with no note (≤25); `exceededTransferLimit` was not set live — caveat behavior is unit-verified both ways (10 tests) |
| 6 | **D2** — Lightning at `detail="full"` | ⚠️ Blitzortung MQTT refused connections for much of the afternoon (`read ECONNRESET`, failing the documented-flaky `tests/integration/visualization-lightning.test.ts` identically before and after this batch); the broker recovered by the final gate run (48/48 files green). A one-shot process accumulates no strike buffer, so the 25-strike listing itself rests on the 47-test lightning unit suite (30-strike fixtures at every level, statistics invariance included) |

## Found and fixed during the sweep

**NWPS placeholder observed status leaked at `detail="full"`** (commit `490117b`):
SCTM3 (Massachusetts Bay at Scituate) rendered `**Observed:** Dec 31, 1, 7:03 PM`
with category `OBS NOT CURRENT` — the observed-side twin of the forecast
placeholder v1.11.1 fixed, reachable once the gauge cap lifted to 25. Placeholder
observed statuses now render as "No current observations available".

## Operational findings

- **NWPS rate limit is real but bursty.** A `429 — Limit: 10 requests / 5 minutes`
  was observed once during probing (after live-test runs), yet back-to-back
  full-detail sweeps (26 NWPS calls each) later succeeded. The handler fetches
  stageflow nearest-first in batches of 5 and halts on the first
  `RateLimitError`, so a throttled query degrades to fewer trends, never an
  error. The 429 also surfaced why: `npm test` runs the live
  `safety-hazards.test.ts` river calls, so repeated full-suite runs share the
  budget with live checks.
- **The stageflow payload shape differed from the (dead-code) type.** The real
  `/gauges/{lid}/stageflow` response is `{observed, forecast}` series objects,
  not the flat single series `NWPSStageFlowResponse` previously declared; the
  type was corrected from a live capture before wiring (T6). Live BHBM3 observed
  rows carry `-999` in `secondary` alongside real `primary` values — per-field,
  per-point sentinel filtering is mandatory, not defensive.

## Gate

Final run 2026-07-17: `npm run build` 0 errors · `npm test` 48/48 files,
1,332/1,332 tests green (including the live integration files, after the MQTT
broker recovered) · `npm audit` 0 vulnerabilities.
