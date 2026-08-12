# Fork-Derived Feature Ideas

Larger feature ideas surfaced by reviewing all public forks of this repository,
recorded here so they can be considered for future releases. Each would need its
own design discussion (`docs/<name>-plan.md`) before implementation — none of the
fork code is directly mergeable, but the ideas are sound.

**Review date:** 2026-08-12 (8 forks reviewed)

For the broader enhancement backlog, see [FUTURE_ENHANCEMENTS.md](./FUTURE_ENHANCEMENTS.md)
and [ROADMAP.md](./ROADMAP.md).

---

## 1. Global river/flood coverage via the Open-Meteo Flood API

**Source:** `tomohiro-owada/weather-mcp-ph` (uses it for Philippines flood data)

`get_river_conditions` is US-only (NOAA NWPS). The [Open-Meteo Flood API](https://open-meteo.com/en/docs/flood-api)
provides global river discharge data (GloFAS — ensemble river discharge forecasts,
~5 km resolution, no API key) and could back an international fallback, the same
pattern `get_current_conditions` uses (NOAA in the US, Open-Meteo elsewhere).

- **Value:** removes a US-only limitation on an existing safety tool; fits the
  established auto-routing pattern (`isInUS` helper).
- **Considerations:** GloFAS is model discharge, not gauge observations — output
  framing must be honest about that (no flood-stage thresholds, no observed
  levels). Discharge anomaly vs. long-term percentiles is the useful signal.
- **Effort:** medium. New service method + international branch in the handler.

## 2. Global wildfire coverage via NASA FIRMS

**Source:** `tomohiro-owada/weather-mcp-ph` (added a FIRMS service)

`get_wildfire_info` is US-only (NIFC ArcGIS). [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/)
provides global satellite fire detections (VIIRS/MODIS hotspots, updated multiple
times daily). Same auto-routing pattern as above.

- **Value:** wildfire is a global hazard; this is the second of the two remaining
  US-only safety tools.
- **Considerations:** FIRMS needs a free API key (MAP_KEY) — would be this
  project's second optional token after NCEI, and the tool should degrade
  gracefully without it. Hotspot detections are not incident data: no fire
  names, containment, or size — output must present them as satellite heat
  detections, not managed incidents.
- **Effort:** medium. New service + international branch; careful output design.

## 3. Remote MCP hosting: Streamable HTTP transport + authentication

**Source:** `tomohiro-owada/weather-mcp-ph` (Streamable HTTP + Google OAuth with
email allowlists)

The server is stdio-only. The MCP spec's Streamable HTTP transport would allow
hosting one shared instance for a team or family (e.g., behind a reverse proxy)
instead of every client spawning its own process.

- **Value:** unlocks claude.ai remote connectors, shared caches, and centrally
  configured saved locations / defaults.
- **Considerations:** the big one is auth — an unauthenticated public weather
  endpoint invites abuse of the free upstream APIs on our behalf. The fork pairs
  the transport with Google OAuth and an email allowlist; MCP now has a
  standardized OAuth authorization flow worth following instead of a bespoke
  scheme. Saved locations are currently a single local JSON file — multi-user
  hosting needs per-user separation or read-only mode. Substantial scope.
- **Effort:** large. Transport + auth + multi-user storage semantics + docs.

## 4. Multi-model forecast comparison

**Source:** `dapcook/weather-mcp` (NOMADS GRIB handlers + `modelComparisonHandler`,
~900 lines against an April 2026 base)

A tool (or `get_forecast` parameter) that compares predictions across weather
models — useful when models disagree, which is exactly when forecast uncertainty
matters to a user.

- **Value:** genuine differentiator; "how confident is this forecast?" is a
  natural AI-assistant question.
- **Considerations:** do NOT take the fork's approach (NOMADS GRIB downloads —
  heavy parsing, US-model-centric). [Open-Meteo's `models` parameter](https://open-meteo.com/en/docs)
  returns multiple models (GFS, ECMWF, ICON, GEM, …) from the existing JSON API
  in one call — a fraction of the code for global coverage. Output design should
  summarize agreement/divergence, not dump N forecasts.
- **Effort:** small-to-medium via Open-Meteo; large via NOMADS (rejected).

## 5. ESLint in the toolchain

**Source:** `quinnmacro/weather-mcp` (added ESLint to their CI)

The project relies on `tsc` strict mode alone. ESLint (typescript-eslint) would
catch consistency issues tsc doesn't (unused exports, promise misuse, import
hygiene) and give contributors an autofixable style baseline.

- **Considerations:** noise-vs-value tradeoff on a mature codebase; introduce
  with a minimal recommended config, autofix what's safe, and only then wire
  into CI (the CI workflow added 2026-08-12 can gain a lint step).
- **Effort:** small.

---

## Adopted from this review (no longer ideas)

- **CI workflow for build + unit tests** (idea from `quinnmacro/weather-mcp`) —
  added as `.github/workflows/ci.yml`, 2026-08-12.
- **Timezone fallback band fix** (from `dapcook/weather-mcp`
  `fix/nam-grid-and-timezone-bugs`) — the coarse US longitude fallback in
  `guessTimezoneFromCoords` mis-bucketed Eastern/Central cities; bands retuned
  with tests, 2026-08-12.

## Reviewed and passed on

- `jablum/weather-mcp` — `city_name` geocoding, geocode cache, metric units:
  already upstreamed as v1.9.0/v1.10.0 (this fork inspired both).
- `dapcook/weather-mcp` request-lifecycle logging — overlaps existing structured
  logging; NAM grid fixes apply only to their NOMADS code.
- `tomohiro-owada/weather-mcp-ph` PAGASA integration — Philippines-specific
  product direction, not generalizable.
- `iflow-mcp/dgahagan-weather-mcp` — iFlow marketplace packaging only.
- `JiuGe1999/weather-mcp`, `dannychou7911/weather-mcp` — empty forks (0 ahead).
- `chrstphe/weather-mcp` — inaccessible (404; deleted or private).
