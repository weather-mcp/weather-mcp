# Data Source Blockers & Known Issues

**Purpose:** A living record of external-data-source problems that have affected (or
could affect) this server — discontinued APIs, schema changes, access blocks, and rate
limits — plus what we did about them and what to watch. Weather data comes from many
free third-party APIs that change without notice; when functionality breaks, **check
here first**, then verify the live source before assuming a code bug.

> Pattern to remember: an upstream API can keep returning HTTP 200 while silently
> changing its contract (params ignored, fields renamed, feeds emptied). Several issues
> below were exactly that. When a feature "stops working," probe the raw endpoint
> directly before debugging our code.

**Last updated:** 2026-06-22

---

## 1. RainViewer API transition — satellite & color schemes discontinued (Jan 2026)

**Severity:** High (removed a capability) · **Status:** Worked around

**What happened:** RainViewer transitioned its public API on **2026-01-01**
([transition FAQ](https://www.rainviewer.com/api/transition-faq.html)). Effective then:
- **Satellite (infrared) imagery discontinued** — `satellite.infrared` in
  `weather-maps.json` is now an empty array.
- **Nowcast (future) radar discontinued.**
- **All color schemes except "Universal Blue" discontinued.**
- **Max zoom reduced to 7.**
- Only past radar (2 hours, 10-min intervals), PNG only, remains.

**Impact on us:**
- `get_weather_imagery type="satellite"` could **not** be implemented via RainViewer
  (the original plan). → Re-sourced to **NASA GIBS** (see `src/services/gibs.ts`).
- Our radar tile URLs hardcode color scheme `4` (`/4/1_1.png`). Verified the tiles still
  return HTTP 200 — the color param is now **silently ignored** (all schemes render as
  Universal Blue). So radar/precipitation still works; the color code is a dead value.

**Watch / restore notes:**
- If RainViewer fully shuts down (some announcements referenced a possible discontinuation
  date), **all radar/precipitation imagery breaks**. Replacement candidates: NASA GIBS
  radar (`...Radar...` layers, if added), Iowa Environmental Mesonet (IEM) tile services,
  or RAINVIEWER's paid successor.
- The hardcoded `/4/` color path should be changed to `/2/` (Universal Blue) for clarity,
  or made configurable, next time `rainviewer.ts` is touched. Not urgent (it works).

**How to check live:**
```
curl -s "https://api.rainviewer.com/public/weather-maps.json" | python3 -c "import json,sys;d=json.load(sys.stdin);print('radar.past',len(d['radar']['past']),'satellite.infrared',len(d.get('satellite',{}).get('infrared',[])))"
```

---

## 2. NOAA nowCOAST blocked from dev/CI environments (CloudFront 403)

**Severity:** Medium (tooling/verification) · **Status:** Avoided

**What happened:** `https://nowcoast.noaa.gov/arcgis/rest/services/...` (the obvious GOES
satellite `exportImage` source) returns **HTTP 403 "Request blocked"** from this
development environment — a CloudFront WAF block on the originating network. The block
persisted with browser-like headers and with the sandbox disabled, so it could not be
verified here at all.

**Impact on us:** We could not validate a nowCOAST-based satellite implementation from
the dev environment. → Chose **NASA GIBS** instead (`gibs.earthdata.nasa.gov`), which is
reachable here, serves GOES GeoColor as XYZ tiles (fits our tile model), and needs no
auth or even a metadata call (URLs are constructed directly).

**Watch / restore notes:**
- nowCOAST likely works fine from the production MCP runtime; it remains a viable
  fallback/alternative for satellite if GIBS ever degrades. If you try it, verify from
  the *deployment* network, not this dev sandbox.
- Other NOAA hosts behind the same CloudFront (e.g. parts of `*.noaa.gov`) may also be
  blocked from CI; prefer sources confirmed reachable (GIBS, Open-Meteo, api.water.noaa.gov).

---

## 3. NCEI CDO API rate limits (5/sec, 10,000/day)

**Severity:** Low · **Status:** Mitigated

**What happened:** While validating the new NCEI normals integration, rapid sequential
requests returned **HTTP 429**. CDO enforces 5 requests/second and 10,000/day per token.

**Impact on us:** A single `getClimateNormals` call makes ~3 requests (stations + daily +
monthly), and may probe a few stations. Bursting multiple locations back-to-back can trip
the per-second limit.

**Mitigations in place:** results cached indefinitely (`src/services/ncei.ts`); 429 maps
to `RateLimitError`, which the hybrid `utils/normals.ts` catches and falls back to
Open-Meteo; station probing capped at 4. In normal use (one forecast = one normals lookup)
this is a non-issue.

**Watch:** if forecast handlers ever batch many normals lookups, add client-side throttling.

---

## 4. NWPS `/gauges` contract change (fixed in v1.7.1) — reference

**Severity:** was High · **Status:** Fixed

Recorded here as the canonical example of a silent-200 contract change. The NWPS `/gauges`
endpoint stopped honoring `west/south/east/north` params (returned the full ~13MB catalog,
causing timeouts) and changed its response envelope/schema. Fixed in v1.7.1 by switching to
`bbox.{xmin,ymin,xmax,ymax}` + `srid=EPSG_4326` and unwrapping `{ "gauges": [...] }`.

**Watch:** `getNWPSGaugesInBoundingBox()` falls back to `getAllNWPSGauges()` (the heavy
13MB path) on error and now logs a `securityEvent` warning when it does. A sustained
appearance of that warning means the bbox query has regressed again — investigate
immediately.

---

## 5. NASA GIBS satellite — latest frame only (no animation)

**Severity:** Low · **Status:** Accepted limitation

**What happened:** When implementing satellite via NASA GIBS (GOES GeoColor), the WMTS
**"default" time (latest) tile is reliably available**, but explicit sub-daily timestamps
are published at **irregular** times — e.g. probing GOES-West GeoColor, `…T22:00:00Z` and
`…T12:00:00Z` returned 200 while `…T18:00:00Z` and `…T00:00:00Z` returned 404. Guessing
fixed 30-min/hourly slots for an animation loop produced frequent 404 tiles.

**Impact on us:** `get_weather_imagery type="satellite"` returns the **latest snapshot
only**; the `animated` flag is ignored for satellite (radar/precipitation still animate via
RainViewer). See `src/services/gibs.ts`.

**Watch / restore notes:** To support satellite animation reliably, query GIBS for the
layer's actual available times instead of guessing — either parse the WMTS
`GetCapabilities` time `Dimension` (large, ~5MB) or use the GIBS time-domains endpoint —
then build frame URLs from real timestamps.

**How to check live:**
```
curl -s -o /dev/null -w "%{http_code}\n" "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_GeoColor/default/GoogleMapsCompatible_Level7/5/12/9.png"
```

---

## Template for new entries

```
## N. <Source> — <one-line problem> (<date>)
**Severity:** High/Medium/Low · **Status:** Worked around / Fixed / Open
**What happened:** ...
**Impact on us:** <which tool/feature, which file>
**Watch / restore notes:** <how to detect recurrence; replacement candidates>
**How to check live:** <a curl/probe command>
```
