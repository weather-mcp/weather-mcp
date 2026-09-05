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

#### Lightning package present but unloadable

```
The optional "mqtt" package is installed but could not be loaded, so lightning
detection is unavailable. This usually means a damaged or partial install;
reinstalling the server (e.g. npm install -g @dangahagan/weather-mcp) repairs it.
```

A different state from the one above, with a different remedy: the package **is** installed, so
reinstalling without `--omit=optional` would not help. It usually means a damaged or partially
extracted `node_modules` — a package whose own dependencies are missing reports this, as does one
whose files were truncated.

Check:
- `node -e "import('mqtt').then(() => console.log('ok'), e => console.log(e.code, e.message))"`
  from the install prefix — it names what actually failed
- Reinstall the server, or clear the npm cache (`npm cache clean --force`) and reinstall

Like the case above, this reaches both surfaces and is never a silent degradation.

**Restart the server after repairing the install.** The server does not cache this failure — the
next lightning query genuinely re-attempts the load — but Node caches the failed module itself, so
within one process every retry replays the same error even once the files on disk are fixed. MCP
clients spawn the server per session, so reconnecting is usually enough.

#### Lightning feed unreachable

```
## ⚪ Safety Status: UNKNOWN (LIVE FEED UNAVAILABLE)

The live lightning feed could not be reached, so no strikes could be observed for
this area. This is not an all-clear.
```

**Unlike the two package cases above, this is not a tool error.** It arrives *inside* a normal
lightning report, and `get_lightning_activity` still returns a result. The two states differ in
what can be repaired: a missing or broken `mqtt` package is a permanent property of the install
that only the user can fix, so the tool refuses rather than answering. An unreachable broker is
transient — the client reconnects on its own — and the report still carries real information: the
location, the requested window, how much of it was actually monitored, and any strikes already
buffered from earlier monitoring.

Reporting it in-result also keeps `get_weather_summary` useful. The same ⚪ heading and explanation
render inline in the summary's `lightning` section; it does **not** collapse to
`## lightning (unavailable)` the way a thrown error would.

What the report will and will not claim:

- It never says "no strikes" as a finding. A feed that could not be reached observed nothing, and
  the report says so in those words.
- It does not tell you to re-check shortly. During an outage every re-check reads the same zero, so
  the advice is to consult official weather services — the NWS or your national authority.
- Strikes buffered before the outage keep their verdict. A buffered EXTREME strike still renders as
  EXTREME; a buffered strike beyond the safe-band threshold stays listed, but under the UNKNOWN
  heading rather than an all-clear.

The cause (connect timeout, connection error, or a failed subscribe) is written to the **stderr log
only**, never to the report. Nothing about the broker — its URL included — reaches either surface.

No action is usually needed. If every lightning query reports an outage, check outbound access to
the broker on port 1883, or set `BLITZORTUNG_MQTT_URL` to a reachable one.

### Life-Threatening Alert Banner Failures

The one failure on this page that renders **nothing at all**, deliberately.

`get_forecast`, `get_current_conditions` and `get_weather_summary` surface a banner when the
National Weather Service has a life-threatening alert active for a US point (see
[Life-threatening alert banner](TOOLS.md#life-threatening-alert-banner)). When that lookup fails —
NOAA unreachable, a timeout, a malformed response — the banner is **omitted silently**. No note, no
placeholder, no "could not check". The weather report itself is unaffected and answers the question
as asked.

**This is the deliberate posture, not a swallowed error.** The banner is a *positive assertion
only*: it appears when there is something to say and is absent otherwise. A "could not check the
alerts" note would appear during every upstream hiccup and teach readers to skip the slot; worse,
announcing that the tool had *checked* would turn every silence into an implied all-clear. So the
banner's absence carries no information in either direction, whether the lookup succeeded and found
nothing or failed outright.

**Call `get_alerts` for the authoritative answer.** That tool reports alert coverage under full
contract rules — a fetch failure there *propagates* as an error rather than rendering an empty
result, and an uncovered region is reported as uncovered rather than as quiet.

The failure is recorded once to the **stderr log** as a `securityEvent` warning carrying only the
HTTP status and error type — never a URL and never the raw upstream error — and is **not retried**,
so a slow or dead NOAA alerts endpoint never adds latency to a forecast. Nothing about the failure
reaches the tool result.

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
