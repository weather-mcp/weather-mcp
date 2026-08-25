# Enhanced Error Handling & Service Status

This document describes the robust error handling and service status checking features added to the Weather MCP Server.

## Overview

The Weather MCP Server now provides comprehensive error handling with actionable guidance and proactive service health monitoring. These features help AI clients and users quickly diagnose and resolve issues, especially during API outages or service disruptions.

## Features

### 1. Enhanced Error Messages

All errors now include:
- **Clear problem description** - What went wrong and why
- **Contextual help** - Specific guidance based on error type
- **Status page links** - Direct links to official service status pages
- **Recommended actions** - Concrete next steps

### 2. Service Status Checking

New `check_service_status` MCP tool performs health checks on both APIs:
- NOAA Weather API (forecasts & current conditions)
- Open-Meteo API (historical weather data)

Returns real-time operational status with helpful links and recommendations.

## Error Message Examples

### NOAA API Errors

#### Service Outage (5xx errors)
```
NOAA API server error: Service temporarily unavailable

The NOAA Weather API may be experiencing an outage.

Check service status:
- Planned outages: https://weather-gov.github.io/api/planned-outages
- Service notices: https://www.weather.gov/notification
- Report issues: nco.ops@noaa.gov or (301) 683-1518
```

#### Rate Limiting (429 error)
```
NOAA API rate limit exceeded. Please retry in a few seconds.

Details: Too many requests

For more information about rate limits, visit:
https://weather-gov.github.io/api/
```

#### Geographic Coverage (404 error)
```
NOAA API error: Not Found

This location may be outside NOAA's coverage area (US only).

If this persists, check:
- Planned outages: https://weather-gov.github.io/api/planned-outages
- Service notices: https://www.weather.gov/notification
- Report issues: https://weather-gov.github.io/api/reporting-issues
```

#### Connection Issues
```
Unable to connect to NOAA API.

Possible causes:
- Internet connection issues
- NOAA API service outage
- DNS resolution problems

Check:
- Your internet connection
- Service status: https://weather-gov.github.io/api/planned-outages
```

### Open-Meteo API Errors

#### Service Outage (5xx errors)
```
Open-Meteo API server error: Service temporarily unavailable

The Open-Meteo API may be experiencing an outage.

Check service status:
- Production status: https://open-meteo.com/en/docs/model-updates
- GitHub issues: https://github.com/open-meteo/open-meteo/issues
```

#### Rate Limiting (429 error)
```
Open-Meteo API rate limit exceeded (10,000 requests/day for non-commercial use).

Please retry later or consider:
- Reducing request frequency
- Using daily instead of hourly data for longer periods
- Upgrading to a commercial plan for higher limits

More info: https://open-meteo.com/en/pricing
```

#### Invalid Parameters (400 error)
```
Open-Meteo API error: Invalid date range

Please verify:
- Coordinates are valid (latitude: -90 to 90, longitude: -180 to 180)
- Date range is valid (1940 to 5 days ago)
- Parameters are correctly formatted

API documentation: https://open-meteo.com/en/docs/historical-weather-api
```

#### Connection Issues
```
Unable to connect to Open-Meteo API.

Possible causes:
- Internet connection issues
- Open-Meteo API service outage
- DNS resolution problems

Check:
- Your internet connection
- Service status: https://open-meteo.com/en/docs/model-updates
```

### Optional Dependency Errors

Unlike everything above, this is a **configuration** state, not an upstream outage. No weather
service is down — the server was installed without an optional package, and the tool that needs it
says so rather than guessing.

#### Lightning package missing

```
This server was installed without the optional "mqtt" package, which lightning
detection requires. Reinstall without --omit=optional
(e.g. npm install -g @dangahagan/weather-mcp) to enable it.
```

Returned by `get_lightning_activity` as an error result. The same text appears inside
`get_weather_summary` when `lightning` is requested, under a `## lightning (unavailable)` heading —
there the summary still succeeds and its other sections are unaffected.

Check:
- Whether the server was installed with `--omit=optional` (`npm ls mqtt` in the install prefix
  resolves nothing if so)
- Reinstall without the flag to restore lightning: `npm install -g @dangahagan/weather-mcp`

This error is deliberately **not** a silent degradation. Reporting "no strikes" because a package
is missing would be a confidently wrong answer on safety data, so the absence is surfaced instead.

## Service Status Tool

### Usage

Call the `check_service_status` tool with no parameters:

```javascript
// Example query to AI assistant
"Check if the weather services are working"
"What is the status of the weather APIs?"
"Are the weather services online?"
```

### Output Format

```markdown
# Weather API Service Status

**Check Time:** [timestamp]

## NOAA Weather API (Forecasts & Current Conditions)

**Status:** ✅ Operational | ❌ Issues Detected
**Message:** [status message]
**Status Page:** https://weather-gov.github.io/api/planned-outages
**Coverage:** United States locations only

[Recommended Actions if issues detected]

## Open-Meteo API (Historical Weather Data)

**Status:** ✅ Operational | ❌ Issues Detected
**Message:** [status message]
**Status Page:** https://open-meteo.com/en/docs/model-updates
**Coverage:** Global (worldwide locations)

[Recommended Actions if issues detected]

## Overall Status: ✅ All Services Operational | ❌ Multiple Service Issues | ⚠️ Partial Service Availability

[Summary and recommendations]
```

### When to Use

- **Before batch requests** - Verify services are operational before making multiple weather data requests
- **After errors** - Diagnose whether errors are due to service outages or other issues
- **Monitoring** - Periodic health checks for uptime monitoring
- **Debugging** - Verify API connectivity during development and testing

### Health Check Implementation

The status checker performs lightweight API requests:

**NOAA API:**
- Tests: `/points/39.8283,-98.5795` (geographic center of US mainland)
- Timeout: 10 seconds
- Interprets: 200 OK = operational, 429 = operational but rate limited, 5xx = outage

**Open-Meteo API:**
- Tests: Historical data request for London, 30 days ago
- Timeout: 10 seconds
- Interprets: 200 OK = operational, 429 = operational but rate limited, 5xx = outage

## Implementation Details

### Error Handler Architecture

Both `NOAAService` and `OpenMeteoService` classes implement enhanced error handlers:

```typescript
private async handleError(error: AxiosError): Promise<never> {
  // Categorize error by status code and error type
  // Provide contextual help and status page links
  // Include recommended actions based on error category
}
```

### Status Check Methods

Both service classes expose public status check methods:

```typescript
async checkServiceStatus(): Promise<{
  operational: boolean;
  message: string;
  statusPage: string;
  timestamp: string;
}>
```

### MCP Tool Integration

The `check_service_status` tool in `index.ts`:
- Calls both service status checkers in parallel
- Formats results with markdown for AI client display
- Provides overall system status summary
- Includes actionable recommendations when issues detected

## Official Status Resources

### NOAA Weather API

- **Planned Outages:** https://weather-gov.github.io/api/planned-outages
- **Service Notices:** https://www.weather.gov/notification (with email subscription)
- **Report Issues:** nco.ops@noaa.gov or (301) 683-1518
- **API Documentation:** https://weather-gov.github.io/api/

### Open-Meteo API

- **Production Status:** https://open-meteo.com/en/docs/model-updates
- **GitHub Issues:** https://github.com/open-meteo/open-meteo/issues
- **Documentation:** https://open-meteo.com/en/docs
- **Pricing & Limits:** https://open-meteo.com/en/pricing

## Testing

Run the comprehensive test suite:

```bash
# Test service status checking and error handling
npx tsx tests/test_service_status.ts

# Test the MCP tool directly
npx tsx tests/test_mcp_status_tool.ts
```

## Benefits

1. **Faster Issue Resolution** - Users get immediate context about errors with links to status pages
2. **Reduced Support Load** - Self-service error messages reduce need for manual support
3. **Proactive Monitoring** - AI clients can check status before making requests
4. **Better UX** - Clear, actionable messages instead of cryptic error codes
5. **Operational Awareness** - Real-time visibility into API health during outages

## Future Enhancements

Potential improvements:
- Cache status check results for 1-2 minutes to reduce API calls
- Add retry logic with exponential backoff to tool responses
- Integration with external status monitoring services
- Historical uptime tracking and statistics
- Webhook notifications for status changes
