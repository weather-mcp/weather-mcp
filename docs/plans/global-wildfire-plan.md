# Global Wildfire — Design Plan

**Status:** IMPLEMENTED (2026-08-14, on `feat/global-wildfire` targeting v1.20.0)
**Parent:** `docs/planning/INTERNATIONAL_COVERAGE_ROADMAP.md` (Phase 4 — the last US-only safety tool)
**Target release:** v1.20.0
**Branch (for /impl-plan):** `feat/global-wildfire`
**Upstream verification:** live-tested 2026-08-13 (viability table in
`docs/planning/README.md`) and re-verified 2026-08-14 — see §Live
re-verification notes at the end of this doc.

## What / Why

`get_wildfire_info` is US-only: `src/handlers/wildfireHandler.ts` calls
`nifcService.queryFirePerimeters()` unconditionally, and NIFC WFIGS only
carries US interagency incidents. Any non-US location returns "no active
fires" even while a fire burns nearby.

Fix: route by country the way `get_alerts` does — US → NIFC (byte-identical),
elsewhere → **NASA FIRMS** satellite fire detections (VIIRS, near real-time,
global, detections within ~3 h of overpass).

**Scope decision (2026-08-14): keyless-first.** The tool works globally with
**zero keys** via FIRMS' keyless flat CSV files; the optional `FIRMS_MAP_KEY`
env var upgrades to targeted Area-API bbox queries and multi-day ranges
(D3). This preserves the zero-cost/zero-key data model — the key is an
optimization, not a gate. (Note: ICR's "first API key" claim is stale —
`NCEI_API_TOKEN` in `src/config/api.ts` already set the optional-key
precedent; FIRMS follows its exact shape.) Out of scope for v1: smoke
forecasts, Copernicus EFFIS, multi-satellite merging, and any attempt to
synthesize named incidents from detections.

**The verified design risk:** FIRMS returns satellite *hotspots* — lat/lon,
brightness, fire radiative power (FRP), confidence — **not managed
incidents**. There are no fire names, no acreage, no containment. A single
large fire produces dozens-to-hundreds of detection rows, and detections can
also be industrial heat sources, gas flares, or agricultural burns. D5 exists
to solve exactly this: cluster the rows and frame them honestly, the same
honesty problem global rivers solved for model discharge vs. gauge
observations.

**The second verified risk:** the two FIRMS data paths emit **different CSV
shapes** (live-confirmed 2026-08-14). The Area API adds an `instrument`
column and abbreviates `confidence` to `l`/`n`/`h`; the flat files omit
`instrument`, spell confidence out (`low`/`nominal`/`high`), and zero-pad
`acq_time` (`0048` vs the Area API's `215`). D4's parser normalizes both by
header name — never by column index.

## Design decisions (settled)

### D1. Routing — alerts-style country resolution

- `auto` (default): resolve the country the way `src/handlers/alertsHandler.ts`
  does — `resolved.country_code` (saved locations / geocoded city names carry
  it) → `nominatimService.reverseCountry(lat, lon)` (zoom=3, 2-dp cache key,
  TTL Infinity, already built) → `isInUS(lat, lon)` only when no country
  answer exists.
- Country `us` → NIFC path, **completely unchanged** (locked by
  `tests/unit/wildfire-handler.test.ts` passing unedited). Any other country
  → FIRMS. No-country answer (open ocean) → `isInUS` decides, matching the
  alerts rule.
- The reverse answer **wins over `isInUS`** — this fixes the Toronto/Vancouver
  CONUS-box overrun for wildfire the same way v1.19.0 fixed it for alerts.
- Handler signature: `nominatimService` added as a **trailing optional
  parameter** (alerts precedent — absent in test harnesses → silent `isInUS`
  fallback; a *failed* reverse lookup at runtime → one-line note, wording
  copied from alertsHandler).

### D2. `source` parameter, no cross-fallback

- New `source?: 'auto' | 'nifc' | 'firms'`, same contract as rivers/current
  conditions.
- No auto cross-fallback in either direction: NIFC named incidents
  (acreage/containment/perimeters) and FIRMS heat detections are **different
  claims** — same doctrine as rivers D1. A US point with zero NIFC fires does
  not silently switch to hotspots.
- Explicit `source: 'firms'` works **anywhere, including the US** — expressly
  useful: satellite detections often appear before an incident is catalogued
  in WFIGS, and NIFC only carries managed incidents.
- Explicit `source: 'nifc'` outside the US keeps today's behavior (finds
  nothing) — documented, not blocked.

### D3. Key handling and the two FIRMS paths

`src/config/api.ts` gains `FIRMS_MAP_KEY` + `isFIRMSAvailable()`, copying the
`NCEI_API_TOKEN` shape (docblock spells out with-vs-without behavior).

**Keyed path (Area API):**
`https://firms.modaps.eosdis.nasa.gov/api/area/csv/{KEY}/VIIRS_SNPP_NRT/{west},{south},{east},{north}/{day_range}`
— targeted bbox, `day_range` 1–5, rate limit 5,000 tx/10 min (generous; cache
still applies). The **country API remains down** (re-confirmed 2026-08-14:
"Invalid API call") — never build on it.

**Keyless path (flat files):** direct file URLs under
`https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_<Region>_24h.csv`.
**Directory listing 404s** (re-confirmed 2026-08-14) — file names must be
constants. All 13 files live-verified with sizes (§Live re-verification):
12 regional cuts (9 KB–5.2 MB) + `Global` (~10 MB), all `Accept-Ranges:
bytes`.

- Region selection: bundled **conservative (inset) bbox constants** per
  region, derived from FIRMS' regional coverage map during implementation.
  A point must be comfortably inside a region's bounds to use its cut;
  otherwise fall back to the `Global` file. **Correctness never depends on
  the region mapping** — regional cuts are purely a bandwidth optimization,
  and known gaps (e.g. the Middle East sits between the Europe/Africa/Asia
  cuts) simply take the Global file.
- Satellite: **VIIRS_SNPP_NRT** keyed / `suomi-npp-viirs-c2` keyless, so both
  paths use the same instrument family and return comparable results
  (both live-verified today). NOAA-20/21 NRT feeds exist (also verified) —
  noted as a future multi-satellite merge, not v1.
- **Key rejection falls back keyless with a note** (Area API returns
  400/401 with text `Invalid MAP_KEY.`): render the keyless 24 h result plus
  "*Note: FIRMS_MAP_KEY was rejected; showing keyless 24-hour data.*" —
  the tool keeps working while surfacing the misconfiguration (the v1.18.0
  stale-station-substitution-note philosophy). Other network errors → plain
  sanitized `Error` (ACIS/NIFC precedent); the handler's existing
  catch-and-render error block stays the single formatter.
- **Security: the MAP_KEY lives in the URL.** Error mapping and logging must
  never embed the request URL — wrap axios errors into fixed message strings
  (the `nifc.ts` `queryFeatureServer` mapping style) and log with
  `redactCoordinatesForLogging`; add a unit test asserting the key never
  appears in thrown messages.

### D4. Service + pure parsing module

- New `src/services/firms.ts` (`FIRMSService`): axios instance with
  `CacheConfig.apiTimeoutMs`, `Cache` with `CacheConfig.maxSize`, methods
  `getDetectionsByBbox(west, south, east, north, dayRange)` (keyed) and
  `getDetectionsByRegion(regionFile)` (keyless, returns parsed rows for the
  whole region; the handler filters by bbox). Both return the same
  normalized `FIRMSDetection[]`.
- New pure module `src/utils/firmsHotspots.ts` (no I/O — the
  `metarStation.ts`/`composite.ts` precedent) holding:
  - **CSV parsing by header name** — FIRMS CSV is unquoted, so per-line
    comma-split is safe, but column *positions differ between the two paths*
    (instrument column presence), so the header row is authoritative. First
    CSV parsing in the codebase; keep it dependency-free.
  - **Normalization:** confidence `l/n/h` ↔ `low/nominal/high` → one enum;
    `acq_date` + `acq_time` (UTC, zero-pad to 4 digits before parsing —
    handles both `215` and `0048`) → ISO timestamp; numeric fields
    (`frp`, `bright_ti4`) parsed defensively.
  - **Region picker:** lat/lon → regional file constant or `Global`.
  - **Clustering** (D5) and bbox filtering (haversine radius via
    `src/utils/distance.ts`, same post-filter discipline as the NIFC path).
- Types: new `src/types/firms.ts` (`FIRMSDetection`, `FIRMSCluster`,
  region constants' type). No `any`.
- **Bounds check:** cap parsed in-radius detections at 5,000 rows with a
  `securityEvent: true` warn and a truncation caveat line, mirroring the
  NIFC `exceededTransferLimit` handling (defense-in-depth for the ~10 MB
  Global file).

### D5. Output framing (the load-bearing decision)

Raw detections are unreadable (hundreds of rows per large fire). Cluster and
frame:

- **Clustering:** pure `clusterDetections(detections, radiusKm = 2)` —
  greedy: sort by FRP descending, assign each detection to the nearest
  existing cluster centroid within 2 km, else start a new cluster.
  Deterministic, unit-testable. Each cluster reports: detection count,
  centroid, distance + 16-point bearing from the requested point (reuse the
  bearing formatting introduced for METAR in `src/utils/metarStation.ts`),
  max FRP (MW) as the intensity signal, newest detection time with age,
  day/night mix, confidence summary, satellite/instrument. Raw brightness
  Kelvin values are **omitted** (uninterpretable garnish).
- **Header framing block**, mirroring the rivers model-data disclosure:

  ```
  **Location:** <resolved place>          ← prependLocationLine, unchanged
  **Source:** NASA FIRMS satellite fire detections (VIIRS, near real-time)

  ⚠️ Satellite heat detections — not managed incident data. No fire names,
  sizes, or containment are available; detections may include industrial
  heat sources, gas flares, or agricultural burns.
  ```

- **Safety assessment:** same distance tiers as the NIFC path (<5 km EXTREME
  DANGER, <25 HIGH ALERT, <50 CAUTION, else AWARENESS) keyed on the nearest
  *cluster*, with wording adjusted for detections. **No containment logic**
  (FIRMS has none) — the F3 containment-aware machinery stays NIFC-only.
- **No-detections result** must not read as all-clear: "No satellite fire
  detections in the last 24 h within N km." plus one caveat line — cloud
  cover and small/new fires can evade satellite detection.
- Display caps: 5 clusters (`detail: 'full'` → 25) with the same
  remainder-note wording as the NIFC branch.

### D6. Params and schema

`WildfireArgs` gains `source?: string` and `day_range?: number`.

- `radius` (1–500 km, default 100) applies identically on both paths — the
  handler's existing bbox math is reused for the FIRMS Area-API query and
  the flat-file post-filter.
- `day_range` (1–5, default 1): keyed FIRMS path only. Keyless path serves
  the fixed 24 h files — `day_range > 1` without a key renders the 24 h
  result plus "*Multi-day detection history requires a free FIRMS_MAP_KEY;
  showing the last 24 hours.*" NIFC path ignores it (schema description says
  so).
- `detail` unchanged. `LOCATION_SCHEMA_PROPERTIES` unchanged. `required: []`.
- Tool description in `src/index.ts`: drop "(US focus)"; describe the two
  data modes (US: NIFC named incidents with acreage/containment; elsewhere:
  NASA FIRMS satellite heat detections).

### D7. Caching

Named TTLs in `CacheConfig.ttl` (`src/config/cache.ts`) with justifying
comments — explicitly **not** the `nifc.ts` hardcoded-`1800000` anti-pattern
(leave that as-is; don't refactor NIFC in this feature):

- `firmsAreaQuery: 30 * MINUTE` — NRT detections land within ~3 h of
  overpass; 30 min matches the NIFC perimeter refresh cadence.
- `firmsRegionalFile: 30 * MINUTE` — cache the **parsed rows per region
  file**, not per request, so repeated queries anywhere in Europe cost one
  ~410 KB fetch per half hour. Global-file fallback cached the same way.

### D8. Attribution and registration

Footer on the FIRMS path:

```
*Data source: NASA FIRMS (Fire Information for Resource Management System)*
*We acknowledge the use of data from NASA FIRMS (https://firms.modaps.eosdis.nasa.gov/), part of NASA's Earth Science Data and Information System (ESDIS).*
```

- `.env.example`: `# FIRMS_MAP_KEY=your_key_here` under the existing
  "API TOKENS (Optional)" section (~L113), with a comment naming what the key
  upgrades (bbox queries, `day_range` up to 5) and the free signup URL.
- `src/config/tools.ts`: no changes (tool name and aliases unchanged).

## Edge cases

| Case | Behavior |
|------|----------|
| No detections within radius | Friendly no-detections message **with the not-all-clear caveat** (D5), not an error |
| Open ocean | Same as above (whichever backend routes; detections simply absent) |
| US point, `source: 'firms'` | Works; FIRMS framing (D5), useful pre-WFIGS signal |
| Non-US point, `source: 'nifc'` | Today's behavior — empty NIFC result; documented |
| Border city routed by CONUS-box overrun (Toronto) | Fixed by D1 — `reverseCountry` → `ca` → FIRMS |
| `reverseCountry` fails at runtime | `isInUS` fallback + one-line note (alerts wording) |
| `nominatimService` absent (test harness) | Silent `isInUS` fallback — trailing optional param |
| `day_range > 1` without key | Keyless 24 h result + upgrade note (D6) |
| Key rejected (`Invalid MAP_KEY.`) | Keyless fallback + disclosure note (D3) |
| No regional cut covers the point | Global file fallback — bandwidth cost only, never a correctness cost (D3) |
| >5,000 in-radius detections | Row cap + truncation caveat + `securityEvent` warn (D4) |
| Both FIRMS fetch attempts fail | Handler's existing catch renders the ❌ error block; message sanitized, key never included (D3) |

## Testing

- **Unit** (`tests/unit/firms-hotspots.test.ts`): CSV parsing against
  **both live-captured header variants** (with/without `instrument`,
  abbreviated vs spelled-out confidence, `215` vs `0048` acq_time);
  confidence normalization; timestamp assembly; clustering (single cluster
  from many rows, 2 km boundary, FRP-descending determinism, empty input);
  region picker (inside-region, gap → Global, ocean → Global); row cap.
- **Unit (routing)** (`tests/unit/wildfire-routing.test.ts`): the
  rivers/alerts negative-assertion discipline
  (`tests/unit/river-conditions-global.test.ts:208`,
  `tests/unit/alerts-routing.test.ts:90`) — auto-US touches only NIFC and
  never FIRMS, auto-non-US the reverse, both `source` overrides, no
  cross-talk on any path, `reverseCountry` called with exact coords /
  skipped when `country_code` came with the resolved location, Toronto
  canary reaches FIRMS.
- **US-path lock:** existing `tests/unit/wildfire-handler.test.ts` passes
  **unedited**.
- **Key-hygiene unit test:** thrown/rendered error text never contains the
  configured key (D3).
- **Integration** (`tests/integration/global-wildfire.test.ts`): mocked
  Area-API and flat-file response shapes end-to-end through the handler;
  one live smoke test on the **keyless** path (CI needs no secret),
  network-flake-tolerant per project convention.

## Documentation / registration checklist

- [ ] `src/index.ts` schema + description (D6)
- [ ] README.md tool table: `get_wildfire_info` → global (coverage table row;
      hotspots-vs-incidents caveat in the limitations list; optional-key note)
- [ ] CHANGELOG.md under `[Unreleased]`
- [ ] `docs/planning/README.md`: idea row 📝 → ✅ at ship; ICR Phase 4 marked
      shipped; Shipped table row
- [ ] CLAUDE.md tool list ("US only" → routed) + status blurb
- [ ] `docs/TOOLS.md` wildfire section rewritten for both data modes
- [ ] `.env.example` API-tokens section (D8)
- [ ] Move this doc to `docs/plans/` at ship

## Live re-verification notes (2026-08-14)

Performed with the real `FIRMS_MAP_KEY` (in the gitignored `.env`):

- **Area API** — 200. Iberia bbox (`-10,36,4,44`), 1 day, VIIRS_SNPP_NRT:
  346 rows. Header (14 cols):
  `latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight`
  — `instrument` present, `confidence` abbreviated (`n`), `acq_time`
  unpadded (`215`).
- **Flat files** — `/data/active_fire/` directory listing now returns a JSON
  404 (`pinpoint` file service); **direct file URLs still work**. Header
  (13 cols): no `instrument`, `confidence` spelled out (`nominal`),
  `acq_time` zero-padded (`0048`). All Range-capable. 24 h SNPP file sizes:

  | Region file | Size |
  |---|---|
  | Alaska | 9 KB |
  | South_Asia | 57 KB |
  | Central_America | 137 KB |
  | USA_contiguous_and_Hawaii | 304 KB |
  | Canada | 330 KB |
  | Europe | 410 KB |
  | SouthEast_Asia | 439 KB |
  | Australia_NewZealand | 444 KB |
  | South_America | 555 KB |
  | Russia_Asia | 1.9 MB |
  | Northern_and_Central_Africa | 4.2 MB |
  | Southern_Africa | 5.2 MB |
  | Global | 10.3 MB |

- **Country API** — still down (`Invalid API call`); build on area/bbox and
  flat files only.
- **Data availability** (`/api/data_availability/csv/{KEY}/ALL`) — live NRT
  sources: `MODIS_NRT`, `VIIRS_NOAA20_NRT`, `VIIRS_NOAA21_NRT`,
  `VIIRS_SNPP_NRT` (all current to 2026-08-14). NOAA-20 flat files also
  confirmed (`J1_VIIRS_C2_Global_24h.csv`, 8.0 MB).

## Implementation notes (added at completion)

Implemented 2026-08-14 on `feat/global-wildfire` via
`docs/plans/global-wildfire-implementation-plan.md` (T1–T7, all gates green;
commit SHAs in its Progress Tracker). D1–D8 shipped as designed. Deviations
and findings beyond the plan:

- **Area-API day semantics (the one real upstream surprise):** the Area
  API's `day_range` counts **calendar UTC days including today**, while the
  keyless flat files serve a **rolling 24 h** window (which itself lags —
  live capture showed rows up to ~28 h old in a "24h" file). A keyed
  `day_range: 1` query at midday returned 0 detections where keyless
  returned 11. The keyed path therefore requests `min(day_range + 1, 5)`
  days and filters to the true rolling window (`wildfireHandler.ts`),
  keeping the "last 24 h" label honest; at `day_range: 5` the window can
  run up to a day short at the tail (API max is 5 — live-verified 6 → 400).
- **Region insets:** the US–Canada border band (47–50°N west, 41–50°N
  around the Great Lakes and east) belongs to **no** inset — regional cuts
  stop at the border and no rectangle separates southern Ontario from the
  US Northeast, so Toronto/Vancouver/Seattle/Boston all take the Global
  file (bandwidth cost, never a data cost). Europe's east bound was
  shrunk to 35°E to match the live file's observed extent.
- **Bbox clamping:** the keyed path clamps its bbox corners to ±90/±180
  before `getDetectionsByBbox` — the service validates coordinates, which
  the NIFC path's raw bbox math never had to satisfy.
- **Key hygiene is structural:** `firms.ts` never interpolates axios error
  content into thrown messages (every error is a fixed pre-written string)
  and never logs request URLs or raw error objects, so the in-URL key
  cannot leak even through future logging changes; a unit test forces nine
  failure modes and asserts the key never appears.
- **Live sweep (2026-08-14, built dist, real + bogus + absent key):**
  Toronto → FIRMS via reverse-country (Global file); Sacramento auto →
  byte-identical to `main`; Sacramento `source:'firms'` → FIRMS in the US;
  southern Africa keyed vs keyless comparable (keyed rolling-24h found
  exactly the ≤24 h subset of the laggy keyless file); all three key modes
  (multi-day result / upgrade note / rejection note + keyless data);
  mid-ocean → not-all-clear caveat; Riyadh → Global fallback; two nearby
  European queries → one fetch + cache hit; 5/25 display caps + remainder
  notes verified live.
