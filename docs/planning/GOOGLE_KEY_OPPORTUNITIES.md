# Google API Key Opportunities — Research Register

**Status:** 📋 RESEARCH — no feature designed; catalogue only
**Researched:** 2026-08-18 (web; no live calls — no key on hand yet)
**Builds on:** `docs/plans/global-pollen-fallback-plan.md`, which introduces the project's
first Google Maps Platform key (`GOOGLE_POLLEN_API_KEY`) for global pollen on
`get_air_quality`. This doc answers the follow-on question: *a user who creates a
Google Cloud billing account to get pollen data has implicitly unlocked the entire
GMP environmental suite — what else could that key do for this server?*
**Index note:** the `docs/planning/README.md` status row for this doc is **deferred**
— the pollen implementation branch owns in-flight edits to the planning index and
`FUTURE_ENHANCEMENTS.md`; add the row once that work lands.

## The one-key premise

A Google Maps Platform API key is **one key for the whole platform**. Each API
(Pollen, Weather, Air Quality, Solar, …) is enabled per Cloud project with a console
toggle; a key restricted to the Pollen API can be un-restricted or a second key
minted on the same project with zero new signup friction. Consequences:

- **Free tiers are per-SKU, not per-key** — under the March 2025 GMP pricing model:
  Essentials SKUs 10,000 free calls/month, Pro SKUs 5,000, Enterprise SKUs 1,000.
  Pollen's 5,000/month (Pro tier) is *not* consumed by, say, Weather API calls
  (Essentials, 10,000/month). Each feature riding the key gets its own quota pool.
- **One billing account** — the signup hurdle the pollen plan documents is paid
  exactly once; every additional API is marginal-cost-free at this server's scale.
- **Shared ToS posture** — the pollen plan's upstream findings generalize across GMP:
  mandatory per-API attribution strings, and the general prohibition on persistent
  caching/storing of API content (short-lived in-memory session cache only — the
  disclosed trade-off in the pollen plan's upstream (e) applies verbatim to any
  future GMP integration).
- **Key naming — SETTLED (2026-08-18): per-feature keys, permanent.**
  `GOOGLE_POLLEN_API_KEY` keeps its name forever; any future Google feature gets
  its own env var (e.g. `GOOGLE_WEATHER_API_KEY` for #1 below). Rationale: the
  key-setup doc (`docs/GOOGLE_POLLEN_KEY_SETUP.md`) recommends **restricting**
  the key to the Pollen API in the console, and a restricted key cannot serve
  any other API — a shared `GOOGLE_MAPS_PLATFORM_API_KEY` would invite silent
  `PERMISSION_DENIED` breakage the moment a second feature read it. Per-feature
  vars match the NCEI/FIRMS one-key-one-purpose precedent, and a user who
  prefers a single unrestricted key can simply put the same string in every
  var. This also removes any migration/breaking-change pressure on the pollen
  key name after v1.22.0 ships. (Mirrored as D10 in
  `docs/plans/global-pollen-fallback-plan.md`.)

## Ranked opportunities (Google key)

### #1 — Global weather alerts fallback on `get_alerts` ⭐ strongest candidate

**What it adds:** The Google Weather API (`weather.googleapis.com/v1`, GA June 2025)
gained a **weather alerts endpoint on 2025-11-18** covering ~45 territories.
Set-differenced against current coverage (US → NOAA, Canada → ECCC, 38 European
countries → MeteoAlarm), the *new* countries include: **Australia, New Zealand,
Japan, South Korea, Taiwan, Philippines, Thailand, Singapore, Vietnam, Brazil,
Mexico, Colombia, Ecuador, Jamaica, Côte d'Ivoire**. That is almost exactly the
rest-of-world hole where `get_alerts` today returns the not-covered message — and
WMO SWIC, the keyless candidate for that hole, was verified not production-usable
during v1.19.0.

**What we already have:** nothing for those countries. This is gap-fill of *safety
data*, the highest-value category in the server's routing doctrine.

**Shape sketch (not designed):** keyed fallback for the "elsewhere" branch of the
existing country router only — NOAA/ECCC/MeteoAlarm keyless paths stay authoritative
and never contact Google (mirrors the pollen plan's "Europe never contacts Google"
rule). Without a key, the not-covered message stands, byte-identical. Verbatim
alert text + mandatory Google attribution footer, same licence discipline as the
MeteoAlarm renderer.

**Live to-verify (for a future design plan):** alert response shape and field set
(severity, expiry, polygons), the exact mandatory attribution string, behavior at a
covered-country point outside a provider polygon ("coverage alignment may not be
exact" per Google's docs), SKU tier of the alerts endpoint, uncovered-country
response shape, and whether Japan/South Korea/Vietnam — listed as *alerts-only*
territories — behave differently.

**Verdict:** the killer feature for the key. If only one more Google integration
ever ships, it should be this one.

### #2 — Minute-scale precipitation nowcast

**What it adds:** the Weather API advertises minute-by-minute precipitation
forecasting. Nothing in the server does textual nowcasting today — RainViewer
nowcast frames exist only as imagery on `get_weather_imagery`.

**What we already have:** Open-Meteo's 15-minutely variables (keyless) cover parts
of this in Central Europe/US; Google's would be broader if real.

**To-verify:** whether the minute endpoint is GA or still limited preview, its
coverage map, and its SKU tier. Docs are thin; treat as unverified.

**Verdict:** interesting, second priority; verify before planning.

### #3 — Air-quality enrichment on `get_air_quality`

**What it adds:** Google Air Quality API (`airquality.googleapis.com/v1`): 100+
countries at ~500 m resolution, Universal AQI **plus ~70 local national AQI
standards** (India NAQI, China AQI, …), per-population **health recommendation
text**, ~96 h hourly forecast, ~30-day history.

**What we already have:** Open-Meteo air quality is already global and keyless with
US + European AQI, pollutant concentrations, and a forecast. Google's
differentiators are the local national indices, the health-recommendation prose,
and finer resolution.

**Verdict:** enrichment, not gap-fill — garnish by doctrine. Worth considering only
after #1, if ever.

### #4 — AQ heatmap tiles on `get_weather_imagery`

**What it adds:** `heatmapTiles` endpoint serves AQ PNG tile overlays (US_AQI and
other map types), which could composite over the NASA GIBS base map exactly like
the v1.19.0 radar composite.

**Verdict:** niche; the composite machinery exists (`src/utils/composite.ts`,
`src/services/basemap.ts`) so the cost is moderate, but demand is unproven.

### Rejected outright

- **Weather API forecast / current conditions / history endpoints** — redundant with
  keyless NOAA/Open-Meteo/METAR; Google caps at 10 daily / 240 hourly vs
  Open-Meteo's 16 days, and history at 24 h vs Open-Meteo's 1940-present. Putting a
  keyed, quota'd source under data the server already gets keyless and unlimited
  would be strictly worse.
- **Solar API** — rooftop solar-potential assessments for buildings; not weather.
- **Geocoding / Time Zone / Elevation APIs** — Nominatim (keyless) already serves
  geocoding; timezone and elevation needs are met locally/from existing responses.

## The other two keys — no unused headroom

- **`FIRMS_MAP_KEY`** — the key is FIRMS-specific (Area API bbox queries with
  `day_range` 1–5, already implemented in v1.20.0). It unlocks nothing else at NASA;
  no headroom.
- **`NCEI_API_TOKEN`** — the CDO token reaches other NCEI datasets (GHCN-Daily
  station observations, monthly summaries), but Open-Meteo's keyless archive already
  covers 1940-present globally, and US daily records already come keyless from ACIS.
  The normals use shipped in v1.16.0 is the good one; no headroom worth planning.

## Sources (fetched 2026-08-18)

- https://developers.google.com/maps/documentation/weather/overview — endpoints,
  data fields, minute forecasting / alerts mentions
- https://developers.google.com/maps/documentation/weather/coverage — per-territory
  service matrix; alerts country list; exclusions (China, Cuba, Iran, North Korea,
  Syria; Japan/South Korea/Vietnam alerts-only)
- https://mapsplatform.google.com/resources/blog/introducing-the-google-maps-platform-weather-api-build-weather-aware-solutions/
  — launch (April 2025), GA (June 2025), $0.15/1,000 with 10,000 free calls/month
- https://developers.google.com/maps/documentation/air-quality/overview — AQ API
  features, 100+ countries, local AQIs, health recommendations
- https://developers.google.com/maps/documentation/air-quality/heatmaps — tile
  endpoint shape
- https://developers.google.com/maps/billing-and-pricing/pricing-categories — per-SKU
  tier free-call structure (Essentials 10K / Pro 5K / Enterprise 1K per month)
