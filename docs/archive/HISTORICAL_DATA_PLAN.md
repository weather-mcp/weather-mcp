# Historical Weather Data Implementation Plan

> **📁 ARCHIVED 2026-08-12.** The November-2025 plan for the NOAA CDO →
> Open-Meteo historical-data migration, completed that same month.
> `get_historical_weather` has been Open-Meteo-backed (global, 1940–present)
> ever since.

## Current Status (November 4, 2025)

### What Works ✓

1. **Recent Historical Data (0-7 days ago)**
   - Fully functional using NOAA real-time API
   - No token required
   - Returns detailed hourly observations
   - Includes: temperature, conditions, wind speed, humidity, pressure
   - Successfully tested with San Francisco coordinates

2. **CDO API Authentication**
   - Token configured correctly in `.env`
   - Successfully authenticates with NOAA CDO API
   - Token validation working properly

### Current Limitations

**Archival Data (>7 days old) via CDO API**

The CDO (Climate Data Online) API has significant limitations:

1. **Extent-based station search issues**:
   - Returns incorrect results (Antarctic stations with wrong coordinates)
   - Date filters on station queries return 0 results
   - Small geographic areas return no stations
   - Large geographic areas return incorrect/foreign stations

2. **API service constraints**:
   - Querying without location filters causes 503 errors
   - Limited US station coverage accessible via the public API
   - Rate limiting: 5 requests/second, 10,000 requests/day

3. **Test findings**:
   - Extent search: `-77.7369,38.2072,-76.3369,39.6072` → 0 stations
   - Large extent: `-80,35,-75,40` → Returns Antarctic stations
   - No location filter → 503 Service Unavailable

### What Does Work with CDO API

- Searching by FIPS location codes (e.g., `FIPS:11` for DC)
- Direct station queries when station ID is known
- Data retrieval from specific stations works well

### Implementation Options

**Option A: Improve Error Messaging**
- Guide users toward the 7-day window that works reliably
- Provide clear feedback about archival data limitations
- Document CDO API constraints

**Option B: FIPS-based Location Lookup**
- Implement coordinate-to-FIPS code conversion
- Use location ID search instead of extent search
- Requires geocoding/reverse geocoding logic

**Option C: Hybrid Approach**
- Keep real-time API for recent data (current implementation)
- Add optional FIPS code parameter for archival queries
- Document both approaches in README

**Option D: Alternative Data Source**
- Evaluate other weather data APIs
- Consider National Weather Service APIs
- Look into Weather Underground or similar services

## Code Changes Made

### `src/services/cdo.ts`

1. **Added distance calculation** (`calculateDistance` method)
   - Haversine formula for accurate distance computation
   - Used to sort stations by proximity

2. **Modified station search** (`findStationsByLocation` method)
   - Removed date filters from station queries (they return 0 results)
   - Implemented broader search with client-side filtering
   - Added distance-based sorting and filtering

3. **Enhanced error handling**
   - Better authentication error messages
   - Rate limit detection and retry logic
   - Helpful error messages directing users to token signup

### `src/index.ts`

- Integrated CDO service for dates >7 days old
- Automatic routing between real-time and archival APIs
- Comprehensive date validation and error handling
- Formatted output for daily summaries vs hourly observations

## Testing Performed

### Successful Tests

1. ✓ Recent historical data (last 7 days) - San Francisco
2. ✓ CDO API authentication with token
3. ✓ Dataset availability query
4. ✓ Direct station data retrieval by station ID

### Failed/Limited Tests

1. ✗ Extent-based station search with small areas
2. ✗ Extent-based station search with date filters
3. ✗ Broad station queries without filters (503 errors)
4. ⚠ Extent-based search returns non-US stations incorrectly

## Next Steps

### Short Term

1. **Clean up test files** in project root
2. **Document limitations** in README.md
3. **Improve error messages** to guide users
4. **Add examples** for working date ranges

### Medium Term

1. **Research FIPS code lookup** options
2. **Test with known good stations** for specific cities
3. **Evaluate alternative APIs** for archival data
4. **Consider caching strategy** for station lookups

### Long Term

1. **Implement coordinate-to-FIPS** conversion
2. **Add station database** for common cities
3. **Build fallback mechanisms** for data retrieval
4. **Expand international support** beyond US stations

## Resources

- CDO API Documentation: https://www.ncdc.noaa.gov/cdo-web/webservices/v2
- Token Registration: https://www.ncdc.noaa.gov/cdo-web/token
- NOAA API Documentation: https://www.weather.gov/documentation/services-web-api
- FIPS Codes: https://www.census.gov/library/reference/code-lists/ansi.html

## Notes

- The 7-day window using real-time NOAA API is very reliable
- Most users likely need recent historical data more than archival
- CDO API may be better suited for bulk downloads rather than real-time queries
- Consider whether archival data is a core feature or nice-to-have
