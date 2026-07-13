# Tool Reference

Complete reference for all 16 MCP tools provided by the Weather MCP Server.

> **Note on tool presets:** By default the server exposes the `basic` preset (5 tools). Set `ENABLED_TOOLS=all` to enable everything. See [Tool Selection](../README.md#tool-selection) in the README.

## Contents

**Core Weather**
1. [get_forecast](#1-get_forecast) — Forecasts, global
2. [get_current_conditions](#2-get_current_conditions) — Real-time observations, US
3. [get_alerts](#3-get_alerts) — Watches/warnings/advisories, US
4. [get_historical_weather](#4-get_historical_weather) — 1940–present, global
5. [search_location](#5-search_location) — Geocoding, global
6. [check_service_status](#6-check_service_status) — API health checks

**Environment & Safety**

7. [get_air_quality](#7-get_air_quality) — AQI + pollutants, global
8. [get_marine_conditions](#8-get_marine_conditions) — Waves/swell/currents, global
9. [get_weather_imagery](#9-get_weather_imagery) — Radar, precipitation, and satellite imagery
10. [get_lightning_activity](#10-get_lightning_activity) — Strike detection, global
11. [get_river_conditions](#11-get_river_conditions) — River levels/flooding, US
12. [get_wildfire_info](#12-get_wildfire_info) — Active fires, US

**Saved Locations**

13. [save_location](#13-save_location)
14. [list_saved_locations](#14-list_saved_locations)
15. [get_saved_location](#15-get_saved_location)
16. [remove_saved_location](#16-remove_saved_location)

Also in this document:
- [Finding Coordinates](#finding-coordinates)
- [Using Saved Locations with Weather Tools](#using-saved-locations-with-weather-tools)
- [Units & Localization](#units--localization)
- [Error Handling & Service Status](#error-handling--service-status)

---

### 1. get_forecast
Get weather forecast for any location worldwide.

**Parameters:**
- `latitude` (required*): Latitude coordinate (-90 to 90)
- `longitude` (required*): Longitude coordinate (-180 to 180)
- `location_name` (optional): Name of a saved location (e.g., "home") — use instead of coordinates
- `city_name` (optional): Free-text place name to geocode (e.g., "Paris, France", "Bend, Oregon") — use instead of coordinates when you only have a place name
- `days` (optional): Number of days in forecast (1-16, default: 7)
- `granularity` (optional): "daily" or "hourly" (default: "daily")
- `include_precipitation_probability` (optional): Include rain chances (default: true)
- `include_normals` (optional): Include climate normals for comparison (default: false)
- `source` (optional): "auto" (default), "noaa" (US only), or "openmeteo" (global)
- `units` (optional): "imperial" (default) or "metric" — see [Units & Localization](#units--localization)
- Unit overrides (optional): `temperature_unit`, `wind_speed_unit`, `precipitation_unit`, `pressure_unit`, `distance_unit`, `time_format`

*Coordinates not required when `location_name` or `city_name` is provided. Precedence: coordinates > `location_name` > `city_name`.

**Description:**
Automatically selects the best data source: NOAA for US locations (more detailed) or Open-Meteo for international locations. Supports extended forecasts up to 16 days. Includes sunrise/sunset times, daylight duration, temperature, precipitation, wind, and UV index. When a location is resolved from `location_name` or `city_name`, the matched place is shown in a `**Location:**` header so ambiguous names are transparent.

**Examples:**
```
"Get a 7-day forecast for Paris (48.8534, 2.3488)"
"What's the forecast for Bend, Oregon?"   (uses city_name — no coordinates needed)
"Hourly forecast for Tokyo for the next 3 days"
"16-day extended forecast for Sydney, Australia"
```

**Returns:**
- Temperature (high/low, feels like)
- Sunrise and sunset times with daylight duration
- Precipitation chances and amounts
- Wind speed, direction, and gusts
- Weather conditions and descriptions
- UV index (for international locations)
- Humidity and atmospheric conditions
- Climate normals comparison (when `include_normals=true`)
- Snow and ice accumulation forecasts (when available)
- All timestamps in local timezone

### 2. get_current_conditions
Get current weather conditions for a location (US only).

**Parameters:**
- `latitude` (required): Latitude coordinate (-90 to 90)
- `longitude` (required): Longitude coordinate (-180 to 180)
- `include_fire_weather` (optional): Include fire weather indices (default: false)
- `include_normals` (optional): Include climate normals for comparison (default: false)
- `units` (optional): "imperial" (default) or "metric", plus per-unit overrides — see [Units & Localization](#units--localization)

**Example:**
```
What are the current weather conditions in New York? (latitude: 40.7128, longitude: -74.0060)
```

**Returns:**
- Current temperature, humidity, wind, pressure
- Heat index or wind chill (when applicable)
- 24-hour temperature range
- Recent precipitation
- Cloud cover and visibility
- Snow depth on ground (when available)
- Climate normals comparison (when `include_normals=true`)
- Fire weather indices (when `include_fire_weather=true`) — Haines Index, Grassland Fire Danger, Red Flag Threat, mixing height, transport winds
- All timestamps in local timezone

### 3. get_alerts
Get active weather alerts, watches, warnings, and advisories for US locations.

**Parameters:**
- `latitude` (required): Latitude coordinate (-90 to 90)
- `longitude` (required): Longitude coordinate (-180 to 180)
- `active_only` (optional): Show only active alerts (default: true)

**Description:**
Retrieves current weather alerts from the NOAA API for safety-critical weather information. Returns severity levels (Extreme, Severe, Moderate, Minor), urgency indicators, effective/expiration times, and affected areas. Alerts are automatically sorted by severity with the most critical first.

**Examples:**
```
"Are there any weather alerts for Miami, Florida?"
"Check for severe weather warnings in Oklahoma City"
"What weather watches are active in my area?" (latitude: 40.7128, longitude: -74.0060)
```

**Returns:**
- Alert type and severity (Extreme → Severe → Moderate → Minor)
- Urgency, certainty, and response type
- Event description and instructions
- Effective and expiration times
- Affected geographic areas
- Recommended actions and safety information

### 4. get_historical_weather
Get historical weather observations for a location.

**Parameters:**
- `latitude` (required): Latitude coordinate (-90 to 90)
- `longitude` (required): Longitude coordinate (-180 to 180)
- `start_date` (required): Start date in ISO format (YYYY-MM-DD)
- `end_date` (required): End date in ISO format (YYYY-MM-DD)
- `limit` (optional): Max observations to return (1-500, default: 168)
- `units` (optional): "imperial" (default) or "metric", plus per-unit overrides — see [Units & Localization](#units--localization)

**Data Source Selection:**
The server automatically chooses the best data source based on your date range:

- **Last 7 days**: Uses NOAA real-time API
  - ✓ Detailed hourly observations from weather stations
  - ✓ Includes: temperature, conditions, wind speed, humidity, pressure
  - ✓ High reliability and availability
  - ⚠️ US locations only

- **Older than 7 days**: Uses Open-Meteo Historical Weather API
  - ✓ No API token required
  - ✓ Global coverage (worldwide)
  - ✓ Historical data from 1940 to present
  - ✓ Hourly data for ranges up to 31 days
  - ✓ Daily summaries for longer periods
  - ✓ Includes: temperature, precipitation, wind, humidity, pressure, cloud cover
  - ✓ High resolution reanalysis data (9-25km grid)
  - ⚠️ 5-day delay for most recent data

**Examples:**

Recent data (US locations, detailed observations):
```
"What was the weather like in Chicago 3 days ago?"
Coordinates: latitude: 41.8781, longitude: -87.6298
Date range: 3 days ago to 2 days ago
```

Historical data (global coverage):
```
"What was the weather in Paris on January 15, 2024?"
Coordinates: latitude: 48.8566, longitude: 2.3522
Date range: 2024-01-15 to 2024-01-15
```

Long-term historical analysis:
```
"Show me weather data for Tokyo from January 1, 2020 to December 31, 2020"
Coordinates: latitude: 35.6762, longitude: 139.6503
Date range: 2020-01-01 to 2020-12-31
```

**Troubleshooting:**
If you get "No historical data available":
- For recent dates (last 7 days): Ensure you're using US coordinates
- For older dates: Data should be available globally back to 1940
- Note: Most recent data has a 5-day delay
- Very recent dates (last 5 days) may not be available in archival data yet

### 5. search_location
Find coordinates for any location worldwide by name.

**Parameters:**
- `query` (required): Location name to search for (e.g., "Paris", "New York, NY", "Tokyo")
- `limit` (optional): Maximum number of results to return (1-100, default: 5)

**Description:**
Converts location names to coordinates. Returns multiple matches with detailed metadata including coordinates, timezone, elevation, population, and administrative regions. Enables natural language weather queries by finding coordinates automatically.

**Examples:**
```
"Find coordinates for Paris"
"Search for Tokyo, Japan"
"Where is San Francisco, CA?"
```

**Returns:**
- Location name and full administrative hierarchy
- Latitude and longitude coordinates
- Timezone and elevation
- Population (when available)
- Country and region information
- Feature type (capital, city, airport, etc.)

### 6. check_service_status
Check the operational status of weather APIs and cache performance.

**Parameters:** None

**Description:**
Performs health checks on both NOAA and Open-Meteo APIs to verify they are operational. Use this tool when experiencing errors or to proactively verify service availability before making weather data requests. Returns current status, helpful messages, links to official status pages, and cache statistics.

**Example:**
```
Check if the weather services are operational
```

**Returns:**
- Operational status for NOAA API (forecasts & current conditions)
- Operational status for Open-Meteo API (historical data & forecasts)
- Cache statistics (hit rate, size, API call reduction)
- Status page links and recommended actions if issues are detected
- Overall service availability summary

### 7. get_air_quality
Get comprehensive air quality data for any location worldwide.

**Parameters:**
- `latitude` (required): Latitude coordinate (-90 to 90)
- `longitude` (required): Longitude coordinate (-180 to 180)
- `forecast` (optional): Include hourly forecast for next 5 days (default: false)

**Description:**
Provides current air quality conditions using the Open-Meteo Air Quality API with automatic AQI scale selection (US AQI for US locations, European EAQI elsewhere). Includes health recommendations, pollutant concentrations, and UV index.

**Examples:**
```
"What's the air quality in Los Angeles?"
"Check pollution levels in Beijing"
"Get air quality forecast for Paris for the next 5 days"
```

**Returns:**
- Air Quality Index (AQI) with appropriate scale (US or European)
- Health risk category and recommendations
- Pollutant concentrations (PM2.5, PM10, O₃, NO₂, SO₂, CO, NH₃)
- UV Index with sun protection guidance
- Activity recommendations for sensitive groups
- Optional 5-day hourly forecast

### 8. get_marine_conditions
Get marine weather conditions including wave height, swell, ocean currents, and sea state with automatic source selection for Great Lakes and coastal bays.

**Parameters:**
- `latitude` (required): Latitude coordinate (-90 to 90)
- `longitude` (required): Longitude coordinate (-180 to 180)
- `forecast` (optional): Include 5-day marine forecast (default: false)

**Description:**
Provides comprehensive marine weather data with intelligent dual-source support:
- **Great Lakes & Coastal Bays**: Automatically uses NOAA gridpoint data for all 5 Great Lakes (Superior, Michigan, Huron, Erie, Ontario) and major US coastal bays (Chesapeake Bay, San Francisco Bay, Tampa Bay, Puget Sound, Lake Okeechobee). Provides wave height, wave period, wave direction, and wind conditions.
- **Ocean Coverage**: Uses Open-Meteo Marine API for global ocean coverage, including significant wave height with Douglas Sea Scale categorization, wind waves vs swell separation, wave period/direction, ocean currents, and safety assessment for maritime activities.
- **Automatic Selection**: Intelligent geographic detection automatically selects the best data source with zero configuration required.

**Important:** Data has limited accuracy in coastal areas and is NOT suitable for coastal navigation — always consult official marine forecasts.

**Examples:**
```
"What are the ocean conditions off the coast of California?"
"Get wave height and swell for surfing in Hawaii"
"Check marine conditions in the Atlantic Ocean" (latitude: 30.0, longitude: -60.0)
```

**Returns:**
- Significant wave height (meters/feet) with safety category
- Wind waves (locally generated) height and direction
- Swell height, period, and direction (from distant systems)
- Ocean current velocity and direction
- Sea state interpretation (Calm → Phenomenal based on Douglas Sea Scale)
- Safety assessment for maritime activities
- Wave period for planning and safety
- Optional 5-day forecast with daily summaries

### 9. get_weather_imagery
Get weather radar, precipitation, and satellite imagery for visual weather analysis.

**Parameters:**
- `latitude` (required): Latitude coordinate (-90 to 90)
- `longitude` (required): Longitude coordinate (-180 to 180)
- `type` (optional): Imagery type - "precipitation" (default), "radar", or "satellite"
- `animated` (optional): Return animated loop vs static image (default: false)
- `layers` (optional): Additional map layers (reserved for future use)

**Description:**
Provides access to weather imagery from two sources: precipitation/radar tiles from the RainViewer API (global coverage, static or animated loops showing up to 2 hours of history), and satellite imagery from NOAA GOES-East/West ABI GeoColor via NASA GIBS (Western Hemisphere, day and night). Perfect for visual confirmation of approaching weather systems.

**Examples:**
```
"Show me the current radar for New York"
"Get animated precipitation radar for London for the last 2 hours"
"Show me a satellite image of the hurricane off Florida"
"Is there any precipitation showing on radar near me?"
```

**Returns:**
- Precipitation radar imagery (static or animated)
- Satellite snapshot (GOES GeoColor, when `type="satellite"`)
- Tile URLs for efficient rendering
- Frame timestamps for animated sequences
- Coverage area and resolution information
- Automatic coordinate-to-tile calculation
- Up to 2 hours of historical radar frames when animated

**Note:** Precipitation/radar coverage is global (RainViewer). Satellite coverage is Western Hemisphere only (GOES GeoColor via NASA GIBS).

### 10. get_lightning_activity
Get real-time lightning strike detection and safety assessment for outdoor activity planning.

**Parameters:**
- `latitude` (required): Latitude coordinate (-90 to 90)
- `longitude` (required): Longitude coordinate (-180 to 180)
- `radius` (optional): Search radius in kilometers (1-500, default: 100)
- `timeWindow` (optional): Historical time window in minutes (1-180, default: 60)

**Description:**
Provides real-time lightning strike detection from the Blitzortung.org global lightning detection network. Includes comprehensive safety assessment with 4 risk levels based on strike proximity. Critical for outdoor safety planning including boating, hiking, golfing, and other outdoor activities.

**Examples:**
```
"Are there any lightning strikes near Miami?"
"Check for lightning activity within 50km"
"Is it safe to be outside based on lightning?"
"Show me recent lightning strikes in the last hour"
```

**Returns:**
- Real-time lightning strikes within specified radius
- 4-level safety assessment:
  - **Safe** (>50km): No immediate lightning threat
  - **Elevated** (16-50km): Monitor conditions, plan indoor access
  - **High** (8-16km): Seek shelter immediately
  - **Extreme** (<8km): Active thunderstorm, dangerous conditions
- Comprehensive statistics:
  - Total strikes and strike density (per sq km)
  - Strikes per minute rate
  - Distance to nearest strike
  - Average distance of all strikes
- Strike details:
  - Polarity (cloud-to-ground vs intra-cloud)
  - Amplitude in kiloamperes (kA)
  - Precise timestamp and location
- Safety recommendations based on proximity
- Geographic region-optimized data retrieval

**Note:** Data provided by Blitzortung.org, a free community-operated lightning detection network. May have regional coverage variations.

### 11. get_river_conditions
Monitor river levels and flood status using NOAA and USGS data sources.

**Parameters:**
- `latitude` (required): Latitude coordinate (-90 to 90)
- `longitude` (required): Longitude coordinate (-180 to 180)
- `radius` (optional): Search radius in kilometers (1-500, default: 50)

**Description:**
Provides comprehensive river and streamflow monitoring for flood safety and recreation planning. Automatically finds the nearest river gauges within the specified radius and reports current water levels, flood stages, and flow rates. Uses NOAA National Water Prediction Service (NWPS) for gauge locations and USGS Water Services for real-time streamflow data.

**Examples:**
```
"What are the river conditions near St. Louis?" (latitude: 38.6270, longitude: -90.1994)
"Check for flooding on the Mississippi River"
"Is the river level safe for kayaking?"
"Show me nearby river gauge readings"
```

**Returns:**
- Nearest river gauges with current water levels
- Flood stage thresholds (action, minor, moderate, major)
- Current flood status and forecast
- Streamflow data (cubic feet per second)
- Distance to each gauge from query location
- River and location names
- Safety assessment for recreation
- Historical context (flood crests if available)

**Note:** US coverage only. Data provided by NOAA National Water Prediction Service and USGS Water Services.

### 12. get_wildfire_info
Monitor active wildfires and fire perimeters for safety and evacuation planning.

**Parameters:**
- `latitude` (required): Latitude coordinate (-90 to 90)
- `longitude` (required): Longitude coordinate (-180 to 180)
- `radius` (optional): Search radius in kilometers (1-500, default: 100)

**Description:**
Provides critical wildfire monitoring and safety information using NIFC (National Interagency Fire Center) data. Reports active wildfires and prescribed burns within the specified radius, including fire size, containment status, and proximity-based safety assessments. Essential for residents in fire-prone regions and outdoor activity planning.

**Examples:**
```
"Are there any wildfires near Los Angeles?" (latitude: 34.0522, longitude: -118.2437)
"Check for active fires in Colorado"
"How close is the nearest wildfire?"
"Show me fire perimeters and containment status"
```

**Returns:**
- Active wildfire locations within search radius
- Fire size in acres and hectares
- Containment percentage with visual indicator
- Distance from query location to each fire
- Discovery date and days active
- Fire type (Wildfire vs Prescribed Fire)
- Location details (state, county, city)
- 4-level safety assessment:
  - **EXTREME DANGER** (<5km): Evacuate if advised
  - **HIGH ALERT** (5-25km): Prepare for evacuation
  - **CAUTION** (25-50km): Monitor conditions
  - **AWARENESS** (>50km): Stay informed
- Evacuation recommendations and safety guidance

**Note:** Data from NIFC WFIGS (Wildland Fire Interagency Geospatial Services). Always consult official sources for evacuation orders at https://inciweb.nwcg.gov/

### 13. save_location
Save a location with an alias for easy reuse in weather queries.

**Parameters:**
- `alias` (required): Short name for the location (e.g., "home", "work", "cabin"). Max 50 characters.
- `location_query` (optional): Location to geocode and save (e.g., "Seattle, WA", "Paris, France"). Not required if latitude/longitude provided.
- `latitude` (optional): Latitude if providing coordinates directly. Not required if location_query provided.
- `longitude` (optional): Longitude if providing coordinates directly. Not required if location_query provided.
- `name` (optional): Display name (required when using latitude/longitude directly)
- `activities` (optional): Activities you do at this location (e.g., ["boating", "fishing"]). Helps AI provide relevant weather information. Each activity max 50 characters.

**Description:**
Saves a location to persistent storage (`~/.weather-mcp/locations.json`) for easy reuse. Accepts either a location query (which will be automatically geocoded using Nominatim/OpenStreetMap) or direct coordinates. Once saved, the location can be used in any weather tool by providing `location_name` instead of coordinates.

**Smart Updates:** If the alias already exists and you only provide `name` and/or `activities` (without location details), it will update just those fields while preserving all coordinates and metadata. This makes it easy to add activities or rename locations without re-specifying the full address.

**Examples:**
```
"Save my home location in Seattle, WA"
  → save_location(alias="home", location_query="Seattle, WA")

"Save the cabin at Lake Tahoe"
  → save_location(alias="cabin", location_query="Lake Tahoe, CA")

"Save coordinates 47.6062, -122.3321 as my office"
  → save_location(alias="office", latitude=47.6062, longitude=-122.3321, name="Seattle Office")

"Save the lake house where we go boating and fishing"
  → save_location(alias="lake_house", location_query="Lake Tahoe, CA", activities=["boating", "fishing"])

"Save my favorite hiking spot"
  → save_location(alias="trail", location_query="Mt. Rainier, WA", activities=["hiking", "camping", "photography"])

"Add more activities to the cabin" (smart update - no location needed)
  → save_location(alias="cabin", activities=["boating", "fishing", "hiking", "swimming"])

"Rename my campsite" (smart update - no location needed)
  → save_location(alias="campsite", name="Yosemite Valley Campground")
```

**Returns:**
- Confirmation of save with location details
- Coordinates, timezone, and administrative region
- Usage examples showing how to use with weather tools

### 14. list_saved_locations
View all saved locations.

**Parameters:** None

**Description:**
Lists all locations saved in your persistent storage with their aliases, names, coordinates, and save dates. Helpful for seeing what location names are available for use with weather tools.

**Examples:**
```
"Show my saved locations"
"What locations do I have saved?"
"List all my saved places"
```

**Returns:**
- List of all saved locations with full details
- Usage examples for each location
- Total count of saved locations

### 15. get_saved_location
Get details for a specific saved location.

**Parameters:**
- `alias` (required): The name of the saved location to retrieve (e.g., "home", "work")

**Description:**
Retrieves detailed information about a specific saved location, including coordinates, timezone, region information, and save/update timestamps.

**Examples:**
```
"Show details for my home location"
"What are the coordinates for my cabin?"
"Get info about my work location"
```

**Returns:**
- Location name and coordinates
- Timezone and administrative regions
- Save and update timestamps
- Usage examples

### 16. remove_saved_location
Remove a saved location.

**Parameters:**
- `alias` (required): The name of the saved location to remove (e.g., "home", "work")

**Description:**
Permanently removes a saved location from storage. The location data is deleted and can no longer be used with weather tools unless saved again.

**Examples:**
```
"Remove my work location"
"Delete the cabin from saved locations"
"Remove home"
```

**Returns:**
- Confirmation of removal
- Count of remaining saved locations

---

## Finding Coordinates

Use the built-in `search_location` tool to find coordinates automatically:

```
"What's the weather in Paris?"
→ Uses search_location to find Paris coordinates (48.8534°, 2.3488°)
→ Then gets the forecast for those coordinates
```

You can also find coordinates manually:
- Using Google Maps: Right-click a location and select the coordinates
- Using a geocoding service like geocode.maps.co or nominatim.org

### Common City Coordinates (For Reference)

| City | Latitude | Longitude |
|------|----------|-----------|
| Paris, France | 48.8534 | 2.3488 |
| Tokyo, Japan | 35.6895 | 139.6917 |
| London, UK | 51.5085 | -0.1257 |
| New York, NY | 40.7128 | -74.0060 |
| San Francisco, CA | 37.7749 | -122.4194 |
| Sydney, Australia | -33.8688 | 151.2093 |
| Berlin, Germany | 52.5200 | 13.4050 |
| Dubai, UAE | 25.2048 | 55.2708 |

## Using Saved Locations with Weather Tools

Once you've saved locations, you can use them by providing `location_name` instead of coordinates:

```
# Instead of:
get_forecast(latitude=47.6062, longitude=-122.3321)

# You can use:
get_forecast(location_name="home")

# Natural language queries work too:
"What's the weather forecast at home?"
"How's the air quality at my cabin?"
```

**Currently Supported Tools:**
- `get_forecast` - Weather forecasts using saved locations

**Coming Soon:** Support for saved locations in all weather tools (current conditions, alerts, air quality, marine conditions, etc.)

## Units & Localization

Weather output defaults to **imperial** units and can be switched to **metric** either server-wide (environment variables) or per request (tool parameters). Precedence, highest first: a per-call `*_unit` override → a per-call `units` preset → a per-unit env override → the `WEATHER_UNITS` env default → imperial.

**Per-call parameters** (on `get_forecast`, `get_current_conditions`, `get_historical_weather`):

| Parameter | Values | Applies to |
|-----------|--------|------------|
| `units` | `imperial`, `metric` | Whole system (sets all of the below) |
| `temperature_unit` | `F`, `C` | Temperature, dewpoint, feels-like, normals |
| `wind_speed_unit` | `mph`, `kmh`, `ms`, `kn` | Wind speed and gusts |
| `precipitation_unit` | `inch`, `mm` | Precipitation, snowfall |
| `pressure_unit` | `inHg`, `hPa` | Barometric pressure |
| `distance_unit` | `mi`, `km` | Visibility, elevation |
| `time_format` | `12h`, `24h` | Clock times (headers, sunrise/sunset) |

**Environment defaults:** `WEATHER_UNITS` (`imperial`\|`metric`), plus `WEATHER_TEMPERATURE_UNIT`, `WEATHER_WIND_SPEED_UNIT`, `WEATHER_PRECIPITATION_UNIT`, `WEATHER_PRESSURE_UNIT`, `WEATHER_DISTANCE_UNIT`, `WEATHER_TIME_FORMAT`.

**Examples:**
```
"What's the forecast for Berlin in Celsius?"  → units: "metric"
"Wind in knots for the marina"                → wind_speed_unit: "kn"
```

**Note:** Fire-weather heights/transport wind, river gauge stage, and the marine tool's wave output use their domain-standard units and are not affected by this setting.

## Error Handling & Service Status

### Enhanced Error Messages

All error messages include:

- **Clear problem description** - What went wrong and why
- **Contextual help** - Specific guidance based on the error type
- **Status page links** - Direct links to official service status pages
- **Recommended actions** - Concrete steps to resolve or investigate the issue

**Example error messages:**

When a service is down:
```
NOAA API server error: Service temporarily unavailable

The NOAA Weather API may be experiencing an outage.

Check service status:
- Planned outages: https://weather-gov.github.io/api/planned-outages
- Service notices: https://www.weather.gov/notification
- Report issues: nco.ops@noaa.gov or (301) 683-1518
```

When rate limited:
```
Open-Meteo API rate limit exceeded (10,000 requests/day for non-commercial use).

Please retry later or consider:
- Reducing request frequency
- Using daily instead of hourly data for longer periods
- Upgrading to a commercial plan for higher limits

More info: https://open-meteo.com/en/pricing
```

### Service Status Checking

Use the `check_service_status` tool to proactively verify API availability:

**When to use:**
- Before making multiple weather requests
- When experiencing errors or timeouts
- To verify service availability after an outage
- For monitoring and alerting purposes

**Status Page Links:**
- **NOAA API:**
  - Planned outages: https://weather-gov.github.io/api/planned-outages
  - Service notices: https://www.weather.gov/notification
  - Report issues: https://weather-gov.github.io/api/reporting-issues

- **Open-Meteo API:**
  - Production status: https://open-meteo.com/en/docs/model-updates
  - GitHub issues: https://github.com/open-meteo/open-meteo/issues
  - Documentation: https://open-meteo.com/en/docs
