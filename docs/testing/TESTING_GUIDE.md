# Testing Guide

This guide covers testing the Weather MCP Server.

## Automated Testing

### NOAA API Connectivity Test

Run the test script to verify NOAA API is working:

```bash
npx tsx tests/test_noaa_api.ts
```

This will test:
- Point data retrieval (coordinate to grid conversion)
- Forecast fetching
- Station discovery
- Current conditions
- Historical observations

Expected output: All 5 tests should pass with ✅ marks.

## Manual Testing with Claude Code

### Setup

1. Build the project:
```bash
npm run build
```

2. Get the absolute path to your project:
```bash
pwd
# Example output: /home/user/projects/weather-mcp
```

3. Configure Claude Code to use the MCP server:

**macOS/Linux**: Edit `~/.config/claude-code/mcp_settings.json`
**Windows**: Edit `%APPDATA%\claude-code\mcp_settings.json`

Add this configuration (replace with your actual path):
```json
{
  "mcpServers": {
    "weather": {
      "command": "node",
      "args": ["/absolute/path/to/weather-mcp/dist/index.js"]
    }
  }
}
```

4. Restart Claude Code or reload the MCP configuration.

### Test Cases

#### Test 1: Get Forecast
Ask Claude Code:
```
What's the weather forecast for San Francisco?
Latitude: 37.7749, Longitude: -122.4194
```

**Expected Result**:
- 7-day forecast with periods (day/night)
- Temperature, wind, and conditions for each period
- Detailed forecast descriptions

#### Test 2: Get Current Conditions
Ask Claude Code:
```
What are the current weather conditions in New York City?
Latitude: 40.7128, Longitude: -74.0060
```

**Expected Result**:
- Current temperature, dewpoint, humidity
- Wind speed and direction
- Barometric pressure
- Visibility
- Station information and timestamp

#### Test 3: Get Historical Weather
Ask Claude Code:
```
Show me the weather observations for Chicago from 3 days ago to today.
Latitude: 41.8781, Longitude: -87.6298
Start date: (calculate 3 days ago in YYYY-MM-DD format)
End date: (today in YYYY-MM-DD format)
```

**Expected Result**:
- List of observations over the date range
- Temperature, conditions, and wind for each observation
- Timestamps for each observation

#### Test 4: Error Handling - Invalid Coordinates
Ask Claude Code:
```
What's the weather at latitude 999, longitude 999?
```

**Expected Result**:
- Clear error message about invalid coordinates
- No crash or hang

#### Test 5: Error Handling - Invalid Dates
Ask Claude Code:
```
Get historical weather for Seattle with invalid dates.
Latitude: 47.6062, Longitude: -122.3321
Start date: not-a-date
End date: also-not-a-date
```

**Expected Result**:
- Error message about invalid date format
- Suggestion to use ISO format (YYYY-MM-DD)

#### Test 6: Multiple Locations
Ask Claude Code to compare weather in multiple cities:
```
Compare the current weather in Los Angeles (34.0522, -118.2437),
Denver (39.7392, -104.9903), and Miami (25.7617, -80.1918)
```

**Expected Result**:
- Current conditions for all three locations
- Server handles multiple requests without issues

#### Test 7: Different Time Zones
Ask Claude Code:
```
What's the weather forecast for Honolulu, Hawaii?
Latitude: 21.3099, Longitude: -157.8581
```

**Expected Result**:
- Forecast with correct timezone handling
- Times displayed appropriately

## Debugging

### Check Server Logs

If the server isn't working:

1. Run the server directly to see error messages:
```bash
npm run dev
```

2. Type a test JSON-RPC message (or press Ctrl+C to exit)

### Common Issues

**Server not starting**:
- Check that `dist/index.js` exists (run `npm run build`)
- Verify Node.js version (requires v18+)
- Check for port conflicts

**NOAA API errors**:
- Run `npx tsx tests/test_noaa_api.ts` to verify API access
- Check internet connection
- Verify rate limits haven't been exceeded (wait 5 seconds and retry)

**Invalid coordinates**:
- Latitude must be -90 to 90
- Longitude must be -180 to 180
- NOAA API only covers US locations

**No historical data**:
- NOAA observations are limited to what stations have recorded
- Recent data (last 7-30 days) is most reliable
- Some stations may have gaps in data

## Performance Testing

### Response Times

Expected response times on good internet connection:
- **get_forecast**: 2-4 seconds
- **get_current_conditions**: 2-3 seconds
- **get_historical_weather**: 3-6 seconds (depending on range)

### Rate Limiting

NOAA enforces rate limits. If you hit the limit:
- Error message will indicate rate limit exceeded
- Wait 5 seconds before retrying
- The server has built-in exponential backoff retry logic

## Test Coverage Checklist

- [ ] Server starts without errors
- [ ] Automated tests pass (test_noaa_api.ts)
- [ ] Can get forecast for valid coordinates
- [ ] Can get current conditions for valid coordinates
- [ ] Can get historical weather for valid date range
- [ ] Error handling works for invalid coordinates
- [ ] Error handling works for invalid dates
- [ ] Can query multiple locations
- [ ] Different time zones handled correctly
- [ ] Rate limiting errors are handled gracefully
- [ ] Missing data is handled (null values)
- [ ] Response formatting is clear and readable

## Next Steps

After manual testing is complete:
1. Note any issues or improvements needed
2. Test edge cases specific to your use case
3. Consider adding automated integration tests
4. Document any NOAA API quirks discovered during testing
