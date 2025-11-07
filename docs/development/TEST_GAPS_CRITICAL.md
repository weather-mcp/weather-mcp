# CRITICAL Test Gaps - Weather MCP v1.2.0

**Status:** ⚠️ BLOCKING ISSUES FOR RELEASE
**Date:** 2025-11-07

---

## Overview

Weather MCP Server v1.2.0 has **4 critical test gaps** that should be addressed before release. These involve untested or poorly tested code that handles safety-critical features (fire weather, air quality) and new services (NCEI).

---

## Critical Gaps Summary

| Component | Current Coverage | Required | Priority | Est. Effort |
|-----------|-----------------|----------|----------|-------------|
| services/ncei.ts | 0% | 80%+ | P1 - CRITICAL | 6-8 hours |
| utils/fireWeather.ts | 0% | 100% | P1 - CRITICAL | 4-6 hours |
| utils/airQuality.ts | 0% | 100% | P1 - CRITICAL | 6-8 hours |
| services/noaa.ts | 32.67% | 70%+ | P2 - HIGH | 12-16 hours |
| services/openmeteo.ts | 38.88% | 70%+ | P2 - HIGH | 14-18 hours |

**Total Critical Work:** 16-24 hours (P1 items)
**Total High Priority:** 26-34 hours (P2 items)

---

## P1 - CRITICAL (Must Fix Before Release)

### 1. services/ncei.ts - NO TESTS (0% coverage)

**File:** `/home/dgahagan/work/personal/weather-mcp/src/services/ncei.ts`

**Problem:**
- Climate normals service added in v1.1.0-v1.2.0
- Zero test coverage
- User-facing feature could fail silently
- API integration untested

**Required Tests:**
```typescript
// tests/unit/ncei.test.ts - CREATE THIS FILE

describe('NCEI Service - Climate Normals', () => {
  describe('getClimateNormals', () => {
    it('should fetch climate normals for valid US station');
    it('should handle station not found (404 error)');
    it('should handle API timeout gracefully');
    it('should parse response data correctly');
    it('should cache normals data with appropriate TTL');
    it('should validate station ID format');
    it('should handle malformed JSON response');
    it('should retry on 5xx errors');
  });

  describe('findNearestStation', () => {
    it('should find nearest station within search radius');
    it('should handle no stations found within radius');
    it('should handle invalid coordinates');
    it('should sort stations by distance');
    it('should limit results to max count');
  });

  describe('Error Handling', () => {
    it('should throw DataNotFoundError when no data available');
    it('should throw ServiceUnavailableError on network failure');
    it('should include helpful error messages for users');
  });
});
```

**Estimated Tests:** 20 tests
**Estimated Lines:** ~200 lines
**Time:** 6-8 hours

---

### 2. utils/fireWeather.ts - NO TESTS (0% coverage)

**File:** `/home/dgahagan/work/personal/weather-mcp/src/utils/fireWeather.ts`

**Problem:**
- **Safety-critical** fire danger categorization
- Used in currentConditionsHandler for fire weather display
- Incorrect categories could endanger users
- No validation of thresholds

**Required Tests:**
```typescript
// tests/unit/fireWeather.test.ts - CREATE THIS FILE

describe('Fire Weather Utilities', () => {
  describe('getHainesCategory', () => {
    it('should categorize Haines 2-3 as Low (green)');
    it('should categorize Haines 4 as Moderate (yellow)');
    it('should categorize Haines 5 as High (orange)');
    it('should categorize Haines 6 as Very High (red)');
    it('should provide correct fire growth potential text');
    it('should handle edge case values (1, 7)');
  });

  describe('getGrasslandFireDangerCategory', () => {
    it('should categorize 1 as Low');
    it('should categorize 2 as Moderate');
    it('should categorize 3 as High');
    it('should categorize 4+ as Very High');
    it('should provide correct descriptions');
  });

  describe('getRedFlagCategory', () => {
    it('should categorize <30 as Low threat');
    it('should categorize 30-59 as Moderate');
    it('should categorize 60-79 as High');
    it('should categorize 80+ as Very High');
    it('should handle boundary values (29, 30, 59, 60)');
  });

  describe('formatMixingHeight', () => {
    it('should categorize <1000ft as very poor dispersion');
    it('should categorize 1000-3000ft as poor');
    it('should categorize 3000-6000ft as moderate');
    it('should categorize >6000ft as good');
    it('should handle null values gracefully');
    it('should format numbers with proper rounding');
  });

  describe('interpretTransportWind', () => {
    it('should categorize <5mph as light (poor transport)');
    it('should categorize 5-15mph as moderate');
    it('should categorize 15-25mph as good transport');
    it('should categorize >25mph as rapid spread potential');
    it('should handle null values');
  });

  describe('getCurrentFireWeatherValue', () => {
    it('should extract first value from gridpoint series');
    it('should return null for empty series');
    it('should return null for undefined series');
    it('should handle series with null values');
  });
});
```

**Estimated Tests:** 35 tests
**Estimated Lines:** ~300 lines
**Time:** 4-6 hours

**Why Critical:** Fire weather categorization affects user safety decisions during wildfire season.

---

### 3. utils/airQuality.ts - NO TESTS (0% coverage)

**File:** `/home/dgahagan/work/personal/weather-mcp/src/utils/airQuality.ts`

**Problem:**
- **Health-critical** air quality categorization
- Wrong AQI levels could mislead users about health risks
- Complex US vs European AQI logic untested
- Geographic boundary detection untested

**Required Tests:**
```typescript
// tests/unit/airQuality.test.ts - CREATE THIS FILE

describe('Air Quality Utilities', () => {
  describe('getUSAQICategory', () => {
    it('should categorize 0-50 as Good (green)');
    it('should categorize 51-100 as Moderate (yellow)');
    it('should categorize 101-150 as Unhealthy for Sensitive (orange)');
    it('should categorize 151-200 as Unhealthy (red)');
    it('should categorize 201-300 as Very Unhealthy (purple)');
    it('should categorize 301+ as Hazardous (maroon)');
    it('should provide correct health implications');
    it('should provide correct cautionary statements');
    it('should handle boundary values (50, 51, 100, 101, etc.)');
  });

  describe('getEuropeanAQICategory', () => {
    it('should categorize 0-20 as Good (blue)');
    it('should categorize 21-40 as Fair (green)');
    it('should categorize 41-60 as Moderate (yellow)');
    it('should categorize 61-80 as Poor (orange)');
    it('should categorize 81-100 as Very Poor (red)');
    it('should categorize 101+ as Extremely Poor (purple)');
    it('should provide European-specific health advice');
  });

  describe('getUVIndexCategory', () => {
    it('should categorize 0-2 as Low (no protection)');
    it('should categorize 3-5 as Moderate (protection recommended)');
    it('should categorize 6-7 as High (protection essential)');
    it('should categorize 8-10 as Very High (extra protection)');
    it('should categorize 11+ as Extreme (maximum protection)');
    it('should provide sun protection recommendations');
  });

  describe('getPollutantInfo', () => {
    it('should return correct info for PM2.5');
    it('should return correct info for PM10');
    it('should return correct info for ozone');
    it('should return correct info for NO2');
    it('should return correct info for SO2');
    it('should return correct info for CO');
    it('should return correct info for ammonia');
    it('should handle unknown pollutants gracefully');
  });

  describe('formatPollutantConcentration', () => {
    it('should format <1 values with 2 decimals (0.25)');
    it('should format 1-10 values with 1 decimal (5.3)');
    it('should format >10 values as integers (42)');
    it('should handle null values as "N/A"');
    it('should handle undefined values as "N/A"');
    it('should include units when provided');
  });

  describe('shouldUseUSAQI', () => {
    it('should return true for continental US coordinates');
    it('should return true for Alaska coordinates');
    it('should return true for Hawaii coordinates');
    it('should return true for Puerto Rico');
    it('should return true for US Virgin Islands');
    it('should return true for Guam');
    it('should return false for London, UK');
    it('should return false for Paris, France');
    it('should return false for Tokyo, Japan');
    it('should test boundary conditions (lat/lon edges)');
  });
});
```

**Estimated Tests:** 40 tests
**Estimated Lines:** ~350 lines
**Time:** 6-8 hours

**Why Critical:** Air quality affects health decisions, especially for sensitive populations (children, elderly, respiratory conditions).

---

### 4. Fix TimeoutOverflowWarning

**Problem:**
```
(node:36520) TimeoutOverflowWarning: 9007199254740991 does not fit into a 32-bit signed integer.
Timeout duration was set to 1.
```

**Cause:** Cache TTL of `Infinity` for certain cache entries causes Node.js `setTimeout` overflow.

**Location:** `/home/dgahagan/work/personal/weather-mcp/src/utils/cache.ts`

**Fix:**
```typescript
// In cache.ts set() method
if (ttl === Infinity) {
  // Don't set a timeout for infinite TTL
  // Item never expires, no cleanup needed
  return;
} else {
  this.expiry.set(key, Date.now() + ttl);
  // Set cleanup timeout (existing code)
}
```

**Time:** 1 hour

**Why Critical:** Generates test output noise and indicates improper handling of infinite TTL.

---

## P2 - HIGH Priority (Should Fix for v1.2.0)

### 5. services/noaa.ts - Low Coverage (32.67%)

**Uncovered Lines:** 79-87, 102-109, 134-166, 226-328, 378-468, 474, 479-588

**Missing Coverage:**
- Grid coordinate resolution
- Station lookup and caching
- Forecast parsing (7-day format)
- Alert filtering and sorting
- Current conditions data extraction
- Gridpoint data series parsing

**Required:** 45 tests to reach 70% coverage
**Time:** 12-16 hours

---

### 6. services/openmeteo.ts - Low Coverage (38.88%)

**Uncovered Lines:** 91-93, 114-141, 179-189, 230-256, 308-322, 339-345, 373-431, 501-534, 613-625, 673-710, 774-853, 915-1018, 1052-1115, 1122-1228

**Missing Coverage:**
- Location search edge cases
- Forecast data parsing (hourly/daily)
- Air quality data retrieval
- Marine forecast parsing
- Weather code translation (80+ codes)
- Response validation

**Required:** 55 tests to reach 70% coverage
**Time:** 14-18 hours

---

## Testing Strategy

### Phase 1: Critical Fixes (Week 1)
1. **Day 1-2:** Create ncei.test.ts (20 tests)
2. **Day 2-3:** Create fireWeather.test.ts (35 tests)
3. **Day 3-4:** Create airQuality.test.ts (40 tests)
4. **Day 4:** Fix TimeoutOverflowWarning
5. **Day 5:** Test execution, coverage validation

**Deliverable:** 95+ new tests, 3 critical gaps closed

### Phase 2: High Priority (Week 2)
1. **Day 6-8:** Create noaa-service.test.ts (45 tests)
2. **Day 9-11:** Create openmeteo-service.test.ts (55 tests)
3. **Day 12:** Integration testing, coverage validation

**Deliverable:** 100+ new tests, service coverage >70%

---

## Success Criteria

### For v1.2.0 Release (Phase 1)
- ✅ NCEI service coverage: 0% → 80%+
- ✅ Fire weather utilities: 0% → 100%
- ✅ Air quality utilities: 0% → 100%
- ✅ No TimeoutOverflowWarning in test output
- ✅ All tests passing (100%)
- ✅ Overall coverage: 65% → 72%+

### Post-v1.2.0 (Phase 2)
- ✅ NOAA service coverage: 33% → 70%+
- ✅ Open-Meteo service: 39% → 70%+
- ✅ Overall coverage: 72% → 80%+

---

## Risk Assessment

### If Critical Gaps Not Fixed

**NCEI Service (0% coverage):**
- Risk: Climate normals feature fails silently
- Impact: Users get incorrect or missing normal data
- Severity: MEDIUM (feature failure, not safety issue)

**Fire Weather (0% coverage):**
- Risk: Wrong fire danger categorization
- Impact: Users make unsafe decisions during wildfire season
- Severity: HIGH (safety-critical)

**Air Quality (0% coverage):**
- Risk: Wrong AQI levels displayed
- Impact: Sensitive populations exposed to unhealthy air
- Severity: HIGH (health-critical)

**Services (30-40% coverage):**
- Risk: API integration bugs in production
- Impact: Data quality issues, service failures
- Severity: MEDIUM-HIGH (core functionality)

---

## Recommendations

### Immediate Actions (Before v1.2.0 Release)
1. ✅ Create 3 critical test files (95 tests, ~850 lines)
2. ✅ Fix TimeoutOverflowWarning
3. ✅ Run coverage report and validate >72%
4. ✅ Update TEST_COVERAGE_REPORT.md

### Post-Release Actions
1. Create service layer tests (100 tests)
2. Add handler unit tests (8 files, 80-100 tests)
3. Expand integration test suite
4. Set up coverage CI/CD gates

### Process Improvements
1. Add pre-commit hook: require tests for new features
2. Set coverage threshold in CI: minimum 70% for new code
3. Require test review in PR process
4. Document test requirements in CONTRIBUTING.md

---

**Assessment Date:** 2025-11-07
**Next Review:** After Phase 1 completion
**Owner:** Test Automation Engineer

---

## Quick Reference: Files to Create

```bash
# Critical (Phase 1)
tests/unit/ncei.test.ts              # 20 tests, 200 lines
tests/unit/fireWeather.test.ts       # 35 tests, 300 lines
tests/unit/airQuality.test.ts        # 40 tests, 350 lines

# High Priority (Phase 2)
tests/unit/noaa-service.test.ts      # 45 tests, 400 lines
tests/unit/openmeteo-service.test.ts # 55 tests, 500 lines
tests/unit/logger.test.ts            # 18 tests, 150 lines
tests/unit/marine.test.ts            # 30 tests, 250 lines
```

**Total New Tests:** 243 tests
**Total New Code:** ~2,150 lines
**Total Effort:** 42-58 hours (1.5-2 weeks)
