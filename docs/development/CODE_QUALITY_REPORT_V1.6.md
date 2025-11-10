# Weather MCP Code Quality Report
Generated: 2025-11-10

## Scope & Approach
- Reviewed TypeScript sources under `src/` plus selected utilities and configuration.
- Read existing documentation and test suites to understand intended coverage.
- Static analysis only; no automated tests were executed in this session (networked APIs make the suite long-running and would require dedicated credentials).

## Key Findings

### 1. Mutating cached NOAA forecast data when deriving severe-weather stats (Severity: Medium)
- Evidence: `src/handlers/forecastHandler.ts:58-85` slices `series.values` in place to enforce a `maxEntries` limit.
- Impact: NOAA gridpoint responses are reused (and cached) across multiple formatting helpers. Reassigning `series.values` truncates the shared array so later consumers (snow/ice/normals sections, other callers using the same cached object) silently lose data. This explains intermittent "missing probability" outputs after a call that included severe-weather options.
- Recommendation: Treat the gridpoint values as immutable. Work on a local copy (`const limited = series.values.slice(0, maxEntries);`) and never reassign properties on NOAA SDK types coming out of the cache. Add a regression test that calls multiple formatters back-to-back to ensure data remains intact.

### 2. `get_river_conditions` downloads the entire national gauge catalog on every request (Severity: Medium)
- Evidence: `src/handlers/riverConditionsHandler.ts:41-69` always calls `noaaService.getAllNWPSGauges()`, which in turn issues `/gauges` (all gauges) as seen in `src/services/noaa.ts:692-710`.
- Impact: The NWPS `/gauges` payload is several megabytes and contains ~10k stations. Every tool invocation re-downloads everything and filters client-side, so a single user can generate minutes of work and significant bandwidth. Under load this becomes a self-inflicted DoS, and users on slow connections experience long delays regardless of a small search radius.
- Recommendation: Replace the full download with a filtered query (NWPS supports bounding boxes and station lookups). At minimum, seed the gauge list once on startup and reuse it, or add a dedicated cache for `getAllNWPSGauges` so repeated calls within the same process do not thrash the API. Pair this change with a test that asserts the handler calls a new `getGaugesWithinBoundingBox` helper rather than the bulk endpoint.

### 3. Blitzortung MQTT subscriptions only grow; topics are never pruned (Severity: High)
- Evidence: `src/services/blitzortung.ts:236-288` adds every requested geohash to `subscribedGeohashes`, but nothing ever removes items. `disconnect()` clears the set (lines 414-425) yet is never invoked (no references in the project).
- Impact: Each lightning query permanently subscribes to more topics. After a handful of users look at different regions, the service processes and buffers lightning from almost the entire planet. That increases CPU, memory, and network usage, and the handler will happily return stale strikes from distant areas, reducing accuracy.
- Recommendation: Track active subscriptions per request and unsubscribe (or reconnect with a minimized topic list) when the call completes. Another option is to cap the set size and evict LRU geohashes. Add instrumentation to verify the number of subscribed geohashes stays bounded under a randomized test scenario.

### 4. RainViewer tile conversion fails for polar coordinates (Severity: Low)
- Evidence: `src/services/rainviewer.ts:86-99` feeds raw latitude into `Math.tan()` / `Math.cos()` without clamping. `validateLatitude` allows ±90°, so callers at the poles cause division by zero and ultimately `NaN` tile coordinates that surface as broken image links.
- Impact: Requests for high-latitude stations produce unusable radar links, and because the URLs contain the literal string `NaN`, caches fill with unique-but-invalid keys.
- Recommendation: Clamp latitude to the Web Mercator safe range (±85.05112878°) before calculating tiles, or reject inputs outside that range with a descriptive error. Extend the imagery tests to cover extreme-latitude scenarios.

### 5. Timezone fallback returns the host server timezone for most of the planet (Severity: Medium)
- Evidence: `src/utils/timezone.ts:121-139` only knows about the continental US. All other coordinates fall through to `Intl.DateTimeFormat().resolvedOptions().timeZone`, i.e., the timezone of the machine running the MCP server.
- Impact: International users see their timestamps rendered in the server's timezone, not their own, which is misleading for alerts and marine forecasts (e.g., Sydney users receive "America/Chicago" timestamps when the server runs in Chicago). Because many handlers silently rely on `guessTimezoneFromCoords`, the issue is pervasive yet hard to spot.
- Recommendation: Integrate a proper coordinate-to-timezone dataset (e.g., `tz-lookup`) or call a lightweight timezone API once and cache the result. As an interim mitigation, default to UTC instead of the host timezone so at least the output is predictable. Add unit tests for representative global coordinates.

## Additional Observations & Suggestions
- Lightning logging (`src/services/blitzortung.ts:215-224`) emits every strike at INFO, which overwhelms stderr and the MCP transport. Consider downgrading to DEBUG and sampling.
- The new river and lightning features lack dedicated performance tests; only high-level integrations exist. Adding focused benchmarks would make regressions like the ones above easier to detect.
- No automated style or static-analysis step (eslint/ts-prune) currently runs in `npm test`. Introducing one would catch unused exports and dead code (e.g., `disconnect()`).

## Test & Verification Status
- Automated tests were **not** executed during this review. Once the above fixes are implemented, run `npm run test` and, if relevant APIs are mocked, add targeted unit tests for:
  1. Forecast severe-weather formatting (ensuring cached objects stay intact).
  2. River conditions handler (verifying bounded data fetches).
  3. Blitzortung subscription management (ensuring stale geohashes are dropped).
