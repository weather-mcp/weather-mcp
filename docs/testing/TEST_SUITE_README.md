# Weather MCP Server - Test Suite Documentation

Quick reference guide for the Weather MCP test suite.

---

## Quick Stats

| Metric | Value |
|--------|-------|
| **Total Tests** | 5,224 |
| **Execution Time (`npm test`, offline)** | ~20 seconds |
| **Execution Time (live, `npm run test:live`)** | several minutes, network-bound |

The total counts every declared test, live ones included. It is collected without
running anything: `scripts/lib/collect-test-count.sh`.

---

## Running Tests

```bash
# The offline gate: unit + integration. CI and publish run this exact command.
npm test

# Only unit tests. They refuse every outbound connection (EUNITNET).
npx vitest run --project unit

# The live-network tests in tests/live/: real upstreams, run by hand, once per release.
# Serial, retry 1, 120 s timeout. Never run by npm test, CI or publish.
npm run test:live

# Watch mode for development (unit + integration)
npm run test:watch

# Generate coverage report (unit + integration)
npm run test:coverage

# Run specific test file
npx vitest run tests/unit/cache.test.ts

# Count the declared tests without running any
scripts/lib/collect-test-count.sh
```

| Project | Directory | Guard | Network |
|---|---|---|---|
| `unit` | `tests/unit/` | `tests/setup/no-network.ts` | none (`EUNITNET`) |
| `integration` | `tests/integration/` | `tests/setup/loopback-only.ts` | loopback only (`ENONLOOPBACK` otherwise) |
| `live` | `tests/live/` | none | real upstreams |

The `integration` guard is in-process. A child process a test spawns is not covered.

---

## Test Organization

```
tests/
├── unit/
│   ├── Core Utilities       cache, validation, units, errors
│   ├── Weather Domain       airQuality, fireWeather, snow, marine
│   ├── Geospatial          distance, geohash, geography, timezone
│   ├── Security            security, security-v1.6
│   ├── Configuration       config, tool-config
│   ├── Handlers            imagery-handler, lightning-handler
│   ├── Services            ncei, rainviewer, retry-logic
│   └── Version-specific    v1.6.1-fixes, bounds-checking, alert-sorting
│
├── integration/             offline, loopback only
│   ├── error-recovery.test.ts
│   ├── http-app.test.ts, http-entry.test.ts, http-deadline-proxy.test.ts
│   ├── stdio-shutdown.test.ts
│   └── lightning-fixture-broker.test.ts   (in-process aedes MQTT broker)
│
├── live/                    real upstreams; npm run test:live only
│   ├── great-lakes-marine.test.ts
│   ├── safety-hazards.test.ts
│   ├── imagery.test.ts
│   └── lightning-broker-smoke.test.ts
│
└── helpers/                 (Future: shared utilities)
```

---

## Test Coverage by Module

| Module | Coverage | Status | Notes |
|--------|----------|--------|-------|
| **Utils** | 100% | ✅ | All 15 utility files fully tested |
| **Errors** | 100% | ✅ | Complete error handling coverage |
| **Config** | 100% | ✅ | All configuration tested |
| **Handlers** | 25% | ⚠️ | Only 3/12 have direct unit tests |
| **Services** | 50% | ⚠️ | Only 3/6 have direct unit tests |
| **Analytics** | 0% | ❌ | New in v1.7.0, needs tests |

---

## Known Issues

### Flaky Live Tests

The files in `tests/live/` call real upstreams, so they can fail for reasons outside
this code: a slow or refusing API, or a broker that blocks your IP. `npm test` does not
run them, so they cannot fail the gate, CI or a publish. A human reads the result of
`npm run test:live` at release time.

Three live files classify their errors (GOTCHAS G9): `lightning-broker-smoke`,
`japan-alerts` and `national-cap-alerts` skip only on a transport failure and rethrow
anything else, so a red result there is worth reading before re-running. The other live
files still have tolerant catches that log any error, assertion failures included, as a
network skip. A green result from one of them does not prove the upstream answered the
expected shape. Read its log output.

---

## Critical Test Files

These tests verify the most important functionality:

### Core Utilities (100% must pass)
- ✅ `tests/unit/cache.test.ts` - LRU cache with TTL
- ✅ `tests/unit/validation.test.ts` - Input validation
- ✅ `tests/unit/units.test.ts` - Unit conversions
- ✅ `tests/unit/errors.test.ts` - Error handling

### Security (100% must pass)
- ✅ `tests/unit/security.test.ts` - Input sanitization, bounds checking
- ✅ `tests/unit/security-v1.6.test.ts` - Privacy, injection prevention

### Weather Domain
- ✅ `tests/unit/airQuality.test.ts` - AQI calculations
- ✅ `tests/unit/fireWeather.test.ts` - Fire danger indices
- ✅ `tests/unit/snow.test.ts` - Snow analysis

---

## CI/CD Integration

### On Every Push and Pull Request (CI)
- `npm test`: the offline unit + integration gate (~20 seconds)
- No live test runs in CI

### On Release
- `scripts/update-docs-for-release.sh` runs `npm test` once and refuses a red suite
- `npm run test:live` runs once, by hand; a human triages any failure
- `publish.yml` runs the same offline `npm test` before publishing
- Security audit

---

## Troubleshooting

### Live Tests Timing Out?
```bash
# Increase the per-request timeout for slow networks
API_TIMEOUT_MS=60000 npm run test:live
```

### Live Tests Failing?
1. Check the upstream's status (for NOAA: https://weather.gov)
2. Read the failure: a transport skip logs and passes; anything red is a real result to triage
3. `npm test` is offline, so a red `npm test` is never a network problem

### Integration Test Fails With `ENONLOOPBACK`?
The test tried to reach a non-loopback host. Move it to `tests/live/`, or point it at a
local server.

### Coverage Report Not Generating?
```bash
# Clean and rebuild
rm -rf coverage/
npm run test:coverage
```

### Tests Hanging?
- Press `Ctrl+C` to stop
- May be waiting for async operation
- Check for missing `await` keywords

---

## Writing New Tests

### Test Template

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Feature Name', () => {
  beforeEach(() => {
    // Setup before each test
  });

  afterEach(() => {
    // Cleanup after each test
  });

  describe('Specific Functionality', () => {
    it('should do something when condition met', () => {
      // Arrange
      const input = 'test';

      // Act
      const result = myFunction(input);

      // Assert
      expect(result).toBe('expected');
    });

    it('should handle edge case', () => {
      // Test edge cases, null, undefined, boundaries
    });

    it('should throw on invalid input', () => {
      expect(() => myFunction(null)).toThrow();
    });
  });
});
```

### Best Practices

1. **Test Independence**
   - Each test should run independently
   - No shared state between tests
   - Use `beforeEach` for setup

2. **Descriptive Names**
   - Use `should X when Y` format
   - Be specific and clear
   - Good: `should return 0 when array is empty`
   - Bad: `test array`

3. **AAA Pattern**
   - **Arrange:** Set up test data
   - **Act:** Execute the function
   - **Assert:** Verify the result

4. **Edge Cases**
   - Test null, undefined, empty values
   - Test boundary conditions (0, -1, max)
   - Test error conditions

5. **Mock External Dependencies**
   - Unit tests should not make API calls
   - Use `vi.fn()` to mock functions
   - Use `nock` to mock HTTP requests

---

## Test Metrics & Goals

### Current Performance
- ✅ 5,224 total tests
- ✅ ~20s offline gate (`npm test`)

### Coverage Goals
- ✅ Utilities: 100% (achieved)
- ⚠️ Handlers: 80% (currently 25%)
- ⚠️ Services: 80% (currently 50%)
- ❌ Analytics: 80% (currently 0%)

### Quality Targets
- 100% pass rate on unit and integration tests (both offline)
- <1% flaky test rate
- 80%+ overall code coverage

---

## Documentation

### Detailed Reports
- **Full Analysis:** `.devdocs/reports/TEST_COVERAGE_ANALYSIS_2025.md` (internal)
- **Recommendations:** `.devdocs/reports/TEST_RECOMMENDATIONS.md` (internal)
- **V1.0 Report:** `.devdocs/reports/TEST_COVERAGE_REPORT_V1.0.md` (internal)

### Code Documentation
- **Development Guide:** `CLAUDE.md`
- **Contributing:** `CONTRIBUTING.md`
- **Security:** `SECURITY.md`

---

## Getting Help

### Internal Resources
- Review existing tests in `tests/unit/` for examples
- Check test helpers (when available)
- Read test documentation files

### External Resources
- Vitest Documentation: https://vitest.dev/
- Testing Best Practices: https://testingjavascript.com/

### Reporting Issues
- Flaky tests: Create issue with "flaky-test" label
- Test failures: Include error message and test file
- Coverage gaps: Create issue with "test-coverage" label

---

## Recent Changes

### v1.7.0 (Current)
- Added analytics module (needs tests)
- Enhanced MQTT functionality
- Improved privacy features

### v1.6.1
- Added security tests for coordinate privacy
- Added tests for Markdown injection prevention
- Fixed caching mutation tests
- Performance improvements to river conditions

### v1.0.0
- Added 65 new tests
- Created security test suite (24 tests)
- Created bounds-checking tests (20 tests)
- Created alert-sorting tests (11 tests)
- Expanded config tests (10 new tests)

---

**Last Updated:** November 13, 2025
**Test Framework:** Vitest v4.0.8
**Node Version:** v18.0.0+

**Quick Links:**
- Full analysis report — `.devdocs/reports/TEST_COVERAGE_ANALYSIS_2025.md` (internal)
- Recommendations & action plan — `.devdocs/reports/TEST_RECOMMENDATIONS.md` (internal)
- [Development Guide](../../CLAUDE.md)
