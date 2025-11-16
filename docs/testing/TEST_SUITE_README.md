# Weather MCP Server - Test Suite Documentation

Quick reference guide for the Weather MCP test suite.

---

## Quick Stats

| Metric | Value |
|--------|-------|
| **Total Tests** | 1,070 |
| **Pass Rate** | 99.6% - 99.9% |
| **Unit Tests** | 1,008 (27 files) |
| **Integration Tests** | 62 (4 files) |
| **Execution Time (Unit)** | ~2 seconds |
| **Execution Time (Full)** | ~4-5 minutes |

---

## Running Tests

```bash
# Run all tests (unit + integration)
npm test

# Run only unit tests (fast - ~2 seconds)
npm test tests/unit/

# Run only integration tests (~4 minutes)
npm test tests/integration/

# Watch mode for development
npm run test:watch

# Generate coverage report
npm run test:coverage

# Run specific test file
npm test tests/unit/cache.test.ts

# Interactive UI mode
npm run test:ui
```

---

## Test Organization

```
tests/
├── unit/                    27 test files (1,008 tests)
│   ├── Core Utilities       cache, validation, units, errors
│   ├── Weather Domain       airQuality, fireWeather, snow, marine
│   ├── Geospatial          distance, geohash, geography, timezone
│   ├── Security            security, security-v1.6
│   ├── Configuration       config, tool-config
│   ├── Handlers            imagery-handler, lightning-handler
│   ├── Services            ncei, rainviewer, retry-logic
│   └── Version-specific    v1.6.1-fixes, bounds-checking, alert-sorting
│
├── integration/             4 test files (62 tests)
│   ├── error-recovery.test.ts
│   ├── great-lakes-marine.test.ts
│   ├── visualization-lightning.test.ts
│   └── safety-hazards.test.ts
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

### Flaky Integration Tests

**Affected Tests:** `tests/integration/safety-hazards.test.ts`
- 1-4 tests may fail due to NOAA API timeouts
- Root cause: External NOAA NWPS API slow/unavailable
- Not a code issue - external service reliability

**Workaround:**
```bash
# If integration tests fail, run unit tests only
npm test tests/unit/
```

**Status:** Tracked in issue #XX, fix planned for v1.7.1

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

### On Every Commit
- Unit tests run (~2 seconds)
- Fast feedback on code changes

### On Pull Request
- Full test suite runs (~4-5 minutes)
- Integration tests verify API compatibility

### On Release
- Full test suite with coverage report
- Performance benchmarks
- Security audit

---

## Troubleshooting

### Tests Timing Out?
```bash
# Increase timeout for slow networks
API_TIMEOUT_MS=60000 npm test
```

### Integration Tests Failing?
1. Check NOAA service status: https://weather.gov
2. Retry tests (may be transient)
3. Run unit tests only: `npm test tests/unit/`

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
- ✅ 1,070 total tests
- ✅ 99.6% pass rate
- ✅ <2s unit test execution
- ⚠️ ~4-5min full suite execution

### Coverage Goals
- ✅ Utilities: 100% (achieved)
- ⚠️ Handlers: 80% (currently 25%)
- ⚠️ Services: 80% (currently 50%)
- ❌ Analytics: 80% (currently 0%)

### Quality Targets
- 100% pass rate on unit tests
- 99%+ pass rate on integration tests
- <1% flaky test rate
- 80%+ overall code coverage

---

## Documentation

### Detailed Reports
- **Full Analysis:** `/home/dgahagan/work/personal/weather-mcp/weather-mcp/TEST_COVERAGE_ANALYSIS_2025.md`
- **Recommendations:** `/home/dgahagan/work/personal/weather-mcp/weather-mcp/TEST_RECOMMENDATIONS.md`
- **V1.0 Report:** `/home/dgahagan/work/personal/weather-mcp/weather-mcp/TEST_COVERAGE_REPORT_V1.0.md`

### Code Documentation
- **Development Guide:** `/home/dgahagan/work/personal/weather-mcp/weather-mcp/CLAUDE.md`
- **Contributing:** `/home/dgahagan/work/personal/weather-mcp/weather-mcp/CONTRIBUTING.md`
- **Security:** `/home/dgahagan/work/personal/weather-mcp/weather-mcp/SECURITY.md`

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
- [Full Analysis Report](TEST_COVERAGE_ANALYSIS_2025.md)
- [Recommendations & Action Plan](TEST_RECOMMENDATIONS.md)
- [Development Guide](CLAUDE.md)
