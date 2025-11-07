/**
 * Integration test for get_air_quality tool
 * Tests air quality data retrieval with AQI, pollutants, and UV index
 */

import { OpenMeteoService } from '../src/services/openmeteo.js';
import { handleGetAirQuality } from '../src/handlers/airQualityHandler.js';

const openMeteoService = new OpenMeteoService();

async function testAirQuality() {
  console.log('=== Testing get_air_quality Tool ===\n');

  // Test 1: Current air quality for a US location (San Francisco)
  console.log('Test 1: Current air quality for San Francisco, CA (US location - should show US AQI)');
  try {
    const result = await handleGetAirQuality(
      { latitude: 37.7749, longitude: -122.4194, forecast: false },
      openMeteoService
    );
    console.log(result.content[0].text);
    console.log('\n✅ Test 1 passed\n');
  } catch (error) {
    console.error('❌ Test 1 failed:', error);
  }

  // Test 2: Current air quality for a European location (Paris)
  console.log('Test 2: Current air quality for Paris, France (European location - should show European AQI)');
  try {
    const result = await handleGetAirQuality(
      { latitude: 48.8566, longitude: 2.3522, forecast: false },
      openMeteoService
    );
    console.log(result.content[0].text);
    console.log('\n✅ Test 2 passed\n');
  } catch (error) {
    console.error('❌ Test 2 failed:', error);
  }

  // Test 3: Current air quality for an Asian location (Tokyo)
  console.log('Test 3: Current air quality for Tokyo, Japan');
  try {
    const result = await handleGetAirQuality(
      { latitude: 35.6762, longitude: 139.6503, forecast: false },
      openMeteoService
    );
    console.log(result.content[0].text);
    console.log('\n✅ Test 3 passed\n');
  } catch (error) {
    console.error('❌ Test 3 failed:', error);
  }

  // Test 4: Air quality with forecast for Los Angeles (known air quality issues)
  console.log('Test 4: Air quality with forecast for Los Angeles, CA');
  try {
    const result = await handleGetAirQuality(
      { latitude: 34.0522, longitude: -118.2437, forecast: true },
      openMeteoService
    );
    console.log(result.content[0].text);
    console.log('\n✅ Test 4 passed\n');
  } catch (error) {
    console.error('❌ Test 4 failed:', error);
  }

  // Test 5: Air quality for Beijing (often poor air quality)
  console.log('Test 5: Current air quality for Beijing, China');
  try {
    const result = await handleGetAirQuality(
      { latitude: 39.9042, longitude: 116.4074, forecast: false },
      openMeteoService
    );
    console.log(result.content[0].text);
    console.log('\n✅ Test 5 passed\n');
  } catch (error) {
    console.error('❌ Test 5 failed:', error);
  }

  // Test 6: Air quality for a location in Alaska (US territory)
  console.log('Test 6: Current air quality for Anchorage, Alaska (should use US AQI)');
  try {
    const result = await handleGetAirQuality(
      { latitude: 61.2181, longitude: -149.9003, forecast: false },
      openMeteoService
    );
    console.log(result.content[0].text);
    console.log('\n✅ Test 6 passed\n');
  } catch (error) {
    console.error('❌ Test 6 failed:', error);
  }

  // Test 7: Air quality for Sydney, Australia
  console.log('Test 7: Current air quality for Sydney, Australia');
  try {
    const result = await handleGetAirQuality(
      { latitude: -33.8688, longitude: 151.2093, forecast: false },
      openMeteoService
    );
    console.log(result.content[0].text);
    console.log('\n✅ Test 7 passed\n');
  } catch (error) {
    console.error('❌ Test 7 failed:', error);
  }

  // Test 8: Air quality with forecast for London
  console.log('Test 8: Air quality with forecast for London, UK');
  try {
    const result = await handleGetAirQuality(
      { latitude: 51.5074, longitude: -0.1278, forecast: true },
      openMeteoService
    );
    console.log(result.content[0].text);
    console.log('\n✅ Test 8 passed\n');
  } catch (error) {
    console.error('❌ Test 8 failed:', error);
  }

  // Test 9: Invalid coordinates (should fail)
  console.log('Test 9: Invalid coordinates (expect error)');
  try {
    await handleGetAirQuality(
      { latitude: 91, longitude: 0, forecast: false },
      openMeteoService
    );
    console.error('❌ Test 9 failed: Should have thrown error');
  } catch (error) {
    console.log(`✅ Test 9 passed: Error caught as expected - ${(error as Error).message}\n`);
  }

  // Test 10: Missing required parameter (should fail)
  console.log('Test 10: Missing latitude (expect error)');
  try {
    await handleGetAirQuality(
      { longitude: 0, forecast: false } as any,
      openMeteoService
    );
    console.error('❌ Test 10 failed: Should have thrown error');
  } catch (error) {
    console.log(`✅ Test 10 passed: Error caught as expected - ${(error as Error).message}\n`);
  }

  console.log('=== All tests completed ===');
}

// Run the tests
testAirQuality().catch(error => {
  console.error('Fatal error running tests:', error);
  process.exit(1);
});
