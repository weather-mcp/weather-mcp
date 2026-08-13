# Planning Index

**This table is the single source of truth for feature-idea status.** The other
docs in this folder hold detail and rationale; when an idea's state changes
(picked up, shipped, rejected), update it **here** — detail docs don't need
their own status bookkeeping beyond a link back to this index.

**Statuses:**

| Emoji | Meaning |
|-------|---------|
| 💡 | Idea — recorded, not yet committed |
| 📝 | Planned — has a design doc (`docs/<name>-plan.md`) |
| 🚧 | In progress |
| ⛔ | Blocked — waiting on something external (noted inline) |
| ✅ | Shipped — version noted |
| ❌ | Rejected — reason noted, see [Rejected](#rejected) |

**Lifecycle:** idea lands in the table (💡) → design doc `docs/<name>-plan.md`
(📝) → `/impl-plan` + `/run-plan` (🚧) → release (✅). Shipped detail lives in
[CHANGELOG.md](../../CHANGELOG.md); this index only records that/when an idea
shipped.

---

## Active ideas

### International coverage

Sequenced in [INTERNATIONAL_COVERAGE_ROADMAP.md](./INTERNATIONAL_COVERAGE_ROADMAP.md) (ICR).

| Idea | Status | Detail |
|------|--------|--------|
| Global river/flood via Open-Meteo Flood API | ✅ | Shipped in v1.18.0 (developed on `feat/global-rivers` as the v1.15.0 milestone); [`docs/plans/global-rivers-plan.md`](../plans/global-rivers-plan.md); ICR Phase 2; [FORK_DERIVED_IDEAS](./FORK_DERIVED_IDEAS.md) #1 |
| UK Environment Agency gauge supplement | 💡 | Descoped from the global-rivers work (2026-08-12) to keep v1.15.0 to one provider; England-only, keyless, OGL v3, 15-min real-time observations |
| International alerts (MeteoAlarm, MSC GeoMet, WMO CAP) | 💡 | ICR Phase 3 |
| Global wildfire via NASA FIRMS (optional MAP_KEY) | 💡 | ICR Phase 4; [FORK_DERIVED_IDEAS](./FORK_DERIVED_IDEAS.md) #2 |
| met.no Locationforecast as fallback/second-opinion source | 💡 | ICR Phase 5 |
| Global climate normals (Open-Meteo archive outside US) | 💡 | ICR Phase 5 |
| Global fire weather indices (Open-Meteo hourly outside US) | 💡 | ICR Phase 5 |
| UK river gauges (Environment Agency flood-monitoring API) | 💡 | ICR Phase 2 supplement |
| Real station observations worldwide (aviationweather.gov METARs) | ✅ | Shipped in v1.18.0 (developed on `feat/metar` as the v1.17.0 milestone); [`docs/plans/metar-plan.md`](../plans/metar-plan.md). Shipped as `source: 'metar'` on `get_current_conditions` — not a new tool — with `auto` byte-for-byte unchanged. Closes the ICR Phase 1 leftover and the observation half of [FUTURE_ENHANCEMENTS](./FUTURE_ENHANCEMENTS.md) §4 |

### Architecture & tooling

| Idea | Status | Detail |
|------|--------|--------|
| Remote hosting: Streamable HTTP transport + OAuth | 💡 | [FORK_DERIVED_IDEAS](./FORK_DERIVED_IDEAS.md) #3 |
| Multi-model forecast comparison (Open-Meteo `models` param) | 💡 | [FORK_DERIVED_IDEAS](./FORK_DERIVED_IDEAS.md) #4 — *rejected in 2025 as "too complex" via NOMADS; reconsidered 2026-08 via Open-Meteo* |
| ESLint in the toolchain / CI | 💡 | [FORK_DERIVED_IDEAS](./FORK_DERIVED_IDEAS.md) #5 |
| Examples folder (`examples/` with captured real output, README-linked) | ✅ | Shipped 2026-08-13 (post-v1.18.0 docs); 8 conversation-first scenario files + regenerable raw output via `npm run examples` (`scripts/capture-examples.mjs`) |
| Opt-in usage analytics integration | 🚧 | Backend is the separate [analytics-server](https://github.com/weather-mcp/analytics-server) repo; MCP-side plan in [archive/IMPLEMENTATION_PLAN.md](./archive/IMPLEMENTATION_PLAN.md) §6.3 |
| Split into domain MCP servers (climate, agriculture, …) if scope grows | 💡 | [archive/ROADMAP.md](./archive/ROADMAP.md) "Possible v2.0.0 Direction" |

### Data & output enhancements

Detail for all of these lives in [FUTURE_ENHANCEMENTS.md](./FUTURE_ENHANCEMENTS.md) (FE) by section number.

| Idea | Status | Detail |
|------|--------|--------|
| Satellite imagery in `get_weather_imagery` | 💡 | FE §12.1 (deferred from v1.5.0) |
| Composited imagery via MCP image content blocks (radar over base map, returned as a finished picture) | ✅ | Shipped as `composite: true` on `get_weather_imagery` (in `[Unreleased]`, version TBD); [`docs/plans/composited-imagery-plan.md`](../plans/composited-imagery-plan.md). D2 settled on NASA GIBS (OSM and Carto ruled out on terms); client survey done — image blocks are protocol-standard, inline rendering varies |
| Satellite image-content return on `get_weather_imagery` (same `composite` treatment for GOES GeoColor) | 💡 | Deferred from the composited-imagery plan (D7) — GeoColor is already a full picture and needs no base map, so this is purely for return-shape consistency; today `satellite` + `composite` renders an explanatory note. See [`docs/plans/composited-imagery-plan.md`](../plans/composited-imagery-plan.md) |
| Moon phase / astronomy (`include_astronomy` on forecast) | ✅ | Shipped in v1.18.0 (developed on `feat/almanac` as the v1.16.0 milestone); [`docs/plans/almanac-plan.md`](../plans/almanac-plan.md); FE §1.1 |
| Extended twilight times (civil/nautical/astronomical) | ✅ | Shipped in v1.18.0 (developed on `feat/almanac` as the v1.16.0 milestone); [`docs/plans/almanac-plan.md`](../plans/almanac-plan.md); FE §1.2 |
| Record highs/lows for date (with normals) | ✅ | Shipped in v1.18.0 (developed on `feat/almanac` as the v1.16.0 milestone; US, RCC ACIS); [`docs/plans/almanac-plan.md`](../plans/almanac-plan.md); FE §2.2 |
| Better precipitation-type parsing (rain/snow/freezing rain) | 💡 | FE §3.2 |
| Aviation weather tool (METAR/TAF) | 💡 | FE §4 — **observation half closed:** shipped as `source: 'metar'` on `get_current_conditions` in v1.17.0 ([`docs/plans/metar-plan.md`](../plans/metar-plan.md)), and the raw METAR text is in the output. What remains open is the pilot-facing product: TAF forecasts (the `/api/data/taf` endpoint is verified working) and a dedicated aviation tool, both explicitly out of scope for v1.17.0 (metar-plan D7) |
| Drought indices (US Drought Monitor) | 💡 | FE §5.2 |
| Heat/cold stress extras (WBGT, frostbite time-to-onset) | 💡 | FE §6.2 |
| Smoke forecasts (NOAA HRRR-Smoke) | 💡 | FE §7.2 |
| Storm reports (NOAA SPC, post-storm verification) | 💡 | FE §8.2 |
| Seasonal outlooks + ENSO status (NOAA CPC) | 💡 | FE §9 |
| Forecast uncertainty/confidence | 💡 | FE §13.1 — overlaps multi-model comparison above |
| Solar radiation / solar power forecasts | 💡 | FE §18.1 |
| Heating/cooling degree days | 💡 | FE §18.2 |
| Pollen & allergen forecasts | ✅ | Shipped in v1.18.0 (current-conditions block of `get_air_quality`, auto-shown when non-null; Europe-only via CAMS). FE §6.1's "no free API" blocker went stale — 6 species on the air-quality endpoint the tool already calls. Hourly/daily pollen *forecast* remains open if ever wanted |

### Hardening & fixes

| Idea | Status | Detail |
|------|--------|--------|
| Live-test hardening: saved-location update metadata loss, NOAA observation staleness (age/caveat/fresher-station retry), containment-aware wildfire assessment, marine water-body disclosure, UTC date-bounds docs | ✅ | Shipped in v1.18.0; [`docs/plans/live-test-hardening-plan.md`](../plans/live-test-hardening-plan.md) — five findings (F1–F5) from the 2026-08-13 full-suite live test of the `feat/metar` build |

---

## Upstream API viability check (verified live 2026-08-12; extended 2026-08-13)

All candidate bundles' upstream APIs were verified with real requests (response
shapes, limits, licensing, error behavior). Corrections discovered in this pass
have been applied to
[INTERNATIONAL_COVERAGE_ROADMAP.md](./INTERNATIONAL_COVERAGE_ROADMAP.md)
(§Live verification notes). Re-verify before writing a design doc if
significant time has passed.

| Bundle | Verdict | Load-bearing findings |
|--------|---------|----------------------|
| **global-rivers** (Open-Meteo Flood + UK EA) | ✅ Viable, one design risk | Flood API works incl. ensemble percentiles (`_min/_max/_p25/_p75`), 210-day horizon, `past_days`. **Discharge is per ~5 km grid cell — a cell off the channel is garbage** (Memphis: 0.63 vs 11,640 m³/s one cell apart); design must snap to the max-discharge neighboring cell. Ocean points return HTTP 200 with all-null series. UK EA API: keyless, OGL v3 (fixed attribution string), 15-min real-time, England-only, no deprecation announced. |
| **almanac** (moon, twilight, US records) | ✅ Viable | Open-Meteo **now has** `moonrise`/`moonset`/`moon_phase` daily vars (FE §1.1's "no moon API" is stale); `moon_phase` is a cycle fraction, not illumination. Best route: local computation via `astronomy-engine` (MIT, zero-dep, typed, ±1 min; also does all three twilight pairs + next-quarter dates). US records: RCC ACIS keyless — record + year for all 366 days in one cacheable `StnData` call, `StnMeta` bbox for station discovery; no published ToS/rate limit, so cache hard. |
| **international-alerts** (MeteoAlarm, MSC GeoMet) | ✅ Viable for EU+CA; ⛔ rest-of-world | MeteoAlarm: keyless JSON is `feeds.meteoalarm.org/api/v1/warnings/feeds-<country>` (per-country only; `api.meteoalarm.org` needs registration); no polygons keyless — country-level matching only; strict terms (unmodified display, "EUMETNET – MeteoAlarm" attribution, time of issue). GeoMet: collection is **`weather-alerts`**, native bbox works, real polygons, bilingual `_en`/`_fr`, not CAP-shaped, ECCC licence forbids altering alert content. WMO SWIC/Alert-Hub: undocumented demo feeds, no geometry, unclear rights — blocked for production. |
| **global-wildfire** (NASA FIRMS) | ✅ Viable (key in hand) | Area API verified live with real MAP_KEY (200, VIIRS detections; extra `instrument` column; `confidence` abbreviated `l/n/h`). Country API is down — use area/bbox only. Day range max 5. Rate limit 5,000 tx/10 min. **Keyless fallback exists**: flat 24h/48h/7d CSVs (global ~12 MB, regional cuts smaller) — key becomes an optimization, not a gate. |
| **aviation-weather** (aviationweather.gov) | ✅ Viable | Keyless v4.0 NWS API, worldwide METAR/TAF confirmed live (EGLL/YSSY/SBGR/FAOR), bbox geo-query on metar/taf/stationinfo, decoded JSON with pre-computed flight category. 100 req/min documented; custom User-Agent advised. Type gotchas: string `visib` ("10+"), mixed epoch/ISO timestamps, most fields optional. |
| **pollen** (Open-Meteo air quality) *(2026-08-13)* | ✅ Viable, Europe-only | Unblocks FE §6.1's "no free API" — **stale, like FE §1.1's "no moon API" was**. Six species (`alder`/`birch`/`grass`/`mugwort`/`olive`/`ragweed_pollen`) on the air-quality endpoint `get_air_quality` already calls, so marginal cost is added hourly variables, not a new provider. **Coverage is the catch:** non-European points return HTTP 200 with an all-null series (same failure mode as the Flood API over ocean), so any design must trim on null rather than trust the 200. |
| **storm-reports / drought / seasonal** *(2026-08-13)* | ✅ / ✅ / ⚠️ | SPC storm reports: `spc.noaa.gov/climo/reports/{today,yesterday}.csv`, HTTP 200, CSV with lat/lon per report — but *today*'s file is near-empty early in the day, so recency needs handling. US Drought Monitor: `usdmdataservices.unl.edu` keyless JSON, D0–D4 percentages, but keyed by **county FIPS**, so it needs a lat/lon → FIPS step the project does not have today. CPC seasonal: ENSO ONI page returns HTML (scrape-only) and the long-range `.dat` path 404s — no clean JSON found, the weakest of the three. |
| **coverage-polish** (met.no, global normals, global FWI) | ✅ Viable with obligations | met.no: global (9.5-day horizon), keyless, but ToS mandates identifying User-Agent + `If-Modified-Since` caching + ≤4-decimal coords; coarser than Open-Meteo outside Nordics. Global normals: one 30-year archive pull works (~1.2 s) but is **weighted as hundreds of API calls** — two pulls tripped the 600/min limit; needs permanent cache + serialized backoff. Global FWI: all Fosberg inputs in Open-Meteo hourly (km/h → mph conversion required); no direct FWI variable exists — keep computing in-house. |

---

## Shipped

One line per idea that graduated; see [CHANGELOG.md](../../CHANGELOG.md) for release detail.

| Idea | Shipped |
|------|---------|
| Weather alerts, hourly forecasts, severe weather, heat index | ✅ v0.3.0 |
| Location search/geocoding (`search_location`), global forecast routing, 16-day | ✅ v0.4.0 |
| Air quality tool, fire weather indices | ✅ v0.5.0 |
| Marine conditions | ✅ v0.6.0 (Great Lakes: v1.1.0) |
| Climate normals (US), snow depth/snowfall detail, timezone-aware times | ✅ v1.2.0 |
| Version info in status tool + startup logging | ✅ v1.3.0 |
| Tool configuration system (presets, filtering) | ✅ v1.4.0 |
| Precipitation radar imagery (RainViewer), real-time lightning (Blitzortung) | ✅ v1.5.0 |
| River conditions (NOAA/USGS), wildfire tracking (NIFC) — both US | ✅ v1.6.0 |
| Saved locations (aliases, Nominatim geocoding) | ✅ v1.7.0 |
| `city_name` free-text geocoding on forecast | ✅ v1.9.0 |
| Unit localization (imperial/metric, per-unit overrides) | ✅ v1.10.0 |
| Universal location resolution, `get_weather_summary`, `detail` control | ✅ v1.11.0 |
| Global current conditions (ICR Phase 1), border fallback routing | ✅ v1.12.0 |
| Max-range expansion, output completeness | ✅ v1.13.0 |
| Default location (`WEATHER_DEFAULT_LOCATION`), CI workflow, tz band fix | ✅ v1.14.0 |
| Global river conditions via Open-Meteo Flood/GloFAS (ICR Phase 2) | ✅ v1.18.0 (developed as the v1.15.0 milestone) |
| Almanac: moon phase, twilight times, US record highs/lows | ✅ v1.18.0 (developed as the v1.16.0 milestone) |
| Worldwide METAR station observations (`source: 'metar'`) | ✅ v1.18.0 (developed as the v1.17.0 milestone) |
| Live-test hardening (staleness, containment, metadata) + European pollen | ✅ v1.18.0 |

---

## Rejected

Consolidated from the former lists in ROADMAP.md ("Features NOT in Roadmap")
and FUTURE_ENHANCEMENTS.md ("Rejected Enhancements"), plus fork-review passes.
A rejection can be revisited — record the new evaluation here when it is
(see multi-model comparison above for the pattern).

| Idea | Why rejected |
|------|--------------|
| Alert subscriptions / webhooks | Requires persistent state; out of scope for a stateless MCP server |
| Custom alert thresholds | Requires persistent state |
| Earthquake data | Geological, not meteorological — separate "natural hazards MCP" if ever |
| Tsunami warnings as a feature | Already surfaced via `get_alerts` (NOAA alert system) |
| Agricultural suite (GDD, crop indices, soil) | Specialized audience; separate `weather-agriculture-mcp` if demand |
| Climate trend analysis | Specialized; better as separate MCP |
| Personal weather station data | Data quality concerns |
| Social weather sharing | Out of scope |
| Road weather conditions tool | No free national API; inferable from existing forecast data |
| Multi-location comparison tool | AI assistants already do this with multiple calls to existing tools |
| Year-over-year comparison tool | Same — existing historical tool suffices |
| Multi-language output | AI assistants translate; NOAA data is English-only anyway |
| Distance/bearing output enhancement | Limited utility; shipped narrowly where it matters (lightning strike distance) |
| Multi-model comparison via NOMADS GRIB downloads | Heavy parsing, US-centric — the *idea* lives on via Open-Meteo (see Active) |
| Census.gov geocoding with Nominatim fallback | Superseded — `search_location` shipped Nominatim-only (v0.4.0/v1.7.0) |
| PAGASA (Philippines) integration | Country-specific product direction, not generalizable (fork review 2026-08) |

---

## What's in this folder

| Doc | Role |
|-----|------|
| **README.md** (this file) | Status index — the only place status is tracked |
| [INTERNATIONAL_COVERAGE_ROADMAP.md](./INTERNATIONAL_COVERAGE_ROADMAP.md) | Sequenced plan for taking the US-only tools global |
| [FORK_DERIVED_IDEAS.md](./FORK_DERIVED_IDEAS.md) | Ideas surfaced from the 2026-08 review of public forks |
| [FUTURE_ENHANCEMENTS.md](./FUTURE_ENHANCEMENTS.md) | Raw idea pool — research notes, data sources, pros/cons per idea |
| [archive/](./archive/) | Historical documents kept for reference (original build plan, v0.x–v1.6 roadmap) |

Design docs for individual features (`docs/<name>-plan.md`, plus their
implementation plans and verification reports) start life at the [docs/](../)
root while the feature is in flight, and move to [docs/plans/](../plans/) once
shipped — e.g. `global-current-conditions-plan.md`,
`max-range-expansion-plan.md`, `output-completeness-plan.md`.

## Design principles (when evaluating an idea)

Extracted from the original roadmap — full text in
[archive/ROADMAP.md](./archive/ROADMAP.md) §Implementation Principles.

1. **Parameters over proliferation** — prefer a parameter on an existing tool
   to a new tool; prefer automatic output enhancement to a parameter.
2. **Enhance before creating** — a new tool needs a fundamentally different
   operation, data source, or semantic purpose, and must be useful in isolation.
3. **Intelligent defaults** — auto-select sources, auto-show relevant indices;
   don't make callers specify everything.
4. **Clear descriptions with semantic triggers** — one purpose, example
   queries, when *not* to use it, <150 words.
5. **Zero-cost data model** — free APIs only; API keys optional at most
   (FIRMS would be the first, kept optional).

---

*Created 2026-08-12 as part of the planning-docs reorganization.*
