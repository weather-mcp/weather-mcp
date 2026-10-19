# Caching Strategy

This document explains the caching implementation in the Weather MCP server.

## Overview

The Weather MCP server implements an in-memory cache with TTL (Time To Live) and LRU (Least Recently Used) eviction to:
- Reduce API calls to NOAA and Open-Meteo services
- Improve response times for repeated queries
- Protect against rate limits during heavy usage
- Lower infrastructure load on free weather APIs

## Cache Architecture

### Implementation Details

- **Type**: In-memory cache (data stored in Node.js process memory)
- **Eviction Policy**: LRU (Least Recently Used)
- **Maximum Size**: Configurable (default: 1000 entries)
- **TTL Strategy**: Variable based on data type and volatility

### Cache Utility (`src/utils/cache.ts`)

The cache implementation provides:
- Generic type-safe storage for any data type
- Per-entry TTL configuration
- Automatic expiration of stale data
- LRU eviction when max size is reached
- Statistics tracking (hits, misses, evictions)

## TTL Configuration

Different data types have different cache durations based on how frequently they change:

| Data Type | TTL | Rationale |
|-----------|-----|-----------|
| **Grid Coordinates** | Infinite | Geographic mappings are static and never change |
| **Station Lists** | 24 hours | Weather stations rarely change locations |
| **7-Day Forecasts** | 2 hours | NOAA updates forecasts approximately hourly |
| **Current Conditions** | 15 minutes | Observations typically update every 20-60 minutes |
| **Recent Historical Data** (< 7 days) | 1 hour | Recent data may still be updated or corrected |
| **Historical Data** (> 1 day old) | Infinite | Finalized historical data never changes |

### Smart TTL for Historical Data

The cache automatically determines the appropriate TTL for historical weather data:

```typescript
// src/config/cache.ts
export function getHistoricalDataTTL(startDate: string | Date): number {
  const start = typeof startDate === 'string' ? new Date(startDate) : startDate;
  const now = new Date();
  const daysDiff = (now.getTime() - start.getTime()) / DAY;

  if (daysDiff > 1) {
    return Infinity; // Historical data is finalized
  } else {
    return 1 * HOUR; // Recent data may still be updated
  }
}
```

## Configuration

### Environment Variables

Control caching behavior via environment variables:

```bash
# Enable/disable caching (default: enabled)
CACHE_ENABLED=true

# Maximum cache size in entries (default: 1000)
CACHE_MAX_SIZE=1000
```

### Disabling the Cache

To disable caching entirely:

```bash
export CACHE_ENABLED=false
```

Or in your `.env` file:

```
CACHE_ENABLED=false
```

## Cache Statistics

Monitor cache performance using the `check_service_status` tool, which provides:

- **Overall Hit Rate**: Percentage of requests served from cache
- **Total Cache Hits**: Number of successful cache retrievals
- **Total Cache Misses**: Number of cache misses requiring API calls
- **Cache Size**: Current number of entries vs maximum
- **Evictions**: Number of entries removed due to size limits

Example output:

```
## Cache Statistics

**Cache Status:** ✅ Enabled
**Overall Hit Rate:** 67.5%
**Total Cache Hits:** 135
**Total Cache Misses:** 65
**Total Requests:** 200

### NOAA Service Cache
- Entries: 42 / 1000
- Hit Rate: 70.2%
- Hits: 87
- Misses: 37
- Evictions: 0

### Open-Meteo Service Cache
- Entries: 28 / 1000
- Hit Rate: 63.2%
- Hits: 48
- Misses: 28
- Evictions: 0
```

## Performance Impact

### Expected Benefits

For typical AI conversation patterns:

**Without Cache:**
- Each query = fresh API call
- 10 queries about same location = 10 API calls
- Average latency: 200-1000ms per query

**With Cache:**
- First query = API call (cache miss)
- Subsequent queries = cache hit
- 10 queries about same location = 1 API call + 9 cache hits
- Cache hit latency: <10ms
- **90% reduction in API calls for this scenario**

### Real-World Example

AI conversation: "What's the weather in NYC? How about tomorrow? What about the weekend? How does that compare to last week?"

- **Without cache**: 4 separate API calls
- **With cache**: 1-2 API calls (rest from cache)
- **API call reduction**: 50-75%

## Cache Invalidation

### Automatic Expiration

Entries are automatically removed when:
1. TTL expires (checked on access)
2. Cache reaches max size (LRU eviction)
3. Periodic cleanup (performed during stats retrieval)

### Manual Cache Clearing

Currently, there is no user-facing tool to clear the cache. The cache is automatically cleared when the server restarts.

For development/debugging, you can modify the services to expose cache clearing:

```typescript
noaaService.clearCache();
openMeteoService.clearCache();
```

## Future Enhancements

### Persistent Cache (Future Consideration)

For larger-scale deployments with multiple server instances, consider implementing a persistent cache layer:

**Options:**
- **Redis**: Distributed in-memory cache
- **Memcached**: High-performance distributed memory caching
- **PostgreSQL**: Persistent database caching

**Benefits:**
- Cache survives server restarts
- Shared cache across multiple instances
- Configurable persistence

**Trade-offs:**
- Additional infrastructure dependency
- Slightly higher latency than in-memory
- More complex deployment

**When to Consider:**
- Running multiple MCP server instances
- High-availability requirements
- Very high query volumes (>10,000 requests/day)
- Need for cache persistence across restarts

This enhancement should be implemented based on user feedback and real-world usage patterns.

## Technical Details

### Cache Key Generation

Cache keys are generated from request parameters to ensure uniqueness:

```typescript
// Example cache key generation
const cacheKey = Cache.generateKey('forecast', office, gridX, gridY);
// Result: ["forecast","MKX",42,67]
```

### Memory Usage

Approximate memory per cache entry:
- Forecast data: ~5-10 KB
- Current conditions: ~2-3 KB
- Historical data: ~1-5 KB per hour

With 1000 max entries:
- Estimated memory usage: 2-10 MB
- Negligible impact on Node.js heap

### Thread Safety

The cache is not explicitly thread-safe, but Node.js's single-threaded event loop makes race conditions unlikely. Requests arrive sequentially over stdio, and concurrently over the HTTP entry (`weather-mcp-http`), which shares one cache across every request; the caches already tolerate concurrent readers and writers on one event loop.

## Monitoring and Debugging

### Checking Cache Effectiveness

Use the `check_service_status` tool periodically to monitor:

1. **Hit Rate**: Should increase over time as cache warms up
   - Low hit rate (<30%): Cache may be too small or TTLs too short
   - High hit rate (>70%): Cache is working effectively

2. **Evictions**: Should be minimal
   - High evictions: Consider increasing `CACHE_MAX_SIZE`
   - Zero evictions: Cache size is appropriate

3. **Cache Size**: Should grow then stabilize
   - Constantly at max: May need larger cache
   - Always small: Workload doesn't benefit much from caching

### Optimal Settings

For typical AI usage:
- **Max Size**: 500-1000 entries (default: 1000)
- **Hit Rate Target**: 60-80% after warm-up
- **Evictions**: Near zero

## Troubleshooting

### Cache Not Working

If cache statistics show zero hits:

1. Verify cache is enabled: `check_service_status` should show "Cache Status: ✅ Enabled"
2. Check environment: `CACHE_ENABLED` should not be set to `false`
3. Ensure queries are repeated: Cache only helps with repeated requests

### High Miss Rate

If hit rate is low despite repeated queries:

1. Check TTL configuration: Data may be expiring too quickly
2. Verify query parameters: Even slight differences create new cache keys
3. Monitor cache size: May be hitting max size and evicting entries

### Memory Concerns

If worried about memory usage:

1. Reduce `CACHE_MAX_SIZE` in environment variables
2. Monitor Node.js heap usage: `node --max-old-space-size=512`
3. Consider disabling cache for low-memory environments

## Best Practices

1. **Enable caching in production**: Default settings work well for most use cases
2. **Monitor cache statistics**: Use `check_service_status` periodically
3. **Adjust based on usage**: Increase max size if evictions are frequent
4. **Keep TTLs as configured**: Default values are optimized for data volatility
5. **Plan for persistence**: Consider Redis if scaling beyond single instance

## Questions or Feedback

If you have questions about caching or suggestions for improvements:
- Open an issue: https://github.com/weather-mcp/issues
- Discuss: Include cache statistics from `check_service_status` for context
