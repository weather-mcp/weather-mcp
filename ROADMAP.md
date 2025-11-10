# Weather MCP Roadmap

This document outlines planned enhancements for future versions of the Weather MCP server.

## Design Philosophy: Lean & Efficient

**Core Principle:** Maximize functionality while minimizing token overhead and tool proliferation.

- **Parameters over proliferation:** Enhance existing tools with parameters rather than creating new tools
- **Clear semantic boundaries:** Each tool has ONE distinct purpose
- **Token efficiency:** Keep total tools under 8-10 to minimize AI confusion and token costs
- **User value first:** Prioritize features that enable natural AI conversations and safety

### Token Budget Analysis

**Current State (v0.1.2 with caching):**
- 4 tools
- ~700 tokens for tool definitions (0.35% of 200k context)

**Target State (v1.0.0):**
- 8-9 tools max
- ~1,500 tokens for tool definitions (0.75% of 200k context)
- **4x functionality increase with only 2x tool count**

---

## Version Planning

### v0.3.0 - Enhanced Core Tools ✅ COMPLETE

**Status:** Implemented and tested on 2025-11-05

**Theme:** Maximize existing tools, add critical safety feature

**Goal:** Add substantial functionality without tool bloat

**Achievement:** All features implemented successfully with 6/6 tests passing

#### 1. Enhance `get_forecast` Tool (NO new tool)
**Add parameters instead of creating separate tools:**
```typescript
get_forecast({
  latitude: number,
  longitude: number,
  days?: 1-7,           // existing
  granularity?: "daily" | "hourly",  // NEW: hourly vs daily periods
  include_precipitation_probability?: boolean  // NEW: show rain chances
})
```

**What this adds:**
- ✅ Hourly forecasts (hour-by-hour detail)
- ✅ Precipitation probability in output
- ✅ User can choose daily or hourly granularity
- **Token cost:** +100 tokens to existing tool description
- **New tools added:** 0
- **User queries enabled:**
  - "Give me hourly temperatures for tomorrow"
  - "What's the chance of rain today?"
  - "Show me hour-by-hour forecast"

**Implementation:**
- Expose existing `getHourlyForecast()` method via parameter
- Add precipitation probability to output formatting (already in API data)
- Default to daily for backward compatibility

#### 2. Enhance `get_current_conditions` Tool (NO new tool)
**Improve output formatting without changing interface:**

**What this adds:**
- ✅ Heat index / wind chill (automatically when relevant)
- ✅ 24-hour high/low temperatures
- ✅ Recent precipitation (last 1/3/6 hours)
- ✅ Better cloud cover and visibility details
- **Token cost:** 0 (same tool description, better output)
- **New tools added:** 0
- **User queries improved:**
  - "How hot does it feel?" → sees heat index
  - "What was today's high?" → sees 24hr max/min

**Implementation:**
- Parse additional fields already in NOAA observation responses
- Intelligent display: show heat index when >80°F, wind chill when <40°F
- Format precipitation history from existing data

#### 3. Add `get_alerts` Tool ⭐ NEW TOOL
**Critical safety feature - warrants dedicated tool:**
```typescript
get_alerts({
  latitude: number,
  longitude: number,
  active_only?: boolean  // default: true
})
```

**What this adds:**
- ✅ Active watches, warnings, advisories (NOAA)
- ✅ Severity levels, urgency, certainty
- ✅ Effective/expiration times
- ✅ Affected areas and event types
- **Token cost:** +200 tokens (new tool)
- **New tools added:** 1
- **User queries enabled:**
  - "Are there any weather alerts in my area?"
  - "Is there a tornado watch active?"
  - "Show me weather warnings"

**Why a separate tool:**
- Distinct purpose (safety-critical)
- Different data source (alerts endpoint)
- Called in different contexts than forecast
- High-priority queries that shouldn't be conflated

**Summary for v0.3.0:** ✅ COMPLETE
- **Tools added:** 1 (get_alerts) ✅
- **Tools enhanced:** 2 (get_forecast, get_current_conditions) ✅
- **Token cost:** ~300 tokens ✅
- **Effort:** 1 day (2025-11-05) ✅
- **Value:** Safety + hourly forecasts + better current conditions ✅
- **Testing:** All 6 integration tests passing ✅

---

### v0.4.0 - Global Expansion & Location Intelligence ✅ COMPLETE

**Status:** Implemented and tested on 2025-11-06

**Theme:** Remove geographic limitations, enable natural location queries

**Goal:** Global coverage + natural language location queries

**Achievement:** All features implemented successfully with 247/247 tests passing

#### 1. Add `search_location` Tool ⭐ NEW TOOL
**Enable natural location queries:**
```typescript
search_location({
  query: string,        // "Paris", "Tokyo", "San Francisco, CA"
  limit?: number        // max results, default: 5
})
```

**What this adds:**
- ✅ Location name → coordinates resolution
- ✅ Reverse geocoding support
- ✅ Multiple result handling
- ✅ Location metadata (country, admin area, timezone)
- **Token cost:** +150 tokens (new tool)
- **New tools added:** 1
- **User queries enabled:**
  - "What's the weather in Paris?" (no coordinates needed!)
  - "Find coordinates for Tokyo"
  - "Weather in downtown Seattle"

**Why a separate tool:**
- Fundamentally different operation (search, not weather data)
- May need to be called before other tools
- Returns different data type (location metadata, not weather)
- Enables conversational flow: search → forecast

**Implementation:**
- Use Open-Meteo Geocoding API (free, no API key)
- Cache results indefinitely (locations don't move)
- Return top matches with relevance scores

#### 2. Enhance `get_forecast` for Global Coverage (NO new tool)
**Add parameter for forecast source:**
```typescript
get_forecast({
  latitude: number,
  longitude: number,
  days?: 1-16,          // EXPANDED: was 1-7, now supports 16-day
  granularity?: "daily" | "hourly",
  include_precipitation_probability?: boolean,
  source?: "auto" | "noaa" | "openmeteo"  // NEW: optional source selection
})
```

**What this adds:**
- ✅ Global forecast support (Open-Meteo Forecast API)
- ✅ Extended forecasts up to 16 days
- ✅ International location forecasts
- ✅ Automatic source selection (NOAA for US, Open-Meteo elsewhere)
- **Token cost:** +50 tokens (update description)
- **New tools added:** 0
- **User queries enabled:**
  - "What's the forecast for London?" (was US-only)
  - "Give me a 10-day forecast for Tokyo"
  - "Weather forecast for Sydney next week"

**Implementation:**
- Integrate Open-Meteo Forecast API
- Intelligent routing: NOAA (US, more detailed) vs Open-Meteo (global)
- Unified response format
- Cache with appropriate TTL (2 hours)

#### 3. Add Sunrise/Sunset to Forecasts (NO new tool)
**Enhance daily forecast output:**
- ✅ Sunrise/sunset times from Open-Meteo
- ✅ Daylight duration
- **Token cost:** 0 (just better output formatting)
- **User queries improved:**
  - "When's sunrise tomorrow?" → shown in forecast
  - "How long is daylight?" → included automatically

**Summary for v0.4.0:** ✅ COMPLETE
- **Tools added:** 1 (search_location) ✅
- **Tools enhanced:** 1 (get_forecast) ✅
- **Token cost:** ~200 tokens ✅
- **Effort:** ~1.5 weeks as estimated ✅
- **Value:** Global forecasts + natural location queries + extended forecasts ✅
- **Testing:** All 247 tests passing (100% backward compatible) ✅

**Cumulative Total:**
- **Tools:** 6 (was 5, added 1)
- **Token overhead:** ~700 tokens
- **Geographic coverage:** Global forecasts + US current conditions + Global historical

---

### v0.5.0 - Health & Environment

**Theme:** Air quality and health-related weather data

#### 1. Add `get_air_quality` Tool ⭐ NEW TOOL
**Health-relevant environmental data:**
```typescript
get_air_quality({
  latitude: number,
  longitude: number,
  forecast?: boolean    // default: false (current), true for forecast
})
```

**What this adds:**
- ✅ Air quality index (AQI)
- ✅ Pollutant levels (PM2.5, PM10, O3, NO2, SO2, CO)
- ✅ UV index
- ✅ Health recommendations based on AQI
- ✅ Air quality forecasts
- **Token cost:** +200 tokens (new tool)
- **New tools added:** 1
- **User queries enabled:**
  - "What's the air quality in Beijing?"
  - "Is it safe to exercise outside?"
  - "What's the UV index today?"

**Why a separate tool:**
- Distinct health/environmental focus
- Different data source (Open-Meteo Air Quality API)
- Called independently from weather queries
- Important for sensitive populations

**Implementation:**
- Use Open-Meteo Air Quality API
- Map AQI to health categories (Good/Moderate/Unhealthy/etc.)
- Cache for 1 hour (updates hourly)
- Include health guidance in output

#### 2. Enhance `get_current_conditions` with Fire Weather (NO new tool)
**Add optional parameter for specialized data:**
```typescript
get_current_conditions({
  latitude: number,
  longitude: number,
  include_fire_weather?: boolean  // NEW: show fire danger indices (US only)
})
```

**What this adds:**
- ✅ Fire danger indices (when requested)
- ✅ Grassland fire danger index
- ✅ Haines index (atmospheric stability)
- ✅ Red flag warnings (via alerts integration)
- **Token cost:** +50 tokens (update description)
- **New tools added:** 0
- **User queries enabled:**
  - "What's the fire danger level?" (with parameter)
  - "Is there fire weather risk?"

**Implementation:**
- Access NOAA gridpoint data (61 variables available)
- Only fetch when parameter is true
- Show prominence when danger is elevated

**Summary for v0.5.0:**
- **Tools added:** 1 (get_air_quality)
- **Tools enhanced:** 1 (get_current_conditions)
- **Token cost:** ~250 tokens
- **Effort:** ~1.5 weeks
- **Value:** Health data + fire weather awareness

**Cumulative Total:**
- **Tools:** 7 (was 4, added 3)
- **Token overhead:** ~750 tokens

---

### v0.6.0 - Specialized Weather ✅ COMPLETE

**Status:** Implemented and tested on 2025-11-06

**Theme:** Marine and severe weather for specialized use cases

**Goal:** Add marine conditions monitoring and severe weather probabilities

**Achievement:** All features implemented successfully with 12/12 tests passing

#### 1. Add `get_marine_conditions` Tool ⭐ NEW TOOL
**Coastal and ocean weather:**
```typescript
get_marine_conditions({
  latitude: number,
  longitude: number,
  forecast?: boolean    // default: false (current), true for forecast
})
```

**What this adds:**
- ✅ Significant wave height, period, and direction
- ✅ Wind waves and swell separation
- ✅ Ocean current velocity and direction
- ✅ Safety assessment (Calm to Extreme categories)
- ✅ Optional 5-day marine forecast
- **Token cost:** +200 tokens (new tool) ✅
- **New tools added:** 1 ✅
- **User queries enabled:**
  - "Are ocean conditions safe for boating?" ✅
  - "What's the wave height off California?" ✅
  - "Show me surf conditions" ✅

**Implementation:** ✅ COMPLETE
- ✅ Open-Meteo Marine API integration
- ✅ 1-hour cache with proper TTL
- ✅ Formatted for sailors/surfers/boaters with safety guidance
- ✅ Wave categorization based on Douglas Sea Scale
- ✅ Comprehensive test coverage (7 tests)

#### 2. Enhance `get_forecast` with Severe Weather (NO new tool)
**Add severe weather probabilities from NOAA:**
```typescript
get_forecast({
  // ... existing parameters
  include_severe_weather?: boolean  // NEW: thunderstorm/wind probabilities
})
```

**What this adds:**
- ✅ Thunderstorm probability (next 48 hours)
- ✅ Wind gust probabilities (20-60+ mph categories)
- ✅ Tropical storm and hurricane wind probabilities
- ✅ Lightning activity levels (1-5 scale)
- **Token cost:** +50 tokens ✅
- **New tools added:** 0 ✅

**Implementation:** ✅ COMPLETE
- ✅ NOAA gridpoint data extraction
- ✅ New type definitions: `GridpointSevereWeather`
- ✅ Smart probability display (filters low-risk data)
- ✅ Time-windowed analysis (48-hour outlook)
- ✅ Comprehensive test coverage (5 tests)

**Summary for v0.6.0:** ✅ COMPLETE
- **Tools added:** 1 (get_marine_conditions) ✅
- **Tools enhanced:** 1 (get_forecast) ✅
- **Token cost:** ~250 tokens ✅
- **Effort:** 1 day as estimated ✅
- **Value:** Marine weather + severe weather probabilities ✅
- **Testing:** All 12 tests passing (100% successful) ✅

**Cumulative Total:**
- **Tools:** 8 (was 7, added 1)
- **Token overhead:** ~1,000 tokens
- **Geographic coverage:** Full marine + severe weather for specialized needs

---

## Tool Inventory (Current: v1.6.0)

### Available Tools (Configurable)
1. **`get_forecast`** - Future weather (enhanced: hourly, global, 16-day, severe weather) ✅
2. **`get_current_conditions`** - Current weather (enhanced: heat index, fire weather, normals) ✅
3. **`get_historical_weather`** - Past weather (unchanged) ✅
4. **`get_alerts`** - Safety warnings ⭐ NEW ✅
5. **`search_location`** - Geocoding ⭐ NEW ✅
6. **`get_air_quality`** - Health data ⭐ NEW ✅
7. **`check_service_status`** - API health (enhanced: version info) ✅
8. **`get_marine_conditions`** - Ocean/coastal weather (enhanced: Great Lakes support) ⭐ NEW ✅
9. **`get_weather_imagery`** - Precipitation radar visualization ⭐ NEW ✅
10. **`get_lightning_activity`** - Real-time lightning strike monitoring ⭐ NEW ✅
11. **`get_river_conditions`** - River levels and flood monitoring ⭐ NEW ✅
12. **`get_wildfire_info`** - Active wildfire tracking and safety ⭐ NEW ✅

**Total: 12 tools** (up from 4 in v0.1.0)
**Default enabled: 5 tools** (basic preset for minimal overhead)
**Token cost: ~1,800 tokens with all tools** (0.9% of 200k context)
**Token cost: ~600 tokens with basic preset** (0.3% of 200k context)
**Functionality increase: ~600%** (from v0.1.0)

---

## Implementation Principles

### 1. Parameters Over Proliferation
❌ **BAD:** Create separate tools for variations
```typescript
get_daily_forecast()
get_hourly_forecast()
get_fire_forecast()
get_extended_forecast()
// Result: 4+ tools with overlapping purpose
```

✅ **GOOD:** One tool with parameters
```typescript
get_forecast({
  granularity?: "daily" | "hourly",
  include_fire_weather?: boolean,
  days?: 1-16
})
// Result: 1 tool, 4x functionality
```

### 2. Enhance Before Creating
**Before adding a new tool, ask:**
1. Can this be a parameter on an existing tool?
2. Can this be automatic output formatting?
3. Does this have a truly distinct purpose?
4. Would users call this separately from other weather queries?

**Only create a new tool if:**
- ✅ Fundamentally different operation (search vs weather data)
- ✅ Different data source requiring separate API calls
- ✅ Called in isolation (not always with other tools)
- ✅ Distinct semantic purpose (safety alerts vs weather forecast)

### 3. Intelligent Defaults
**Don't make users specify everything:**
- Auto-show heat index when >80°F
- Auto-show wind chill when <40°F
- Auto-select NOAA (US) vs Open-Meteo (international)
- Auto-choose hourly (<3 days) vs daily (>3 days) for historical data

### 4. Clear Descriptions with Semantic Triggers
**Each tool description should:**
- State ONE clear purpose
- List common user queries that trigger it
- Indicate when NOT to use it
- Be concise (aim for <150 words)

**Example:**
```typescript
name: "get_alerts",
description: "Get active weather alerts (watches, warnings, advisories).
Use when asked about: 'any alerts?', 'weather warnings?', 'is it safe?',
'dangerous weather?'. Returns severity, urgency, and affected areas.
For forecast data, use get_forecast instead."
```

---

## Token Efficiency Comparison

### Original Roadmap (Rejected)
- 15+ separate tools
- ~3,500 tokens for tool definitions
- High cognitive load on AI
- Overlapping functionality
- **Bloated and confusing**

### Revised Roadmap (This Document)
- 7-8 tools total
- ~1,000-1,500 tokens for tool definitions
- Clear semantic boundaries
- Parameter-based functionality
- **Lean and efficient**

**Savings: 60% fewer tokens, 4x functionality increase per tool**

---

## User Query Pattern Coverage

### Safety & Alerts ✅
- "Are there any weather warnings in my area?" → `get_alerts`
- "Is there a tornado watch?" → `get_alerts`
- "Is it safe to be outside?" → `get_alerts` + `get_air_quality`

### Natural Location Queries ✅
- "What's the weather in Paris?" → `search_location` + `get_forecast`
- "Forecast for Tokyo" → `search_location` + `get_forecast`

### Detailed Planning ✅
- "Hourly temperatures for tomorrow" → `get_forecast(granularity="hourly")`
- "When will rain start?" → `get_forecast(granularity="hourly", include_precipitation_probability=true)`

### Health & Safety ✅
- "What's the air quality?" → `get_air_quality`
- "Is it too hot to exercise?" → `get_current_conditions` (shows heat index)
- "What's the UV index?" → `get_air_quality`

### Specialized Weather ✅
- "Fire danger level?" → `get_current_conditions(include_fire_weather=true)`
- "Ocean conditions safe?" → `get_marine_conditions` (optional)
- "Chance of thunderstorms?" → `get_forecast(include_severe_weather=true)`

### Global Coverage ✅
- "Forecast for London?" → `get_forecast` (auto-routes to Open-Meteo)
- "10-day forecast for Sydney?" → `get_forecast(days=10)`

---

## Development Priorities

### Phase 1: v0.3.0 (Priority: Critical)
**Focus:** Safety and enhanced core functionality
- Add `get_alerts` tool
- Enhance `get_forecast` (hourly, precipitation probability)
- Enhance `get_current_conditions` (heat index, 24hr max/min)
- **Effort:** ~1 week
- **Value:** Safety-critical + better forecasts

### Phase 2: v0.4.0 (Priority: High)
**Focus:** Global expansion and UX transformation
- Add `search_location` tool (geocoding)
- Enhance `get_forecast` (global support, 16-day)
- Add sunrise/sunset to output
- **Effort:** ~1.5 weeks
- **Value:** Removes US limitation, natural conversations

### Phase 3: v0.5.0 (Priority: Medium)
**Focus:** Health and environment
- Add `get_air_quality` tool
- Enhance `get_current_conditions` (fire weather)
- **Effort:** ~1.5 weeks
- **Value:** Health-relevant data

### Phase 4: v0.6.0 (Priority: Low)
**Focus:** Specialized use cases
- Optionally add `get_marine_conditions` tool
- Enhance `get_forecast` (severe weather probabilities)
- **Effort:** ~1-2 weeks
- **Value:** Specialized but useful

---

## Testing Strategy

### For Each Enhancement

**1. Token Count Verification**
- Measure actual token count of tool definitions
- Ensure we stay under budget (~1,500 tokens total)
- Test with Claude Code to verify no confusion

**2. Backward Compatibility**
- New parameters must be optional
- Default behavior unchanged
- Existing queries still work

**3. AI Selection Accuracy**
- Test common user queries
- Verify AI picks correct tool
- Check for tool confusion or multiple attempts

**4. Functionality Testing**
- Unit tests for new parameters
- Integration tests with real APIs
- Cache behavior verification

---

## Success Metrics

### Token Efficiency
- ✅ Stay under 1,500 tokens for all tool definitions
- ✅ Less than 0.75% of 200k context budget
- ✅ Average <200 tokens per tool description

### Tool Count
- ✅ Maximum 8 tools by v1.0.0
- ✅ 2x tool count, 4x functionality
- ✅ Each tool has clear, distinct purpose

### User Experience
- ✅ Natural language queries work without coordinates
- ✅ Global coverage for forecasts and historical data
- ✅ Safety alerts available and prominent
- ✅ Health data accessible

### AI Performance
- ✅ AI consistently selects correct tool
- ✅ <10% retry rate due to wrong tool selection
- ✅ Clear descriptions prevent confusion

---

## Future Considerations (Post v1.0.0)

### Features NOT in Roadmap (Intentionally)
These are valuable but would add too many tools or tokens:

❌ **Climate trends analysis** - Specialized, low frequency
❌ **Flood monitoring** - Niche use case
❌ **Agricultural/soil data** - Specialized audience
❌ **Solar radiation** - Very specialized
❌ **Alert subscriptions** - Requires persistent state
❌ **Multi-model comparison** - Advanced feature

**Why excluded:**
- Would require additional tools (token bloat)
- Specialized audiences (low benefit/cost ratio)
- Can be added later based on user demand
- Focus on 80/20 rule: 80% of value, 20% of tools

### Possible v2.0.0 Direction
If there's demand and we need to add more:
- Consider breaking into multiple MCP servers by domain
  - `weather-mcp` - Core weather (current focus)
  - `weather-climate-mcp` - Climate analysis
  - `weather-agriculture-mcp` - Agricultural data
- This keeps each server lean and focused

---

## v1.1.0 - Great Lakes & Coastal Marine Enhancement ✅ COMPLETE

**Status:** Implemented and tested on 2025-11-07

**Theme:** Replace limited Open-Meteo marine data with NOAA's superior Great Lakes and coastal forecasts

**Goal:** Provide accurate marine forecasts for Great Lakes regions (currently limited/unavailable)

**Priority:** Medium-High (high value for Great Lakes users)

### Background

**Current Limitation:**
- `get_marine_conditions` currently uses Open-Meteo exclusively (global ocean coverage)
- Open-Meteo has **limited/no data** for Great Lakes and smaller bays
- Example: Traverse City, MI (Grand Traverse Bay) returns "N/A" for all marine data
- Great Lakes boaters/sailors lack marine forecast access through the MCP

**NOAA Coverage:**
NOAA provides excellent zone-based marine forecasts for:
- ✅ All 5 Great Lakes (Superior, Michigan, Huron, Erie, Ontario)
- ✅ Major US coastal bays (Chesapeake, San Francisco Bay, Tampa Bay, etc.)
- ✅ Lake Okeechobee and select large inland navigable lakes
- ❌ NOT available: Most smaller inland lakes, reservoirs, private lakes

**Available Data:**
- Wave height and period forecasts
- Wind speed/direction (zone-specific)
- Weather conditions
- Hazardous marine weather warnings
- Multi-day marine forecasts
- Available April-December (boating season) for Great Lakes

### 1. Enhance `get_marine_conditions` for Dual-Source Support (NO new tool)

**Add intelligent source selection based on location:**

```typescript
get_marine_conditions({
  latitude: number,
  longitude: number,
  forecast?: boolean,
  // NO new parameters needed - auto-detect source
})
```

**What this adds:**
- ✅ **Great Lakes regions:** Use NOAA gridpoint marine data (wave height, period, wind)
- ✅ **Major US coastal bays:** Use NOAA gridpoint marine data
- ✅ **Ocean/International:** Fall back to Open-Meteo (current behavior)
- ✅ **Automatic detection:** No user parameter needed, smart routing by coordinates
- ✅ Coverage for Traverse City, MI and other Great Lakes locations
- **Token cost:** ~0 tokens (same tool description, better data source)
- **New tools added:** 0
- **User experience improved:**
  - "Marine forecast for Traverse City" → Now works! (currently N/A)
  - "Wave conditions on Lake Michigan" → NOAA data with zone forecasts
  - "Safe to boat on Grand Traverse Bay?" → Real Great Lakes data

### 2. Extend NOAA Type Definitions

**Add marine properties to GridpointProperties:**

```typescript
// New marine fields in src/types/noaa.ts
export interface GridpointProperties extends GridpointFireWeather, GridpointSevereWeather {
  // ... existing fields ...

  // NEW marine forecast fields
  waveHeight?: GridpointDataSeries;           // Significant wave height
  wavePeriod?: GridpointDataSeries;           // Wave period (seconds)
  primarySwellHeight?: GridpointDataSeries;   // Primary swell height
  primarySwellDirection?: GridpointDataSeries; // Primary swell direction
  windWaveHeight?: GridpointDataSeries;       // Wind-generated wave height
}
```

### 3. Implementation Details

**Detection Logic:**
1. Check if coordinates are within Great Lakes region (lat/lon bounds)
2. Check if within major US coastal bay zones
3. If yes → fetch NOAA gridpoint data, extract marine fields
4. If no → use existing Open-Meteo marine API (current behavior)

**Formatting:**
- Dual formatting functions (NOAA marine vs Open-Meteo marine)
- Unified output format regardless of source
- Indicate data source in output footer

**Caching:**
- NOAA marine gridpoint data: 2-hour TTL (same as forecast gridpoint)
- Open-Meteo marine data: 1-hour TTL (existing)

**Error Handling:**
- Graceful degradation if NOAA marine data unavailable
- Fall back to Open-Meteo if NOAA gridpoint lacks marine fields
- Clear messaging about data availability

### Example Output (Traverse City, MI)

**Before v1.1.0:**
```
# Marine Conditions Report

**Location:** 44.7631, -85.6206
**Current Conditions:** Unknown
Marine conditions data not available
```

**After v1.1.0:**
```
# Marine Conditions Report - Great Lakes

**Location:** Traverse City, MI (Grand Traverse Bay - Lake Michigan)
**Zone:** LMZ043 - Grand Traverse and Leelanau Counties

## Current Conditions
**Wind:** SW 10-15 kt
**Waves:** 2-4 ft (Slight)
**Weather:** Partly cloudy
**Visibility:** 5+ miles

## Tonight
**Wind:** S 15-20 kt becoming SW 10-15 kt after midnight
**Waves:** 3-5 ft (Moderate)
**Weather:** Chance of showers

## Friday
**Wind:** W 5-10 kt
**Waves:** 1-3 ft (Calm)
**Weather:** Sunny

---
*Data source: NOAA National Weather Service (Great Lakes Marine Forecast)*
```

### Geographic Coverage

**Will work for:**
- Lake Superior (all zones)
- Lake Michigan (all zones including Green Bay, Grand Traverse Bay)
- Lake Huron (all zones including Saginaw Bay)
- Lake Erie (all zones)
- Lake Ontario (all zones)
- Major coastal bays (Chesapeake, SF Bay, Tampa Bay, etc.)
- Lake Okeechobee (FL)

**Will NOT work for:**
- Most smaller inland lakes
- State park lakes and reservoirs
- Private lakes
- International portions of Great Lakes (use current Open-Meteo)

### Summary for v1.1.0 ✅ COMPLETE

- **Tools added:** 0 (enhancement only) ✅
- **Tools enhanced:** 1 (get_marine_conditions) ✅
- **Token cost:** ~0 tokens (no description change needed) ✅
- **Effort:** 1 day as estimated ✅
- **Value:** HIGH for Great Lakes region users (Michigan, Wisconsin, Minnesota, Ohio, Pennsylvania, New York, Ontario) ✅
- **Backward compatibility:** Maintained ✅ (existing Open-Meteo behavior for non-Great Lakes locations)

**Benefits:**
- ✅ Great Lakes boaters/sailors get accurate marine forecasts
- ✅ NOAA gridpoint data provides wave height, period, and wind conditions
- ✅ No new tools (maintains lean design philosophy)
- ✅ Zero token overhead (smart routing, no new parameters)
- ✅ Improves existing tool quality without proliferation

**Implementation Details:**
- ✅ Geographic detection with bounding boxes for all 5 Great Lakes
- ✅ Coastal bay detection for 5 major US bays
- ✅ Dual-source handler with NOAA-first logic and Open-Meteo fallback
- ✅ Enhanced NOAA types with `GridpointMarineForecast` interface
- ✅ Comprehensive test coverage: 15 integration tests + 26 unit tests
- ✅ All tests passing

**Cumulative Total (after v1.1.0):**
- **Tools:** 8 (unchanged)
- **Token overhead:** ~1,000 tokens (unchanged)
- **Geographic coverage:** Oceans + Great Lakes + Major US coastal bays

---

## Release & Development Strategy

### Git Branching Model

**Branch Structure:**
```
main (stable releases only)
├── develop (integration branch)
    ├── feature/v0.X.0-feature-name
    ├── feature/v0.X.0-another-feature
```

### Workflow for Each Version

**Example: Implementing v0.3.0**

1. **Preparation**
   - Merge completed feature branch to `main` → tag current release
   - Create/update `develop` branch from `main`

2. **Feature Development**
   - Create feature branches for each enhancement:
     - `feature/v0.3.0-alerts` (new get_alerts tool)
     - `feature/v0.3.0-hourly-forecast` (enhance get_forecast)
     - `feature/v0.3.0-enhanced-conditions` (enhance get_current_conditions)
   - Branch from `develop` for each feature
   - Develop and test each feature independently

3. **Integration**
   - Merge each completed feature to `develop`
   - Test integrated version on `develop`
   - Fix any integration issues

4. **Release**
   - When ALL version features complete → merge `develop` to `main`
   - Tag as version release (e.g., `v0.3.0`)
   - Publish to npm

### Release Strategy

**Version-Based Releases (Recommended)**

Release complete versions (v0.3.0, v0.4.0, etc.) rather than individual features.

**Why:**
- ✅ Roadmap already organized by cohesive version themes
- ✅ Features within versions are related and tested together
- ✅ Clearer communication to users ("v0.3.0 adds safety & hourly forecasts")
- ✅ Reduced release overhead and changelog management
- ✅ Better integration testing before release

**Timeline:**
- v0.3.0: ~1 week → Release when complete
- v0.4.0: ~1.5 weeks → Release when complete
- v0.5.0: ~1.5 weeks → Release when complete

**Semantic Versioning:**
- **v0.X.0** - Major version milestone (all planned features complete)
- **v0.X.Y** - Patch releases (bug fixes, minor improvements)
- **v1.0.0** - Production-ready with all core features (versions 0.3-0.6 complete)

### Alternative: Individual Feature Releases

If faster user feedback is needed:

**Hybrid Approach:**
- Release major new tools individually (e.g., v0.2.1, v0.2.2)
- Bundle smaller enhancements together
- Use `develop` branch with npm `next` tag for preview releases

**Versioning:**
- **v0.X.0** - Version milestone complete
- **v0.X.Y** - Individual feature releases within a version

### Development Workflow

1. **Start New Version Development**
   ```bash
   git checkout main
   git pull origin main
   git checkout -b develop  # or git checkout develop && git merge main
   ```

2. **Create Feature Branch**
   ```bash
   git checkout develop
   git checkout -b feature/v0.3.0-alerts
   # ... develop feature ...
   git commit -m "Add get_alerts tool for weather warnings"
   ```

3. **Merge to Develop**
   ```bash
   git checkout develop
   git merge feature/v0.3.0-alerts
   git push origin develop
   ```

4. **Release Version**
   ```bash
   git checkout main
   git merge develop
   git tag -a v0.3.0 -m "Release v0.3.0: Enhanced Core Tools"
   git push origin main --tags
   npm publish
   ```

### Preview Releases

For testing integrated features before official release:

```bash
# On develop branch
npm version prerelease --preid=beta  # v0.3.0-beta.0
npm publish --tag next

# Users can test with:
# npx @modelcontextprotocol/create-server weather-mcp@next
```

---

## Contributing

When implementing features from this roadmap:

### Must Do
1. ✅ Verify token count doesn't exceed budget
2. ✅ Add parameters to existing tools before creating new ones
3. ✅ Write clear, concise tool descriptions (<150 words)
4. ✅ Test AI tool selection with common queries
5. ✅ Maintain backward compatibility

### Should Do
1. ✅ Include semantic trigger phrases in descriptions
2. ✅ Use intelligent defaults to minimize parameters
3. ✅ Cache appropriately for new data types
4. ✅ Format output clearly and consistently

### Must Not Do
1. ❌ Add tools without checking if parameter can work
2. ❌ Create overlapping tools with similar purposes
3. ❌ Write verbose tool descriptions (token waste)
4. ❌ Break backward compatibility for existing tools

---

## Appendix: Token Budget Breakdown

### Current State (v0.1.2)
| Tool | Approximate Tokens |
|------|-------------------|
| get_forecast | ~200 |
| get_current_conditions | ~150 |
| get_historical_weather | ~250 |
| check_service_status | ~100 |
| **Total** | **~700** |

### Current State (v1.6.0)
| Tool | Approximate Tokens | Change from v0.1.2 |
|------|-------------------|--------|
| get_forecast | ~300 | +100 (hourly, global, 16-day, severe weather) |
| get_current_conditions | ~200 | +50 (heat index, fire weather, normals) |
| get_historical_weather | ~250 | 0 (unchanged) |
| get_alerts | ~200 | +200 (NEW) |
| search_location | ~150 | +150 (NEW) |
| get_air_quality | ~200 | +200 (NEW) |
| check_service_status | ~100 | 0 (version info added) |
| get_marine_conditions | ~200 | +200 (NEW) |
| get_weather_imagery | ~200 | +200 (NEW) |
| get_lightning_activity | ~200 | +200 (NEW) |
| get_river_conditions | ~200 | +200 (NEW) |
| get_wildfire_info | ~200 | +200 (NEW) |
| **Total (all tools)** | **~1,800** | **+1,100** |
| **Total (basic preset)** | **~600** | **-100** |

**Overhead with all tools: ~1,800 tokens (0.9% of 200k context)**
**Overhead with basic preset: ~600 tokens (0.3% of 200k context)**

---

*Last Updated: 2025-11-09*
*Current Version: v1.6.0 (Safety & Hazards)* ✅
*Previous: v1.5.0 (Visualization & Lightning Safety)* ✅
*Next Target: TBD - See future considerations section*
*Design Philosophy: Lean, efficient, user-focused*

---

## v1.4.0 - Tool Configuration System ✅ COMPLETE

**Status:** Implemented and tested on 2025-11-08

**Theme:** Configurable tool loading to reduce context overhead and enable customization

**Goal:** Allow users to control which MCP tools are exposed based on their needs

**Achievement:** Full tool configuration system with presets and flexible syntax

### Background

**Context Overhead Concern:**
- As the Weather MCP Server expanded to 8 tools, the initial MCP context load increased
- Not all users need all tools (e.g., many don't need marine conditions or historical data)
- Users wanted ability to reduce context size for faster initialization
- Security-conscious users wanted to limit exposed functionality

**User Customization Need:**
- Different users have different weather data requirements
- Power users want everything; typical users want core forecasts only
- Some users focus on air quality, others never use it
- One-size-fits-all approach wasn't optimal

### 1. Tool Configuration System (NO new tools)

**Add environment variable for tool selection:**

```bash
# Use presets
ENABLED_TOOLS=basic           # 5 core tools (default)
ENABLED_TOOLS=standard        # Basic + historical
ENABLED_TOOLS=full            # Standard + air quality
ENABLED_TOOLS=all             # All 8 tools

# Select specific tools
ENABLED_TOOLS=forecast,current,alerts

# Add to presets
ENABLED_TOOLS=basic,+historical,+air_quality

# Remove from presets
ENABLED_TOOLS=all,-marine

# Complex combinations
ENABLED_TOOLS=standard,+air_quality,-alerts
```

**What this adds:**
- ✅ 4 convenient presets for common configurations
- ✅ Flexible syntax supporting presets, additions, removals, and combinations
- ✅ Tool aliases for shorter configuration (e.g., `forecast` instead of `get_forecast`)
- ✅ Default to `basic` preset (5 of 8 tools) for minimal overhead
- ✅ Runtime validation prevents calling disabled tools
- ✅ Startup logging shows which tools are enabled
- **Token cost:** ~0 tokens (tools filtered at registration, not in definitions)
- **New tools added:** 0
- **User control enabled:**
  - Reduce context for faster loading
  - Customize exposed functionality
  - Security: only enable needed tools
  - Fine-grained control over server capabilities

**Implementation:**
- New config module: `src/config/tools.ts`
  - `ToolConfig` singleton class
  - `parseEnabledTools()` with complex syntax parsing
  - Tool alias resolution
  - Preset management (basic, standard, full, all)
- Updated `src/index.ts`:
  - Tool definitions in `TOOL_DEFINITIONS` constant
  - `ListToolsRequestSchema` filters by enabled tools
  - `CallToolRequestSchema` validates tool is enabled
  - Enhanced startup logging
- Environment variable: `ENABLED_TOOLS` (optional)

**Effort:** 1 day
**Value:** HIGH - Addresses context overhead and enables customization

### 2. Comprehensive Documentation

**Updated documentation across all files:**
- ✅ README.md: New "Tool Selection" configuration section
- ✅ .env.example: Comprehensive configuration examples with all presets and syntax
- ✅ Tool aliases documented
- ✅ Benefits and use cases explained

**Summary for v1.4.0:** ✅ COMPLETE
- **Tools added:** 0 (configuration enhancement only) ✅
- **Tools enhanced:** All 8 tools now configurable ✅
- **Token cost:** ~0 tokens (filtering at registration) ✅
- **Effort:** 1 day as estimated ✅
- **Value:** HIGH for users wanting minimal overhead or customization ✅
- **Testing:** All 749 tests passing including 27 new config tests ✅

**Benefits:**
- ✅ Reduced context overhead for typical users (5 tools vs 8)
- ✅ Better security posture (only expose what's needed)
- ✅ User customization and control
- ✅ Zero breaking changes (backwards compatible)
- ✅ Maintains lean design philosophy

**Implementation Details:**
- ✅ Tool configuration singleton with preset management
- ✅ Complex syntax parser supporting presets, additions, removals
- ✅ 11 tool aliases for convenient configuration
- ✅ Runtime validation with clear error messages
- ✅ Comprehensive test coverage: 27 unit tests
- ✅ All 749 tests passing

**Cumulative Total (after v1.4.0):**
- **Tools:** 8 (unchanged, but now configurable)
- **Default exposed:** 5 tools (basic preset)
- **Token overhead:** Reduced for typical users (~500-600 tokens vs ~1,000 for all tools)
- **Customization:** Full user control over enabled tools

---

## v1.2.0 - Context & Intelligence ✅ COMPLETE

**Status:** Implemented and released on 2025-11-07

**Theme:** Add critical context and enhance output intelligence

**Goal:** Provide climate context, improve winter weather data, and enhance time display

**Achievement:** All three features implemented successfully with comprehensive testing

### 1. Enhance with Climate Normals (NO new tool)
**Add 30-year average context to forecasts and current conditions:**
```typescript
get_forecast({
  // ... existing parameters
  include_normals?: boolean  // NEW: show comparison to 30-year averages
})

get_current_conditions({
  // ... existing parameters
  include_normals?: boolean  // NEW: show comparison to normal temps
})
```

**What this adds:**
- ✅ 30-year climate averages (1991-2020 normals)
- ✅ Deviation from normal ("+5°F above average")
- ✅ Context for "unusual" vs "normal" conditions
- ✅ Helps AI understand weather significance
- **Token cost:** ~100 tokens (parameter enhancement)
- **New tools added:** 0
- **User queries enabled:**
  - "Is this warmer than normal for April?"
  - "How does this compare to average?"
  - "Is this unusual weather?"

**Implementation:**
- NOAA Climate Normals API for US locations
- Compute from Open-Meteo historical data for international
- Cache normals data indefinitely (doesn't change)
- Show prominently when deviation is >10°F from normal

**Effort:** 1-2 weeks
**Value:** HIGH - Adds critical context to all weather data

### 2. Extract Snow Depth & Snowfall Details (NO new tool)
**Enhance winter weather output from existing NOAA data:**

**What this adds:**
- ✅ Current snow depth on ground (from observation stations)
- ✅ Forecasted snowfall amounts (from gridpoint forecasts)
- ✅ Snow water equivalent when available
- ✅ Display only when relevant (>0 inches)
- **Token cost:** ~0 tokens (output enhancement, no description change)
- **New tools added:** 0
- **User queries improved:**
  - "How much snow is on the ground?" → See snow depth
  - "How much snow will we get?" → See snowfall forecast
  - Winter travel assessment (road conditions)

**Implementation:**
- Extract from existing NOAA observation responses (already in data)
- Extract from NOAA gridpoint forecasts (already in data)
- Seasonal display (only show during winter months or when >0)
- No new API calls required

**Effort:** 2-3 days
**Value:** HIGH for winter regions, zero-cost extraction

### 3. Timezone-Aware Time Display (NO new tool)
**Show all forecast times in local timezone automatically:**

**What this adds:**
- ✅ Sunrise/sunset in local time (not UTC)
- ✅ Forecast periods in local time
- ✅ Alert effective/expiration times in local time
- ✅ Handle DST transitions correctly
- **Token cost:** ~0 tokens (output enhancement)
- **New tools added:** 0
- **User queries improved:**
  - "When is sunrise in Tokyo?" → Shows 6:30 AM JST (not UTC)
  - International forecasts are clearer
  - Reduces timezone confusion

**Implementation:**
- Use timezone data from search_location results
- Compute timezone from coordinates using library
- Format all timestamps with local timezone
- Handle DST edge cases

**Effort:** 3-5 days
**Value:** MEDIUM-HIGH - Significantly improves international UX

**Summary for v1.2.0:** ✅ COMPLETE
- **Tools added:** 0 (enhancements only) ✅
- **Tools enhanced:** 3 (get_forecast, get_current_conditions, output formatting) ✅
- **Token cost:** ~100 tokens ✅
- **Effort:** 2-3 weeks as estimated ✅
- **Value:** Climate context + winter weather + better time display ✅
- **Testing:** Comprehensive test coverage including 29 new tests ✅

**Cumulative Total (after v1.2.0):**
- **Tools:** 8 (unchanged)
- **Token overhead:** ~1,100 tokens
- **Features:** Climate normals, snow data, timezone-aware display

---

## v1.3.0 - Version Management & User Updates ✅ COMPLETE

**Status:** Implemented and released on 2025-11-07

**Theme:** Keep users on latest version with automatic updates and version visibility

**Goal:** Reduce version drift, improve upgrade experience, and increase feature adoption

**Achievement:** Version management features implemented to help users stay current

### 1. Enhanced `check_service_status` Tool (NO new tool)
**Add version information to status check:**

**What this adds:**
- ✅ Display installed version number
- ✅ Link to latest release on GitHub
- ✅ Link to CHANGELOG and upgrade instructions
- ✅ Recommend `@latest` tag for automatic updates
- ✅ Help users discover when running outdated versions
- **Token cost:** ~0 tokens (output enhancement)
- **New tools added:** 0

### 2. Startup Version Logging (NO new tool)
**Enhanced server startup with version info:**

**What this adds:**
- ✅ Log installed version on server startup
- ✅ Include links to latest release and upgrade instructions
- ✅ Provide tip for automatic updates via `npx @latest`
- ✅ Visible in MCP client logs for version awareness
- **Token cost:** ~0 tokens (logging enhancement)
- **New tools added:** 0

### 3. Updated Installation Instructions
**Recommend `@latest` tag in all documentation:**

**What this adds:**
- ✅ All npx examples updated to use `@dangahagan/weather-mcp@latest`
- ✅ Ensures new users automatically get latest version on each run
- ✅ Reduces version drift across user base
- ✅ Addresses issue where users may be on older versions
- **Documentation impact:** README.md, upgrade instructions

**Summary for v1.3.0:** ✅ COMPLETE
- **Tools added:** 0 (enhancements only) ✅
- **Tools enhanced:** 1 (check_service_status) ✅
- **Token cost:** ~0 tokens ✅
- **Effort:** 1 day as estimated ✅
- **Value:** Better user experience, reduced version drift ✅
- **Benefits:** Automatic updates for users with `@latest` configuration ✅

**Cumulative Total (after v1.3.0):**
- **Tools:** 8 (unchanged)
- **Token overhead:** ~1,100 tokens
- **Features:** Version visibility, automatic update recommendations

---

## v1.5.0 - Visualization & Lightning Safety ✅ COMPLETE

**Status:** Implemented and tested on 2025-11-09

**Theme:** Weather imagery visualization and real-time lightning monitoring

**Goal:** Add visual weather data (radar/satellite) and lightning strike detection

**Achievement:** Both tools implemented successfully with comprehensive testing

### 1. Add `get_weather_imagery` Tool ⭐ NEW TOOL
**Access radar, satellite, and weather maps:**
```typescript
get_weather_imagery({
  latitude: number,
  longitude: number,
  type: 'radar' | 'satellite' | 'precipitation',  // imagery type
  animated?: boolean,     // static vs animated (default: false)
  layers?: string[]       // optional layers: 'radar', 'clouds', 'snow', etc.
})
```

**What this adds:**
- ✅ Precipitation radar from RainViewer API (free, global coverage)
- ✅ Animated radar loops (up to 2 hours of history)
- ✅ Static radar images (current conditions)
- ✅ Image URLs + metadata (timestamp, coverage area, resolution)
- ⏸️ NOAA satellite imagery (deferred to future release)
- ⏸️ NOAA radar (deferred, using RainViewer instead)
- **Token cost:** ~200 tokens (new tool) ✅
- **New tools added:** 1 ✅
- **User queries enabled:**
  - "Show me the current radar" ✅
  - "Is there precipitation nearby on radar?" ✅
  - "Show animated radar for the last hour" ✅

**Why a separate tool:**
- Fundamentally different data type (imagery URLs vs text data)
- Different use case (visual analysis vs numerical data)
- Different caching strategy (images can be cached longer)
- Complements forecast and alerts with visual confirmation

**Implementation:** ✅ COMPLETE
- ✅ RainViewer API integration for global precipitation radar
- ✅ Returns tile URLs for radar imagery (not raw image data)
- ✅ Support for both static and animated radar
- ✅ Automatic tile coordinate calculation from lat/lon
- ✅ Frame metadata with timestamps
- ✅ 15-minute cache for radar data
- ✅ Graceful handling when imagery unavailable
- ✅ Comprehensive test coverage (7 tests)

**Effort:** 1 day (actual)
**Value:** HIGH - Visual confirmation of precipitation conditions

### 2. Add `get_lightning_activity` Tool ⭐ NEW TOOL
**Monitor real-time lightning strikes:**
```typescript
get_lightning_activity({
  latitude: number,
  longitude: number,
  radius?: number,        // search radius in km (default: 100)
  time_window?: number    // minutes of history (default: 60)
})
```

**What this adds:**
- ✅ Real-time lightning strike locations (last 60 minutes)
- ✅ Strike count and density
- ✅ Distance to nearest strike
- ✅ Strike polarity (cloud-to-ground vs intra-cloud)
- ✅ Strike intensity/current
- ✅ Thunderstorm tracking and movement
- ✅ Safety assessment (risk level based on proximity)
- **Token cost:** ~200 tokens (new tool)
- **New tools added:** 1
- **User queries enabled:**
  - "Are there lightning strikes nearby?"
  - "How close is the lightning?"
  - "Is it safe to be outside?" (lightning risk)
  - "Show recent lightning activity"

**Why a separate tool:**
- SAFETY-CRITICAL (lightning kills ~20 people/year in US)
- Real-time data (updates every few minutes)
- Different data source (lightning detection networks)
- Complements alerts and severe weather tools
- Growing importance with climate change (more frequent storms)

**Implementation Options:**

**Option 1: Free Data (Blitzortung.org)**
- Global lightning detection network (community-operated)
- Free API access: `https://data.blitzortung.org/`
- Real-time strike data with ~5-10 minute delay
- Good coverage in North America, Europe
- Limited coverage in some regions
- No API key required

**Option 2: Paid APIs (Premium Quality)**
- **WeatherBug Spark API**: Commercial lightning data, very accurate
- **Earth Networks**: Total Lightning Network (cloud-to-cloud + cloud-to-ground)
- Requires API key and subscription
- Better accuracy and coverage
- Enterprise-grade reliability

**Implementation:** ✅ COMPLETE
- ✅ Blitzortung.org API integration (free, no API key required)
- ✅ Real-time strike detection with distance calculation (Haversine formula)
- ✅ 4-level safety assessment (safe > 50km, elevated 16-50km, high 8-16km, extreme < 8km)
- ✅ Comprehensive statistics (strike density, rates, nearest distance)
- ✅ Cloud-to-ground and intra-cloud strike classification
- ✅ Safety recommendations based on proximity
- ✅ Graceful degradation when API unavailable (returns empty array)
- ✅ Geographic region detection for optimal API endpoints
- ✅ 5-minute cache for strike data
- ✅ Comprehensive test coverage (8 tests)

**Effort:** 1 day (actual)
**Value:** HIGH - Safety-critical, complements severe weather monitoring

### Alternative: Enhance Existing Tools Instead?

**Could lightning be added to `get_forecast` with `include_severe_weather`?**
- ❌ No - Forecast lightning activity levels (1-5 scale) already exists
- ❌ This tool provides REAL-TIME strike data, not forecasts
- ❌ Different data source (lightning detection networks vs NOAA gridpoint)
- ✅ New tool justified for real-time safety-critical data

**Could imagery be part of `get_current_conditions`?**
- ❌ No - Fundamentally different data type (URLs vs text)
- ❌ Different use case (visual analysis vs numerical readings)
- ✅ New tool justified for imagery access

**Summary for v1.5.0:** ✅ COMPLETE
- **Tools added:** 2 (get_weather_imagery, get_lightning_activity) ✅
- **Token cost:** ~400 tokens ✅
- **Effort:** 2 days (actual, using free APIs) ✅
- **Value:** Visual weather analysis + real-time lightning safety ✅
- **Testing:** All 15 integration tests passing ✅

**Cumulative Total (after v1.5.0):**
- **Tools:** 10 (was 8, added 2)
- **Default exposed:** 5 tools (basic preset, unchanged)
- **Token overhead:** ~1,400 tokens (with all tools enabled)
- **New capabilities:** Weather radar visualization + real-time lightning strike monitoring

**Implementation Details:**
- ✅ RainViewer service for global precipitation radar
- ✅ Blitzortung service for lightning detection with safety assessment
- ✅ Type definitions: `WeatherImageryResponse`, `LightningActivityResponse`
- ✅ Both tools added to 'all' preset only (minimal impact on typical users)
- ✅ Tool aliases: 'imagery', 'radar', 'satellite', 'lightning', 'strikes', 'thunderstorm'
- ✅ Comprehensive test coverage: 15 integration tests
- ✅ All 764 tests passing

**Configuration Impact:**
With v1.4.0 tool configuration system, users can control tool exposure:
- Typical user: Keep `ENABLED_TOOLS=basic` (5 tools, minimal overhead) - unchanged
- Power user: `ENABLED_TOOLS=all` (all 10 tools including imagery and lightning)
- Lightning safety focus: `ENABLED_TOOLS=basic,+lightning`
- Visual analysis: `ENABLED_TOOLS=standard,+imagery,+lightning`
- Weather enthusiast: `ENABLED_TOOLS=full,+imagery,+lightning`

---

## v1.6.0 - Safety & Hazards ✅ COMPLETE

**Status:** Implemented and tested on 2025-11-09

**Theme:** Expand safety-critical data with water/flood and wildfire monitoring

**Goal:** Fill major gaps in hazard monitoring for rivers and wildfires

**Achievement:** Both safety-critical tools implemented successfully with comprehensive testing

### 1. Add `get_river_conditions` Tool ⭐ NEW TOOL
**Monitor river levels and flood status:**
```typescript
get_river_conditions({
  latitude: number,
  longitude: number,
  radius?: number       // search radius in km (default: 50)
})
```

**What this adds:**
- ✅ Current river levels from nearest gauges
- ✅ Flood stage information (minor, moderate, major)
- ✅ Streamflow data (USGS)
- ✅ Historical context (percentile for date)
- ✅ Safety assessment for boating/recreation
- **Token cost:** ~200 tokens (new tool)
- **New tools added:** 1
- **User queries enabled:**
  - "Is the river flooding?"
  - "What's the current river level?"
  - "Safe to kayak on the river today?"
  - Flood warning context

**Why a separate tool:**
- SAFETY-CRITICAL (flooding is deadly)
- Different data source (NOAA NWPS, USGS Water Services)
- Different query context (water/river vs general weather)
- Complements weather alerts (flood warnings)

**Implementation:** ✅ COMPLETE
- ✅ NOAA NWPS (National Water Prediction Service) for gauge locations and flood data
- ✅ USGS Water Services for real-time streamflow
- ✅ Distance calculation with Haversine formula
- ✅ Find nearest gauge(s) within customizable radius
- ✅ Flood stage thresholds with color-coded warnings
- ✅ 1-hour cache (gauge data updates frequently)
- ✅ Comprehensive test coverage (7 tests)
- ✅ Graceful error handling for API unavailability

**Effort:** 2 weeks (actual: 1 day)
**Value:** HIGH - Safety-critical for flood-prone areas

### 2. Add `get_wildfire_info` Tool ⭐ NEW TOOL
**Monitor active wildfires and smoke:**
```typescript
get_wildfire_info({
  latitude: number,
  longitude: number,
  radius?: number       // search radius in km (default: 100)
})
```

**What this adds:**
- ✅ Active fire locations within radius
- ✅ Fire perimeters and containment status
- ✅ Distance to nearest fire
- ✅ Smoke forecast integration
- ✅ Air quality impact from fires
- ✅ Evacuation risk assessment
- **Token cost:** ~200 tokens (new tool)
- **New tools added:** 1
- **User queries enabled:**
  - "Are there wildfires near me?"
  - "How close is the fire?"
  - "Will smoke reach my area?"
  - Fire safety planning

**Why a separate tool:**
- SAFETY-CRITICAL (especially western US)
- Growing relevance due to climate change
- Different data source (NASA FIRMS, NIFC)
- Complements air quality tool (smoke is PM2.5)
- Distinct use case from general weather

**Implementation:**
- NASA FIRMS API for active fire detection
- NIFC for fire perimeters and incident info
- NOAA HRRR-Smoke for smoke forecasts
- Cache for 30 minutes (fires change rapidly)
- Integrate with get_air_quality for smoke attribution

**Effort:** 2 weeks (actual: 2 days)
**Value:** HIGH - Growing importance, complements air quality

**Implementation:** ✅ COMPLETE
- ✅ NIFC WFIGS ArcGIS REST API integration (no API key required)
- ✅ Bounding box queries for fire perimeters
- ✅ Distance-based filtering with Haversine formula
- ✅ 4-level safety assessment (extreme/high/caution/awareness)
- ✅ Fire vs prescribed burn classification
- ✅ 30-minute cache for fire data
- ✅ Comprehensive test coverage (10 tests)
- ✅ Real wildfire detected during testing ("La Plata" fire, CO)

**Summary for v1.6.0:** ✅ COMPLETE
- **Tools added:** 2 (get_river_conditions, get_wildfire_info) ✅
- **Token cost:** ~400 tokens ✅
- **Effort:** 2 days (much faster than estimated 4 weeks) ✅
- **Value:** Safety-critical hazard monitoring ✅
- **Testing:** All 17 integration tests created ✅
- **Documentation:** README, CHANGELOG, ROADMAP updated ✅

**Cumulative Total (after v1.6.0):**
- **Tools:** 12 (was 10, added 2) ✅
- **Default exposed:** 5 tools (basic preset, unchanged)
- **Token overhead:** ~1,800 tokens (with all tools), ~600 tokens (basic preset)
- **Safety features:** Comprehensive hazard monitoring (alerts, severe weather, lightning, river, wildfire) ✅

**Configuration Impact:**
With v1.4.0 tool configuration system:
- Safety-focused user: `ENABLED_TOOLS=basic,+lightning,+river,+wildfire`
- Outdoor recreation: `ENABLED_TOOLS=standard,+marine,+river,+air_quality`
- Western US focus: `ENABLED_TOOLS=full,+wildfire,+lightning` (fire season critical)

---

## ✅ v0.6.0 Status: COMPLETE

All planned features have been implemented and tested:

### Completed Features
- ✅ **get_marine_conditions tool** - NEW marine weather monitoring for coastal and ocean areas
  - Global coverage via Open-Meteo Marine API
  - Significant wave height, wind waves, and swell data
  - Ocean current velocity and direction
  - Safety assessment with color-coded conditions (Calm to Extreme)
  - Optional 5-day marine forecast with daily summaries
  - Wave categorization based on Douglas Sea Scale
  - 1-hour cache for marine data
  - 7 integration tests passing

- ✅ **Enhanced get_forecast** - Severe weather probabilities for US locations
  - NEW `include_severe_weather` parameter (boolean, default: false)
  - Thunderstorm probability for next 48 hours
  - Wind gust probabilities (20-60+ mph categories)
  - Tropical storm and hurricane wind probabilities
  - Lightning activity levels (1-5 scale)
  - Smart display showing only significant threats
  - Time-windowed probability analysis (48-hour outlook)
  - 5 integration tests passing

- ✅ **NOAA Gridpoint Enhancement**
  - Added GridpointSevereWeather interface with 11 new fields
  - Probability extraction and formatting utilities
  - Graceful degradation when data unavailable

- ✅ **New Utility Modules**
  - `src/utils/marine.ts`: Wave categorization, safety assessment, direction formatting
  - Helper functions with unit conversions (m/s ↔ knots, meters ↔ feet)

### Testing
- ✅ All integration tests passing (12/12 new tests)
- ✅ NEW test: `test_marine_conditions.ts` (7 tests)
- ✅ NEW test: `test_severe_weather.ts` (5 tests)
- ✅ NEW test: `test_noaa_gridpoint.ts` (gridpoint API exploration)
- ✅ TypeScript compilation with no errors
- ✅ 100% backward compatibility maintained

### Documentation
- ✅ README.md updated with v0.6.0 features
- ✅ CHANGELOG.md updated with comprehensive v0.6.0 release notes
- ✅ ROADMAP.md marked as complete
- ✅ Tool descriptions enhanced with semantic trigger phrases

### Implementation Details
- **Tools added:** 1 (get_marine_conditions)
- **Tools enhanced:** 1 (get_forecast)
- **Token cost:** ~250 tokens (within budget)
- **Backward compatibility:** Maintained ✅
- **Completion date:** 2025-11-06
- **Total tools:** 8 (v1.0.0 target achieved!)

---

## ✅ v0.4.0 Status: COMPLETE

All planned features have been implemented and tested:

### Completed Features
- ✅ **search_location tool** - NEW geocoding functionality for natural location queries
  - Converts location names to coordinates worldwide
  - Returns detailed metadata (timezone, elevation, population, country, admin regions)
  - Feature type classification (capital, city, airport, etc.)
  - 30-day cache for location searches
  - 8 integration tests passing

- ✅ **Enhanced get_forecast** - Global coverage with automatic source selection
  - NEW `source` parameter: "auto" (default), "noaa" (US), "openmeteo" (global)
  - Automatic US location detection (Continental, Alaska, Hawaii, territories)
  - Extended forecasts up to 16 days (was 7)
  - Sunrise/sunset times with daylight duration
  - UV index for international locations
  - Wind direction conversion (degrees to cardinal)
  - Dual formatting functions (NOAA and Open-Meteo)
  - 9 integration tests passing

- ✅ **Open-Meteo Service Expansion**
  - Added Forecast API client (`getForecast()` method)
  - Added Geocoding API client (`searchLocation()` method)
  - Multiple Axios clients for different endpoints
  - Proper error handling and caching

### Testing
- ✅ All integration tests passing (247/247)
- ✅ NEW test: `test_search_location.ts` (8 tests)
- ✅ NEW test: `test_global_forecasts.ts` (9 tests)
- ✅ Updated unit tests for 16-day forecast support
- ✅ TypeScript compilation with no errors
- ✅ 100% backward compatibility maintained

### Documentation
- ✅ README.md updated with v0.4.0 features
- ✅ CHANGELOG.md updated with comprehensive v0.4.0 release notes
- ✅ ROADMAP.md marked as complete
- ✅ Tool descriptions enhanced for AI understanding

### Implementation Details
- **Tools added:** 1 (search_location)
- **Tools enhanced:** 1 (get_forecast)
- **Token cost:** ~200 tokens (within budget)
- **Backward compatibility:** Maintained ✅
- **Completion date:** 2025-11-06
- **Total tools:** 6 (on track for v1.0.0 target of 7-8 tools)

---

## ✅ v0.3.0 Status: COMPLETE

All planned features have been implemented and tested:

### Completed Features
- ✅ **get_alerts tool** - NEW safety-critical weather warnings and advisories
  - Severity levels (Extreme, Severe, Moderate, Minor)
  - Urgency and certainty indicators
  - Effective/expiration times and affected areas
  - Automatic sorting by severity
  - 5-minute cache TTL

- ✅ **Enhanced get_forecast** - Hourly granularity and precipitation probability
  - NEW `granularity` parameter: "daily" | "hourly"
  - NEW `include_precipitation_probability` parameter (default: true)
  - Hourly provides up to 156 hours of detailed forecasts
  - Temperature trends and humidity display
  - Backward compatible (daily is default)

- ✅ **Enhanced get_current_conditions** - Comprehensive weather details
  - Heat index when temperature >80°F (intelligent display)
  - Wind chill when temperature <50°F (intelligent display)
  - 24-hour temperature range (high/low)
  - Wind gusts (shown when 20%+ higher than sustained)
  - Enhanced visibility with descriptive categories
  - Detailed cloud cover with heights and layers
  - Recent precipitation history (1hr, 3hr, 6hr)

### Testing
- ✅ All integration tests passing (6/6)
- ✅ Individual feature tests for alerts, forecasts, and conditions
- ✅ Multi-location testing across different climates
- ✅ Real data validation from NOAA APIs
- ✅ TypeScript compilation with no errors

### Documentation
- ✅ CHANGELOG.md updated with v0.3.0 section
- ✅ README.md updated with new features
- ✅ Tool descriptions enhanced for AI understanding

### Implementation Details
- **Tools added:** 1 (get_alerts)
- **Tools enhanced:** 2 (get_forecast, get_current_conditions)
- **Token cost:** ~300 tokens (within budget)
- **Backward compatibility:** Maintained ✅
- **Completion date:** 2025-11-05
