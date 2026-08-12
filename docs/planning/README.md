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
| Global river/flood via Open-Meteo Flood API | 💡 | ICR Phase 2; [FORK_DERIVED_IDEAS](./FORK_DERIVED_IDEAS.md) #1 |
| International alerts (MeteoAlarm, MSC GeoMet, WMO CAP) | 💡 | ICR Phase 3 |
| Global wildfire via NASA FIRMS (optional MAP_KEY) | 💡 | ICR Phase 4; [FORK_DERIVED_IDEAS](./FORK_DERIVED_IDEAS.md) #2 |
| met.no Locationforecast as fallback/second-opinion source | 💡 | ICR Phase 5 |
| Global climate normals (Open-Meteo archive outside US) | 💡 | ICR Phase 5 |
| Global fire weather indices (Open-Meteo hourly outside US) | 💡 | ICR Phase 5 |
| UK river gauges (Environment Agency flood-monitoring API) | 💡 | ICR Phase 2 supplement |
| Real station observations worldwide (aviationweather.gov METARs) | 💡 | ICR Phase 1 leftover; [FUTURE_ENHANCEMENTS](./FUTURE_ENHANCEMENTS.md) §4 |

### Architecture & tooling

| Idea | Status | Detail |
|------|--------|--------|
| Remote hosting: Streamable HTTP transport + OAuth | 💡 | [FORK_DERIVED_IDEAS](./FORK_DERIVED_IDEAS.md) #3 |
| Multi-model forecast comparison (Open-Meteo `models` param) | 💡 | [FORK_DERIVED_IDEAS](./FORK_DERIVED_IDEAS.md) #4 — *rejected in 2025 as "too complex" via NOMADS; reconsidered 2026-08 via Open-Meteo* |
| ESLint in the toolchain / CI | 💡 | [FORK_DERIVED_IDEAS](./FORK_DERIVED_IDEAS.md) #5 |
| Opt-in usage analytics integration | 🚧 | Backend is the separate [analytics-server](https://github.com/weather-mcp/analytics-server) repo; MCP-side plan in [archive/IMPLEMENTATION_PLAN.md](./archive/IMPLEMENTATION_PLAN.md) §6.3 |
| Split into domain MCP servers (climate, agriculture, …) if scope grows | 💡 | [archive/ROADMAP.md](./archive/ROADMAP.md) "Possible v2.0.0 Direction" |

### Data & output enhancements

Detail for all of these lives in [FUTURE_ENHANCEMENTS.md](./FUTURE_ENHANCEMENTS.md) (FE) by section number.

| Idea | Status | Detail |
|------|--------|--------|
| Satellite imagery in `get_weather_imagery` | 💡 | FE §12.1 (deferred from v1.5.0) |
| Moon phase / astronomy (`include_astronomy` on forecast) | 💡 | FE §1.1 |
| Extended twilight times (civil/nautical/astronomical) | 💡 | FE §1.2 |
| Record highs/lows for date (with normals) | 💡 | FE §2.2 |
| Better precipitation-type parsing (rain/snow/freezing rain) | 💡 | FE §3.2 |
| Aviation weather tool (METAR/TAF) | 💡 | FE §4 |
| Drought indices (US Drought Monitor) | 💡 | FE §5.2 |
| Heat/cold stress extras (WBGT, frostbite time-to-onset) | 💡 | FE §6.2 |
| Smoke forecasts (NOAA HRRR-Smoke) | 💡 | FE §7.2 |
| Storm reports (NOAA SPC, post-storm verification) | 💡 | FE §8.2 |
| Seasonal outlooks + ENSO status (NOAA CPC) | 💡 | FE §9 |
| Forecast uncertainty/confidence | 💡 | FE §13.1 — overlaps multi-model comparison above |
| Solar radiation / solar power forecasts | 💡 | FE §18.1 |
| Heating/cooling degree days | 💡 | FE §18.2 |
| Pollen & allergen forecasts | ⛔ | FE §6.1 — blocked: no free, reliable API found |

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
