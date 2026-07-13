# Code Review - 2026-07-13

## Scope

Reviewed the Weather MCP TypeScript server with emphasis on:

- MCP tool count and whether the tool set is easy for AI assistants to use.
- Opportunities to preserve the feature set while reducing tool-choice friction.
- Output quality, token efficiency, and user-facing consistency.
- Local build/type/test signal available from this workspace.

## Summary

The project exposes 16 MCP tools in code. The domain split is mostly sensible: forecasts, current conditions, alerts, historical weather, environmental/safety tools, imagery, and saved-location management each have distinct user intents and data sources. I would not remove the core weather/environmental tools.

The biggest usability problem is not the total number of tools. It is that the location model is inconsistent. `get_forecast` accepts coordinates, saved `location_name`, or `city_name`, but most other weather tools only accept raw coordinates. Saved-location responses and docs imply broader support than the handlers actually provide. This will cause assistants to make invalid calls and forces unnecessary `search_location` hops.

The second major issue is preset/documentation drift. The code's default `basic` preset contains 9 tools, while README/docs describe it as 5 tools. That matters because tool count is part of the user-facing product promise.

## Findings

### High: Saved-location guidance advertises calls that the tool schemas reject

References:

- `src/handlers/savedLocationsHandler.ts:241`
- `src/handlers/savedLocationsHandler.ts:243`
- `src/handlers/savedLocationsHandler.ts:244`
- `src/handlers/savedLocationsHandler.ts:429`
- `src/handlers/savedLocationsHandler.ts:430`
- `src/handlers/savedLocationsHandler.ts:431`
- `src/handlers/savedLocationsHandler.ts:432`
- `src/index.ts:300`
- `src/index.ts:328`
- `src/index.ts:427`

The save/get saved-location responses tell users and assistants that saved locations can be used with "any weather tool", including examples like:

- `get_current_conditions(location_name="home")`
- `get_alerts(location_name="home")`
- `get_air_quality(location_name="home")`

However, `get_current_conditions`, `get_alerts`, and `get_air_quality` schemas require `latitude` and `longitude`, and their handlers call `validateCoordinates(args)` directly. The same coordinate-only pattern exists for marine, imagery, lightning, river, and wildfire tools.

Impact:

- Assistants will follow the tool's own output and make calls that fail validation.
- Saved locations feel unreliable even though the underlying location store works.
- The server spends tool calls explaining invalid usage instead of answering weather questions.

Recommendation:

Extend the existing `resolveLocationAsync` pattern to all coordinate-based weather tools. Each tool should accept the same location alternatives:

- `latitude` + `longitude`
- `location_name`
- `city_name`

Then add a shared schema fragment so tool definitions stay consistent. If that is too large for one release, immediately correct the saved-location output to list only supported calls, then add universal location resolution as the next usability release.

### Medium: Default tool preset documentation is wrong

References:

- `src/config/tools.ts:38`
- `src/config/tools.ts:40`
- `src/config/tools.ts:49`
- `README.md:186`
- `README.md:188`
- `docs/TOOLS.md:5`

The actual default `basic` preset includes 9 tools:

- `get_forecast`
- `get_current_conditions`
- `get_alerts`
- `search_location`
- `check_service_status`
- `save_location`
- `list_saved_locations`
- `get_saved_location`
- `remove_saved_location`

The README says default basic is 5 tools, and `docs/TOOLS.md` explicitly says "basic preset (5 tools)".

Impact:

- Users trying to reduce context overhead get a larger tool surface than documented.
- Evaluating MCP usability becomes confusing because the advertised and actual default are different.

Recommendation:

Decide whether saved-location CRUD belongs in the default preset.

Best usability options:

1. Keep `basic` at 5 tools as documented: forecast, current, alerts, search, status. Move saved-location tools to `standard` or a new `locations` add-on.
2. Keep code as-is and update README/docs to say default is 9 tools.

I lean toward option 1 if "easier for AI assistants" is the priority. Saved locations are valuable, but they are management tools and add four choices to every default install.

### Medium: Location lookup is not consistently available across weather tools

References:

- `src/index.ts:206`
- `src/index.ts:222`
- `src/index.ts:226`
- `src/index.ts:300`
- `src/index.ts:328`
- `src/index.ts:455`
- `src/index.ts:489`
- `src/index.ts:526`
- `src/index.ts:556`
- `src/index.ts:586`
- `src/utils/locationResolver.ts:153`

`get_forecast` has the right assistant-friendly interface: the model can pass a city name directly, and the server handles geocoding/caching. Other location-based tools still force coordinates. This means a natural user question like "Is there lightning near Bend?" requires the assistant to call `search_location`, parse output text, then call `get_lightning_activity`.

Impact:

- More tool calls.
- More chances for parsing mistakes.
- `search_location` becomes a workaround instead of a deliberate disambiguation tool.

Recommendation:

Make direct geocoding and saved-location resolution a platform capability, not a forecast-only feature. Add a shared `LOCATION_SCHEMA_PROPERTIES` fragment and a helper like:

```ts
resolveWeatherLocation(args, locationStore, geocodingService)
```

Return the resolved display name in every weather output when the input was `location_name` or `city_name`, matching the forecast handler's existing behavior.

### Medium: Output defaults are often too verbose for assistant workflows

References:

- `src/handlers/forecastHandler.ts:300`
- `src/handlers/forecastHandler.ts:309`
- `src/handlers/forecastHandler.ts:324`
- `src/handlers/alertsHandler.ts:91`
- `src/handlers/alertsHandler.ts:110`
- `src/handlers/weatherImageryHandler.ts:120`

The tools return rich Markdown, which is good for users, but some defaults can be expensive:

- Hourly forecast can emit up to `days * 24`, with schema allowing 16 days. That can be 384 hourly sections.
- Alerts include full descriptions and instructions for every alert.
- Imagery embeds Markdown image tags directly, which may be useful in some clients but noisy in text-only agents.

Impact:

- Larger context usage.
- Harder assistant summarization.
- Slower responses for common "quick answer" questions.

Recommendation:

Add a common output-control parameter to high-volume tools:

- `detail`: `summary | standard | full`
- default `standard`

Suggested behavior:

- Forecast hourly default should cap to 24-48 hours unless the user explicitly requests more.
- Alerts default should include headline/severity/timing/instruction summary, with `full` for full descriptions.
- Imagery should include direct URLs and metadata first, with Markdown image embedding behind `render_markdown_images: true` or `detail: full`.

This preserves the feature set while making the tools more predictable for AI assistants.

### Low: NOAA forecast path can avoid repeated point/grid lookups

References:

- `src/handlers/forecastHandler.ts:292`
- `src/handlers/forecastHandler.ts:301`
- `src/handlers/forecastHandler.ts:367`
- `src/handlers/forecastHandler.ts:381`
- `src/services/noaa.ts:360`
- `src/services/noaa.ts:405`

`formatNOAAForecast` calls `getPointData` for timezone, then calls `getForecastByCoordinates`, which calls `getPointData` again. It may also call `getGridpointDataByCoordinates` for severe weather and again for winter data, although caching reduces the network impact.

Impact:

- With cache enabled, this is mostly extra cache lookups and code complexity.
- With cache disabled or cold cache, it can become extra upstream calls.

Recommendation:

Fetch point data once and pass `gridId`, `gridX`, and `gridY` to lower-level NOAA service methods. A helper returning `{ pointData, forecast, gridpointData? }` would make this path clearer and reduce accidental duplicate upstream requests.

### Low: `search_location` escapes the query but not provider-returned strings

References:

- `src/handlers/locationHandler.ts:60`
- `src/handlers/locationHandler.ts:66`
- `src/handlers/locationHandler.ts:74`

The user query is Markdown-escaped, but returned fields such as `location.name` and `location.display_name` are inserted raw. These fields come from external providers and can contain characters that alter Markdown rendering.

Impact:

- Low security risk, but malformed provider text could produce confusing output.

Recommendation:

Apply the same `escapeMarkdown` helper to all provider-returned text fields used in Markdown output.

## Tool Surface Assessment

Current total: 16 tools.

Actual default: 9 tools from the `basic` preset.

Advertised default: 5 tools in README/docs.

### Keep As Separate Tools

These tool boundaries make sense and should stay separate because they represent distinct user intents or data products:

- `get_forecast`
- `get_current_conditions`
- `get_alerts`
- `get_historical_weather`
- `search_location`
- `check_service_status`
- `get_air_quality`
- `get_marine_conditions`
- `get_weather_imagery`
- `get_lightning_activity`
- `get_river_conditions`
- `get_wildfire_info`

The environmental and safety tools overlap geographically but not semantically. Combining them into one large "environment" tool would likely make parameters and output less clear.

### Best Candidates To Combine

The four saved-location management tools are the only strong consolidation candidate:

- `save_location`
- `list_saved_locations`
- `get_saved_location`
- `remove_saved_location`

They could become one `manage_saved_locations` tool with an `action` enum: `save`, `list`, `get`, `remove`.

Tradeoff:

- Fewer MCP tools and less default context.
- More conditional input schema complexity.

If compatibility matters, keep the existing four tools but remove them from `basic` and expose them in `standard`, `all`, or a new `locations` preset.

### Consider Adding A Composite Tool

Rather than eliminating domain tools, consider adding one high-level tool:

`get_weather_summary`

Purpose:

- Answer common user questions with one call.
- Inputs: same shared location fields, `include` array (`current`, `forecast`, `alerts`, `air_quality`, `lightning`, etc.), `detail`, `days`.
- Defaults: current + forecast + alerts when available.

This would be easier for assistants than deciding among 16 specialized tools for broad prompts like "What's the weather like in Seattle today, and is it safe to hike?"

Keep specialized tools for precise follow-up questions.

## Output Improvements

Recommended cross-tool output pattern:

1. Start with a short summary line.
2. Include location resolution when a name was used.
3. Put safety-critical issues before routine details.
4. Include data source and timestamp.
5. Make verbose details opt-in.

Example shape:

```md
# Weather Summary

**Location:** Bend, Oregon (44.0582, -121.3153)
**Updated:** 2026-07-13 09:15 PDT

**Bottom line:** Warm and dry today. No active NOAA alerts. Air quality is moderate.

## Key Details
...

---
*Data sources: NOAA, Open-Meteo*
```

## Verification

Commands run:

- `npx tsc --noEmit` - passed.
- `npm run build` - not verified in this sandbox. It failed because TypeScript attempted to write compiled files under `/home/dgahagan/.../dist`, which is read-only in this environment; the writable workspace path is `/var/home/dgahagan/...`.
- `npm test` - not verified in this sandbox. Vitest attempted to write a bundled config under `/home/dgahagan/.../node_modules/.vite-temp`, which is read-only here.

## Recommended Priority Order

1. Fix the saved-location mismatch, preferably by adding shared location resolution to every coordinate-based weather tool.
2. Align the default preset docs and implementation.
3. Add output `detail` controls for high-volume tools.
4. Decide whether saved-location CRUD should remain four separate tools or move out of the default preset.
5. Optimize NOAA forecast point/grid lookup reuse.
6. Escape provider-returned strings in `search_location`.
