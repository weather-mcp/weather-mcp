/**
 * Integration test for fire weather enhancements to get_current_conditions
 * Tests fire weather indices from NOAA gridpoint data
 */

import { NOAAService } from '../src/services/noaa.js';
import { handleGetCurrentConditions } from '../src/handlers/currentConditionsHandler.js';

const noaaService = new NOAAService({
  userAgent: 'weather-mcp/0.5.0 (test suite)'
});

async function testFireWeather() {
  console.log('=== Testing Fire Weather Enhancements ===\n');

  // Test 1: Current conditions WITHOUT fire weather (Los Angeles)
  console.log('Test 1: Current conditions WITHOUT fire weather (Los Angeles)');
  try {
    const result = await handleGetCurrentConditions(
      { latitude: 34.0522, longitude: -118.2437, include_fire_weather: false },
      noaaService
    );
    console.log(result.content[0].text);

    // Check that fire weather is NOT included
    if (!result.content[0].text.includes('Fire Weather')) {
      console.log('\n✅ Test 1 passed: Fire weather not included when parameter is false\n');
    } else {
      console.error('❌ Test 1 failed: Fire weather should not be included\n');
    }
  } catch (error) {
    console.error('❌ Test 1 failed:', error);
  }

  // Test 2: Current conditions WITH fire weather (Los Angeles - prone to fire weather)
  console.log('Test 2: Current conditions WITH fire weather (Los Angeles)');
  try {
    const result = await handleGetCurrentConditions(
      { latitude: 34.0522, longitude: -118.2437, include_fire_weather: true },
      noaaService
    );
    console.log(result.content[0].text);

    // Check that fire weather IS included
    if (result.content[0].text.includes('Fire Weather')) {
      console.log('\n✅ Test 2 passed: Fire weather included when requested\n');
    } else {
      console.error('❌ Test 2 failed: Fire weather should be included\n');
    }
  } catch (error) {
    console.error('❌ Test 2 failed:', error);
  }

  // Test 3: Fire weather for Denver, CO (different region)
  console.log('Test 3: Fire weather for Denver, CO');
  try {
    const result = await handleGetCurrentConditions(
      { latitude: 39.7392, longitude: -104.9903, include_fire_weather: true },
      noaaService
    );
    console.log(result.content[0].text);
    console.log('\n✅ Test 3 passed\n');
  } catch (error) {
    console.error('❌ Test 3 failed:', error);
  }

  // Test 4: Fire weather for Phoenix, AZ (high fire risk area)
  console.log('Test 4: Fire weather for Phoenix, AZ');
  try {
    const result = await handleGetCurrentConditions(
      { latitude: 33.4484, longitude: -112.0740, include_fire_weather: true },
      noaaService
    );
    console.log(result.content[0].text);
    console.log('\n✅ Test 4 passed\n');
  } catch (error) {
    console.error('❌ Test 4 failed:', error);
  }

  // Test 5: Test backward compatibility (no parameter should default to false)
  console.log('Test 5: Backward compatibility - no include_fire_weather parameter');
  try {
    const result = await handleGetCurrentConditions(
      { latitude: 37.7749, longitude: -122.4194 },
      noaaService
    );

    // Should work and NOT include fire weather by default
    if (!result.content[0].text.includes('Fire Weather')) {
      console.log('✅ Test 5 passed: Backward compatible, fire weather not included by default\n');
    } else {
      console.error('❌ Test 5 failed: Fire weather should not be included by default\n');
    }
  } catch (error) {
    console.error('❌ Test 5 failed:', error);
  }

  // Test 6: Invalid parameter should fail gracefully
  console.log('Test 6: Invalid parameter type (expect graceful handling)');
  try {
    const result = await handleGetCurrentConditions(
      { latitude: 37.7749, longitude: -122.4194, include_fire_weather: 'invalid' as any },
      noaaService
    );
    console.error('❌ Test 6 failed: Should have thrown error for invalid parameter');
  } catch (error) {
    console.log(`✅ Test 6 passed: Error caught as expected - ${(error as Error).message}\n`);
  }

  console.log('=== All fire weather tests completed ===');
}

// Run the tests
testFireWeather().catch(error => {
  console.error('Fatal error running tests:', error);
  process.exit(1);
});
