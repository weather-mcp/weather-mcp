# Examples — real prompts, real output

Each file in this folder is a realistic session: a user prompt, the answer **Claude Code** gave, and — in collapsible blocks — the exact tool call and the **verbatim server output** behind it.

**How to read these honestly:** the conversational answers were written by Claude Code from this server's data (that's the product working as intended — an AI assistant turning tool output into a friendly reply). The raw server output in each `<details>` block is captured byte-for-byte over the real MCP protocol from `dist/index.js` and can be regenerated any time with `npm run build && npm run examples`. Weather is live data, so numbers reflect the capture date stamped at the bottom of each file.

## The scenarios

| Example | Location(s) | What it shows off |
|---|---|---|
| [Planning a weekend trip](./weekend-trip-planning.md) | Tokyo | Forecast by free-text city name, moon phase & twilight (`include_astronomy`), live radar with a committed snapshot |
| [A hazardous-weather day](./severe-weather-day.md) | Oklahoma City | One-call weather summary, full alert text (`detail: "full"`), animated radar |
| [A day on the water](./boating-and-marine.md) | Sydney | Marine forecast (waves, swell, currents), real-time lightning detection, metric units |
| [Traveling abroad](./international-travel.md) | Paris | Real airport station observations anywhere on earth (`source: "metar"`), European pollen levels |
| [River levels, two ways](./river-and-flood.md) | Memphis + Manaus | US flood-stage gauges vs. global modeled river discharge — same tool, honest about the difference |
| [Wildfire season check-in](./wildfire-awareness.md) | Denver | Active fires with containment & distance, smoke via US AQI |
| [Reaching into the past](./historical-climate.md) | Berlin 1945 + Chicago | Historical archive back to 1940, climate normals & US record high/low for the date |
| [Saving your places](./saved-locations-workflow.md) | Lake Tahoe | Save a location once ("cabin"), then ask about it by name |

## Tool coverage

All 17 tools appear across these examples:

| Tool | Shown in |
|---|---|
| `get_forecast` | [trip planning](./weekend-trip-planning.md), [saved locations](./saved-locations-workflow.md) |
| `get_current_conditions` | [international travel](./international-travel.md) (METAR), [historical & climate](./historical-climate.md) (normals + records) |
| `get_alerts` | [severe weather](./severe-weather-day.md) |
| `get_historical_weather` | [historical & climate](./historical-climate.md) |
| `get_weather_summary` | [severe weather](./severe-weather-day.md) |
| `check_service_status` | below on this page |
| `search_location` | [saved locations](./saved-locations-workflow.md) |
| `get_air_quality` | [international travel](./international-travel.md) (pollen), [wildfire](./wildfire-awareness.md) (smoke) |
| `get_marine_conditions` | [boating](./boating-and-marine.md) |
| `get_weather_imagery` | [trip planning](./weekend-trip-planning.md) (with snapshot), [severe weather](./severe-weather-day.md) |
| `get_lightning_activity` | [boating](./boating-and-marine.md) |
| `get_river_conditions` | [rivers & flood](./river-and-flood.md) (both US and global paths) |
| `get_wildfire_info` | [wildfire](./wildfire-awareness.md) |
| `save_location`, `list_saved_locations`, `get_saved_location`, `remove_saved_location` | [saved locations](./saved-locations-workflow.md) |

## Bonus: is everything up?

`check_service_status` reports the health of every upstream API — handy when a tool errors:

<!-- capture:service-status -->
<details>
<summary>🔍 Tool call & raw server output — <code>check_service_status</code></summary>

**Call:**

```js
check_service_status({})
```

**The server returned** (verbatim — this is exactly what the MCP client receives):

````markdown
# Weather API Service Status

**Check Time:** 8/13/2026, 4:08:49 PM

## Server Version

**Installed Version:** 1.18.0
**Latest Release:** https://github.com/weather-mcp/weather-mcp/releases/latest
**Changelog:** https://github.com/weather-mcp/weather-mcp/blob/main/CHANGELOG.md
**Upgrade Instructions:** See README.md "Upgrading to Latest Version" section

*Tip: Use `npx -y @dangahagan/weather-mcp@latest` in your MCP config to always run the newest version.*

## NOAA Weather API (Forecasts & Current Conditions)

**Status:** ✅ Operational
**Message:** NOAA Weather API is operational
**Status Page:** https://weather-gov.github.io/api/planned-outages
**Coverage:** United States locations only

## Open-Meteo API (Historical Weather Data)

**Status:** ✅ Operational
**Message:** Open-Meteo API is operational
**Status Page:** https://open-meteo.com/en/docs/model-updates
**Coverage:** Global (worldwide locations)

## Cache Statistics

**Cache Status:** ✅ Enabled
**Overall Hit Rate:** 0.0%
**Total Cache Hits:** 0
**Total Cache Misses:** 0
**Total Requests:** 0

### NOAA Service Cache
- Entries: 0 / 1000
- Hit Rate: 0.0%
- Hits: 0
- Misses: 0
- Evictions: 0

### Open-Meteo Service Cache
- Entries: 0 / 1000
- Hit Rate: 0.0%
- Hits: 0
- Misses: 0
- Evictions: 0

*Cache reduces API calls and improves performance for repeated queries.*

## Overall Status: ✅ All Services Operational

Both NOAA and Open-Meteo APIs are functioning normally. Weather data requests should succeed.
````

</details>
<!-- /capture:service-status -->

## Regenerating

```bash
npm run build && npm run examples
```

`scripts/capture-examples.mjs` spawns the built server as a real MCP stdio subprocess, replays the manifest of tool calls, and splices fresh output into these files between `<!-- capture:* -->` markers — the surrounding prose is never touched. The saved-locations scenario runs against a scratch `HOME`, so it never touches your real `~/.weather-mcp/locations.json` (the one edit made to that scenario's otherwise-verbatim output: the scratch path is rewritten to `~`, which is what the path looks like on a real install).

**About imagery links:** the radar URLs inside captured output expire — RainViewer retains only ~2 hours of frames — and a tile over dry skies renders blank, since radar tiles are transparent precipitation overlays. So the imagery examples also commit a PNG snapshot (`images/`), downloaded by the capture script at capture time; it warns if the saved tile looks echo-free so a blank snapshot never ships unnoticed. Verify the image visually after regenerating.

<!-- capture-stamp -->
*Captured 2026-08-13 with weather-mcp v1.18.0 — raw output is live data and will differ when regenerated (`npm run examples`).*
<!-- /capture-stamp -->
