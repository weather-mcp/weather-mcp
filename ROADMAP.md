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

### v0.3.0 - Enhanced Core Tools

**Theme:** Maximize existing tools, add critical safety feature

**Goal:** Add substantial functionality without tool bloat

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

**Summary for v0.3.0:**
- **Tools added:** 1 (get_alerts)
- **Tools enhanced:** 2 (get_forecast, get_current_conditions)
- **Token cost:** ~300 tokens
- **Effort:** ~1 week
- **Value:** Safety + hourly forecasts + better current conditions

---

### v0.4.0 - Global Expansion & Location Intelligence

**Theme:** Remove geographic limitations, enable natural location queries

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

**Summary for v0.4.0:**
- **Tools added:** 1 (search_location)
- **Tools enhanced:** 1 (get_forecast)
- **Token cost:** ~200 tokens
- **Effort:** ~1.5 weeks
- **Value:** Global forecasts + natural location queries + extended forecasts

**Cumulative Total:**
- **Tools:** 6 (was 4, added 2)
- **Token overhead:** ~500 tokens
- **Geographic coverage:** Global (was US-only)

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

### v0.6.0 - Specialized Weather (Optional)

**Theme:** Marine and severe weather for specialized use cases

#### 1. Add `get_marine_conditions` Tool ⭐ NEW TOOL (Optional)
**Coastal and ocean weather:**
```typescript
get_marine_conditions({
  latitude: number,
  longitude: number,
  forecast?: boolean    // default: false (current), true for forecast
})
```

**What this adds:**
- ✅ Wave height, period, direction
- ✅ Swell data
- ✅ Ocean water temperature
- ✅ Tidal information (if available)
- **Token cost:** +200 tokens (new tool)
- **New tools added:** 1
- **User queries enabled:**
  - "Are ocean conditions safe for boating?"
  - "What's the wave height off California?"
  - "Show me surf conditions"

**Why optional:**
- Specialized use case (coastal users only)
- Could be integrated into get_forecast with parameter
- Only add if user demand justifies

**Implementation:**
- Use Open-Meteo Marine API
- Cache for 1 hour
- Format for sailors/surfers/boaters

#### 2. Enhance `get_forecast` with Severe Weather (NO new tool)
**Add severe weather probabilities from NOAA:**
```typescript
get_forecast({
  // ... existing parameters
  include_severe_weather?: boolean  // NEW: thunderstorm/wind probabilities
})
```

**What this adds:**
- ✅ Thunder probability
- ✅ Wind gust probabilities (20-60mph categories)
- ✅ Tropical storm wind probabilities
- **Token cost:** +50 tokens
- **New tools added:** 0

**Summary for v0.6.0:**
- **Tools added:** 0-1 (marine_conditions optional)
- **Tools enhanced:** 1 (get_forecast)
- **Token cost:** ~50-250 tokens
- **Effort:** ~1-2 weeks
- **Value:** Marine weather + severe weather probabilities

**Cumulative Total (if marine added):**
- **Tools:** 8 (was 4, added 4)
- **Token overhead:** ~1,000-1,250 tokens

---

## Final Tool Inventory (v1.0.0)

### Core Tools (Always present)
1. **`get_forecast`** - Future weather (enhanced: hourly, global, 16-day, severe weather)
2. **`get_current_conditions`** - Current weather (enhanced: heat index, fire weather)
3. **`get_historical_weather`** - Past weather (unchanged)
4. **`get_alerts`** - Safety warnings ⭐ NEW
5. **`search_location`** - Geocoding ⭐ NEW
6. **`get_air_quality`** - Health data ⭐ NEW
7. **`check_service_status`** - API health (enhanced: cache stats)

### Optional Tools (Add based on demand)
8. **`get_marine_conditions`** - Ocean/coastal weather ⭐ NEW (optional)

**Total: 7-8 tools** (up from 4)
**Token cost: ~1,000-1,500 tokens** (0.5-0.75% of 200k context)
**Functionality increase: ~300%**

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

### Target State (v1.0.0)
| Tool | Approximate Tokens | Change |
|------|-------------------|--------|
| get_forecast | ~300 | +100 (hourly, global, 16-day) |
| get_current_conditions | ~200 | +50 (heat index, fire weather) |
| get_historical_weather | ~250 | 0 (unchanged) |
| get_alerts | ~200 | +200 (NEW) |
| search_location | ~150 | +150 (NEW) |
| get_air_quality | ~200 | +200 (NEW) |
| check_service_status | ~100 | 0 (unchanged) |
| get_marine_conditions | ~200 | +200 (NEW, optional) |
| **Total** | **~1,400-1,600** | **+700-900** |

**Final Overhead: ~1,500 tokens (0.75% of 200k context)**

---

*Last Updated: 2025-11-05*
*Current Version: v0.1.2 (with caching)*
*Next Target: v0.3.0 - Enhanced Core Tools*
*Design Philosophy: Lean, efficient, user-focused*
