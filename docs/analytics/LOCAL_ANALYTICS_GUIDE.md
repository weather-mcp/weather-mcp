# Local Analytics Testing Guide

This guide explains how to test the Weather MCP server with local analytics in development mode.

## Prerequisites

1. **Analytics Server Running**
   ```bash
   cd /home/dgahagan/work/personal/weather-mcp/analytics-server
   npm run dev
   ```
   Server should be running on `http://localhost:3100`

2. **Docker Services Running**
   - PostgreSQL: `analytics-postgres-dev` (port 5432)
   - Redis: `analytics-redis-dev` (port 6379)

## Configuration

Analytics is off by default. To send events to your own analytics server, set these in `.env`:

```bash
# Analytics Configuration
ANALYTICS_ENABLED=true
ANALYTICS_LEVEL=detailed
ANALYTICS_ENDPOINT=https://analytics.example.test/v1/events  # your HTTPS hostname

# Debug Logging
LOG_LEVEL=0  # 0=DEBUG for verbose output
```

The MCP server does not accept `http://localhost:3100/v1/events`: the endpoint must be HTTPS, and
`localhost` is rejected. To reach a local analytics server, put an HTTPS reverse proxy or tunnel with
a real domain name in front of port 3100, and set `ANALYTICS_ENDPOINT` to that hostname.

### Endpoint requirements

The server checks `ANALYTICS_ENDPOINT` once, at startup. The endpoint must:

- be a valid URL that uses `https://`;
- use a domain name, not an IP address — neither IPv4 (`https://10.0.0.1/`) nor IPv6
  (`https://[::1]/`, `https://[fd00::1]/`), public or private;
- not be `localhost` or a name ending in `.local`;
- use port 443, or a port from 1024 to 65535.

An endpoint that fails any check **disables analytics**. The server logs one
`Invalid ANALYTICS_ENDPOINT configuration: …` error at startup and keeps running; no tool is
affected. These checks look only at the configured string. They cannot see what a domain name
resolves to.

## Testing Analytics Integration

### Option 1: Quick Test Script

Run the provided test script to verify analytics are working:

```bash
npx tsx test-mcp-with-analytics.ts
```

This will:
- Run 3 sample MCP tool calls (check_service_status, 2x get_forecast)
- Track analytics events with detailed metadata
- Buffer events in memory
- Flush events to the local analytics server
- Display results and next steps

### Option 2: Using the MCP Server Directly

1. **Build the server:**
   ```bash
   npm run build
   ```

2. **Run the server:**
   ```bash
   npm run dev
   ```

3. **Make requests through your MCP client** (Claude Desktop, etc.)
   - Every tool call will automatically send analytics to the configured `ANALYTICS_ENDPOINT`
   - Analytics are tracked in the background and never interfere with tool execution

## Verifying Analytics Data

### Check Analytics API Logs

The analytics server will log incoming events:

```
INFO: Events queued successfully
DEBUG: All events validated successfully
```

### Check Redis Queue

See how many events are waiting to be processed:

```bash
docker exec -i analytics-redis-dev redis-cli LLEN events_queue
```

### Check Analytics Server Endpoint

Query the stats endpoint to see aggregated data:

```bash
curl http://localhost:3100/v1/stats/all?period=24h | jq
```

### View Analytics Dashboard

Open the web dashboard to see visualizations:

```
http://localhost:3003
```

## Analytics Levels

You can change the analytics detail level in `.env`:

### minimal (Default for Production)
```bash
ANALYTICS_LEVEL=minimal
```
- Tool name
- Success/error status
- Timestamp (rounded to hour)

### standard
```bash
ANALYTICS_LEVEL=standard
```
- Everything in minimal
- Response time
- Service used (NOAA/Open-Meteo)
- Cache hit status
- Retry count
- Country (broad region: US/CA/EU/AP/etc)

### detailed (Recommended for Development)
```bash
ANALYTICS_LEVEL=detailed
```
- Everything in standard
- Anonymized parameters (safe values only)
- Hashed session ID
- Sequence number for workflow tracking

## Privacy Guarantees

All analytics levels maintain strict privacy:

❌ **Never Collected:**
- Coordinates or location data
- User input or search queries
- IP addresses
- Personal identifiable information

✅ **Always Anonymized:**
- Session IDs are one-way hashed (SHA-256)
- Timestamps rounded to nearest hour
- Country detection intentionally vague
- Parameters filtered through allowlist

## Troubleshooting

### Events not appearing in database

The analytics-server currently only has the API component running. To store events in the database, a worker process needs to be implemented that:
1. Reads events from the Redis queue
2. Processes and aggregates them
3. Stores them in TimescaleDB

For now, you can verify events are being received by checking:
- Analytics server logs (should show "Events queued successfully")
- Redis queue length (`docker exec -i analytics-redis-dev redis-cli LLEN events_queue`)

### Analytics server returns 400 errors

Check the analytics server logs for validation errors. Common issues:
- Tool name not in allowed list (update `src/api/validation.ts`)
- Service type not in enum (add to `VALID_SERVICES`)
- Timestamp not rounded to hour
- Contains PII (coordinates, locations, etc)

### Analytics not being sent

1. Verify `ANALYTICS_ENABLED=true` in `.env`
2. Check `ANALYTICS_ENDPOINT` points to correct URL, and that it meets the
   [endpoint requirements](#endpoint-requirements) — look for an
   `Invalid ANALYTICS_ENDPOINT configuration` error at startup
3. Ensure analytics server is running on port 3100, behind your HTTPS proxy or tunnel
4. Look for analytics-related DEBUG logs

## Production vs Development

### Development (.env)
```bash
ANALYTICS_ENABLED=true
ANALYTICS_LEVEL=detailed
ANALYTICS_ENDPOINT=https://analytics.example.test/v1/events  # your HTTPS hostname
LOG_LEVEL=0
```

### Production (default without .env)
```bash
# These are the defaults if no .env file exists.
# Analytics is opt-in: nothing is sent unless ANALYTICS_ENABLED=true.
ANALYTICS_ENABLED=false
ANALYTICS_LEVEL=minimal
ANALYTICS_ENDPOINT=https://analytics.weather-mcp.com/v1/events
LOG_LEVEL=1
```

## Opting Out

Users can disable analytics by setting:

```bash
ANALYTICS_ENABLED=false
```

Or in their MCP client configuration (Claude Desktop, etc).

## Next Steps

1. ✅ Analytics integration complete
2. ✅ Events validated and queued successfully
3. 🔄 TODO: Implement worker process for database storage
4. 🔄 TODO: Add aggregation logic for dashboard
5. 🔄 TODO: Deploy production analytics server

---

**Last Updated:** 2025-11-12
**MCP Version:** 1.6.1
**Analytics Server Version:** 1.0.0
