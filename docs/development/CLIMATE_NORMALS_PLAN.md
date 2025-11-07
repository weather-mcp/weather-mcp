# Climate Normals Implementation Plan

**Status:** Research & Planning Phase
**Target Version:** v1.2.0
**Last Updated:** 2025-11-07

## Table of Contents
1. [Overview](#overview)
2. [What Are Climate Normals?](#what-are-climate-normals)
3. [Data Source Research](#data-source-research)
4. [Feasibility Analysis](#feasibility-analysis)
5. [Recommended Approach](#recommended-approach)
6. [Implementation Plan](#implementation-plan)
7. [Risks & Challenges](#risks--challenges)
8. [Alternatives Considered](#alternatives-considered)

---

## Overview

**Goal:** Add climate normals (30-year averages) to weather data, enabling users to see how current/forecast conditions compare to historical averages.

**Requirements from ROADMAP.md:**
- Show climate normals in `get_forecast` and `get_current_conditions`
- Include averages for: high/low temps, precipitation
- Show departures from normal (e.g., "10°F above normal")
- NO new tool required (enhancement to existing tools)
- Zero token cost increase (doesn't enlarge tool descriptions)
- Opt-in via `include_normals` parameter (default: false)

**User Value:**
- "Is today's 75°F unusually warm for November?"
- "This week's forecast calls for 3 inches of rain - is that abnormal?"
- Provides historical context for weather conditions

---

## What Are Climate Normals?

**Definition:** Climate normals are 30-year averages of weather conditions (temperature, precipitation, etc.) calculated to provide a baseline for current weather.

**Current Standard:** 1991-2020 Climate Normals (released by NOAA in 2021)
- Updated every 10 years
- Calculated using consistent methodology
- Includes daily, monthly, seasonal, and annual averages

**Key Metrics:**
- Daily high/low temperature normals
- Daily precipitation normals
- Snowfall normals
- Growing degree days
- Heating/cooling degree days

---

## Data Source Research

### Option 1: NOAA NCEI (National Centers for Environmental Information) 🇺🇸

**API Details:**
- **Endpoint:** `https://www.ncei.noaa.gov/access/services/data/v1`
- **Old endpoint (deprecated):** `https://www.ncei.noaa.gov/cdo-web/api/v2`
- **Documentation:** https://www.ncei.noaa.gov/support/access-data-service-api-user-documentation
- **Dataset:** Climate Normals 1991-2020

**Access:**
- ✅ Free
- ⚠️ Requires API token (register at https://www.ncdc.noaa.gov/cdo-web/token)
- ⚠️ Rate limits: 5 requests/sec, 10,000 requests/day
- 🌍 Coverage: US only (~15,000 weather stations)

**Data Available:**
- Daily normals (temperature, precipitation)
- Monthly normals (comprehensive statistics)
- Annual/seasonal normals
- Station-based (requires station lookup from coordinates)

**Pros:**
- Official NOAA climate normals
- Comprehensive and accurate
- Free with reasonable rate limits
- Well-documented API

**Cons:**
- Requires user to obtain API token (breaks "no API key" feature)
- US coverage only
- Station-based (not direct coordinate lookup)
- New API integration (different from weather.gov)
- Need token management in codebase

---

### Option 2: Open-Meteo Historical Data 🌍

**API Details:**
- **Endpoint:** `https://archive-api.open-meteo.com/v1/archive`
- **Documentation:** https://open-meteo.com/en/docs/historical-weather-api
- **Data Range:** 1940-present

**Access:**
- ✅ Free, no API key required
- ✅ Unlimited requests (rate-limited but generous)
- 🌍 Coverage: Global
- ✅ Already integrated in our codebase

**Data Available:**
- Hourly weather data back to 1940
- Daily aggregates (temp, precipitation, etc.)
- Reanalysis datasets (ERA5, etc.)
- Coordinate-based (direct lookup)

**Approach:**
We would need to **compute normals ourselves**:
1. Fetch 30 years of historical data for location (1991-2020)
2. Calculate averages for each day of year
3. Cache aggressively (normals don't change)

**Pros:**
- No API key needed (maintains project philosophy)
- Global coverage
- Already integrated
- Coordinate-based (easier to use)
- Free and unlimited

**Cons:**
- Must compute normals ourselves (computationally expensive)
- Initial fetch of 30 years = large data transfer
- Not "official" normals (computed from reanalysis)
- Need sophisticated caching strategy
- More complex implementation

---

### Option 3: Meteostat API 🌍

**API Details:**
- **Endpoint:** `https://meteostat.p.rapidapi.com/point/normals`
- **Documentation:** https://dev.meteostat.net/api/point/normals.html
- **Normals:** Pre-calculated 30-year averages

**Access:**
- ⚠️ Requires RapidAPI key
- ⚠️ Free tier: 500 requests/month (very limited)
- 🌍 Coverage: Global
- ⚠️ License: CC BY-NC 4.0 (non-commercial only)

**Data Available:**
- Monthly climate normals
- Station and point (coordinate) based
- Temperature and precipitation

**Pros:**
- Pre-calculated normals (easy to use)
- Global coverage
- Both station and coordinate lookup

**Cons:**
- **DEALBREAKER:** CC BY-NC 4.0 license conflicts with our MIT license
- Requires API key (breaks "no key" feature)
- Very low free tier (500/month)
- Would need RapidAPI integration

**Verdict:** ❌ Not viable due to licensing conflict

---

### Option 4: Pre-Downloaded NOAA Data Files 💾

**Approach:**
- Download NOAA's published normals data (public domain)
- Bundle station normals file with MCP server
- Look up values from local data (no API calls)

**Data Source:**
- AWS Open Data Registry: https://registry.opendata.aws/noaa-climate-normals/
- Direct download: https://www.ncei.noaa.gov/data/normals-monthly/access/

**Pros:**
- No API calls (fast)
- Official NOAA data
- Works offline
- No rate limits
- No API token needed

**Cons:**
- **Large data files** (~500MB for all stations)
- Increases package size significantly
- Station-based (need to match coordinates to stations)
- Update required every 10 years
- US coverage only

**Verdict:** 🤔 Possible but increases complexity and package size

---

## Feasibility Analysis

### Is it Possible?
**YES** - Multiple viable data sources exist.

### Can We Use Free Services?
**YES** - Both NOAA NCEI and Open-Meteo are free.

### Which Approach is Best?
After analyzing all options, a **hybrid approach** is recommended.

---

## Recommended Approach

### Hybrid Strategy: NCEI + Open-Meteo Fallback

**Architecture:**

```
User requests normals (include_normals=true)
    |
    v
Is location in US?
    |
    +-- YES --> Do we have NCEI API token?
    |              |
    |              +-- YES --> Use NCEI normals ⭐
    |              |
    |              +-- NO --> Use Open-Meteo computed normals
    |
    +-- NO --> Use Open-Meteo computed normals
```

### Implementation Details

#### 1. NOAA NCEI Integration (US, Optional)

**Configuration:**
```typescript
// .env (optional)
NCEI_API_TOKEN=your_token_here
```

**Service Method:**
```typescript
// src/services/ncei.ts
async getClimateNormals(
  stationId: string,
  month: number,
  day: number
): Promise<ClimateNormals> {
  // Fetch from NCEI API
  // Return: { tempHigh, tempLow, precipitation }
}
```

**Caching Strategy:**
- Cache key: `normals:${stationId}:${month}:${day}`
- TTL: Infinity (normals don't change)

#### 2. Open-Meteo Computed Normals (Global, Always Available)

**Service Method:**
```typescript
// src/services/openmeteo.ts
async computeClimateNormals(
  latitude: number,
  longitude: number,
  month: number,
  day: number
): Promise<ClimateNormals> {
  // Check cache first
  // If not cached:
  //   1. Fetch 30 years of historical data (1991-2020)
  //   2. Filter to same month/day across all years
  //   3. Calculate averages
  //   4. Cache result (TTL: 1 year)
  // Return: { tempHigh, tempLow, precipitation }
}
```

**Optimization:**
- Fetch only 1 month of data across 30 years (not full 30 years)
- Pre-compute for common locations on first request
- Cache forever (or at least 1 year)

#### 3. Integration into Handlers

**Update `get_current_conditions`:**
```typescript
interface CurrentConditionsArgs {
  latitude: number;
  longitude: number;
  include_fire_weather?: boolean;
  include_normals?: boolean; // NEW
}

// In handler:
if (includeNormals) {
  const normals = await getNormals(latitude, longitude, currentDate);
  const departure = currentTemp - normals.tempHigh;
  output += `\n## Climate Context\n\n`;
  output += `**Normal High:** ${normals.tempHigh}°F\n`;
  output += `**Normal Low:** ${normals.tempLow}°F\n`;
  output += `**Today's Departure:** ${departure > 0 ? '+' : ''}${departure}°F\n`;
}
```

**Update `get_forecast`:**
```typescript
interface ForecastArgs {
  latitude: number;
  longitude: number;
  days?: number;
  granularity?: 'daily' | 'hourly';
  include_precipitation_probability?: boolean;
  include_severe_weather?: boolean;
  include_normals?: boolean; // NEW
}

// In handler:
if (includeNormals) {
  for (const period of periods) {
    const normals = await getNormals(latitude, longitude, period.date);
    output += `**Normal Range:** ${normals.tempLow}-${normals.tempHigh}°F\n`;
  }
}
```

---

## Implementation Plan

### Phase 1: Foundation (Week 1)
- [ ] Create `src/services/ncei.ts` for NCEI API integration
- [ ] Add NCEI API token configuration (optional)
- [ ] Implement NCEI climate normals fetching
- [ ] Add unit tests for NCEI service

### Phase 2: Computation (Week 1-2)
- [ ] Implement Open-Meteo normals computation in `src/services/openmeteo.ts`
- [ ] Optimize data fetching (monthly windows, not full years)
- [ ] Add aggressive caching for computed normals
- [ ] Add unit tests for normals computation

### Phase 3: Integration (Week 2)
- [ ] Create `src/utils/normals.ts` utility
- [ ] Implement hybrid selection logic (NCEI vs Open-Meteo)
- [ ] Add `include_normals` parameter to `get_current_conditions`
- [ ] Add `include_normals` parameter to `get_forecast`
- [ ] Format normals output with departures

### Phase 4: Testing & Documentation (Week 2)
- [ ] Integration tests for NCEI API
- [ ] Integration tests for computed normals
- [ ] End-to-end tests with real data
- [ ] Update README.md with normals documentation
- [ ] Update CHANGELOG.md
- [ ] Document NCEI API token setup (optional)

**Total Estimated Time:** 2 weeks

---

## Risks & Challenges

### Technical Challenges

1. **NCEI API Complexity**
   - Station lookup from coordinates
   - Dataset selection (which normals dataset to use)
   - Date formatting and querying
   - **Mitigation:** Thorough API testing, fallback to Open-Meteo

2. **Computing Normals from Historical Data**
   - Large data transfers (30 years)
   - Computation overhead
   - Cache invalidation strategy
   - **Mitigation:** Aggressive caching, monthly data windows, lazy computation

3. **Cache Size Growth**
   - Normals for every location/date combination
   - Could grow large over time
   - **Mitigation:** Set reasonable cache size limits, LRU eviction for normals cache

4. **Accuracy of Computed Normals**
   - Open-Meteo reanalysis vs actual observations
   - Differences from official normals
   - **Mitigation:** Clearly document data source, show "computed from historical data"

### User Experience Challenges

1. **Optional NCEI Token**
   - Users may be confused about setup
   - **Mitigation:** Excellent documentation, normals work without token

2. **Performance**
   - First request for location/date may be slow (computing normals)
   - **Mitigation:** Clear messaging, background computation, caching

3. **Data Availability**
   - Not all locations may have normals (remote areas)
   - **Mitigation:** Graceful fallback, "normals not available" messaging

---

## Alternatives Considered

### Alternative 1: Normals Only on Demand (Separate Tool)
**Approach:** Create `get_climate_normals` tool instead of parameter.

**Pros:**
- Cleaner separation of concerns
- Users explicitly request normals

**Cons:**
- Increases token cost (new tool description)
- Less integrated experience
- More API calls for user to get full picture

**Verdict:** ❌ Rejected - violates "zero token cost" requirement

---

### Alternative 2: Bundle Pre-computed Normals
**Approach:** Pre-compute normals for common locations, bundle with server.

**Pros:**
- Very fast
- No API calls
- Offline capability

**Cons:**
- Only covers pre-selected locations
- Large package size
- Update complexity

**Verdict:** 🤔 Could be future optimization (v1.3.0+)

---

### Alternative 3: Use Only Open-Meteo
**Approach:** Skip NCEI entirely, always compute from historical data.

**Pros:**
- Simpler architecture
- No API token management
- Global coverage

**Cons:**
- Not official normals for US locations
- Computational overhead
- Less accurate

**Verdict:** 🤔 Viable fallback, but hybrid approach is better

---

### Alternative 4: Partner with External Service
**Approach:** Use a third-party normals API service.

**Pros:**
- Pre-computed data
- Easy integration

**Cons:**
- Most require API keys (Meteostat, etc.)
- Licensing issues (CC BY-NC vs MIT)
- Cost for users
- Dependency on external service

**Verdict:** ❌ Rejected - violates "no API key required" philosophy

---

## Decision Matrix

| Approach | Free | No Key | Global | Accurate | Performance | Complexity |
|----------|------|--------|--------|----------|-------------|------------|
| **Hybrid (Recommended)** | ✅ | ⚠️ Optional | ✅ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| NCEI Only | ✅ | ❌ | ❌ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| Open-Meteo Only | ✅ | ✅ | ✅ | ⭐⭐ | ⭐⭐ | ⭐⭐ |
| Meteostat | ❌ | ❌ | ✅ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| Pre-downloaded | ✅ | ✅ | ❌ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ |

**Legend:** ⭐⭐⭐⭐⭐ = Excellent, ⭐ = Poor

---

## Conclusion

### Final Recommendation: **Proceed with Hybrid Approach** ✅

**Justification:**
1. **Feasible** - Multiple free data sources available
2. **No mandatory API keys** - Works globally with Open-Meteo fallback
3. **Best accuracy** - Uses official NCEI normals when available
4. **Reasonable complexity** - 2-week implementation estimate
5. **User value** - High demand feature with clear benefits

### Implementation Strategy:
- Start with Open-Meteo computed normals (simpler, always works)
- Add NCEI integration as enhancement
- Make NCEI token optional (document setup process)
- Default `include_normals=false` (opt-in)

### Next Steps:
1. **Get user approval** on this approach
2. **Create feature branch** for normals work
3. **Start with Open-Meteo** computed normals (Phase 2)
4. **Add NCEI integration** (Phase 1)
5. **Integrate into handlers** (Phase 3)
6. **Test and document** (Phase 4)

---

**Document Status:** Ready for Review
**Approval Needed From:** @dangahagan
**Estimated Implementation:** 2 weeks (1-2 developers)
