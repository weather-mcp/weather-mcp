#!/usr/bin/env tsx

/**
 * Test script to verify NOAA API connectivity and basic functionality
 * Run with: npx tsx test_noaa_api.ts
 */

import { NOAAService } from './src/services/noaa.js';

// Test coordinates (San Francisco, CA)
const TEST_LAT = 37.7749;
const TEST_LON = -122.4194;

async function testNOAAAPI() {
  console.log('🧪 Testing NOAA API Connectivity\n');

  const noaa = new NOAAService({
    userAgent: '(weather-mcp-test, testing@example.com)'
  });

  try {
    // Test 1: Get point data
    console.log('Test 1: Getting point data for San Francisco...');
    const pointData = await noaa.getPointData(TEST_LAT, TEST_LON);
    console.log('✅ Success!');
    console.log(`   Office: ${pointData.properties.gridId}`);
    console.log(`   Grid: ${pointData.properties.gridX}, ${pointData.properties.gridY}`);
    console.log(`   Location: ${pointData.properties.relativeLocation.properties.city}, ${pointData.properties.relativeLocation.properties.state}\n`);

    // Test 2: Get forecast
    console.log('Test 2: Getting forecast...');
    const forecast = await noaa.getForecastByCoordinates(TEST_LAT, TEST_LON);
    console.log('✅ Success!');
    console.log(`   Periods: ${forecast.properties.periods.length}`);
    console.log(`   First period: ${forecast.properties.periods[0].name}`);
    console.log(`   Temperature: ${forecast.properties.periods[0].temperature}°${forecast.properties.periods[0].temperatureUnit}`);
    console.log(`   Forecast: ${forecast.properties.periods[0].shortForecast}\n`);

    // Test 3: Get nearest stations
    console.log('Test 3: Getting nearest weather stations...');
    const stations = await noaa.getStations(TEST_LAT, TEST_LON);
    console.log('✅ Success!');
    console.log(`   Found ${stations.features.length} stations`);
    if (stations.features.length > 0) {
      console.log(`   Nearest: ${stations.features[0].properties.stationIdentifier} - ${stations.features[0].properties.name}\n`);
    }

    // Test 4: Get current conditions
    console.log('Test 4: Getting current conditions...');
    const observation = await noaa.getCurrentConditions(TEST_LAT, TEST_LON);
    console.log('✅ Success!');
    console.log(`   Station: ${observation.properties.station}`);
    console.log(`   Time: ${new Date(observation.properties.timestamp).toLocaleString()}`);
    if (observation.properties.temperature.value !== null) {
      const tempC = observation.properties.temperature.value;
      const tempF = (tempC * 9/5) + 32;
      console.log(`   Temperature: ${Math.round(tempF)}°F (${Math.round(tempC)}°C)`);
    }
    if (observation.properties.textDescription) {
      console.log(`   Conditions: ${observation.properties.textDescription}`);
    }
    console.log();

    // Test 5: Get historical observations (last 24 hours)
    console.log('Test 5: Getting historical observations (last 24 hours)...');
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
    const history = await noaa.getHistoricalObservations(
      TEST_LAT,
      TEST_LON,
      startTime,
      endTime,
      10 // Limit to 10 observations for testing
    );
    console.log('✅ Success!');
    console.log(`   Observations: ${history.features.length}`);
    if (history.features.length > 0) {
      const oldest = history.features[history.features.length - 1];
      const newest = history.features[0];
      console.log(`   Oldest: ${new Date(oldest.properties.timestamp).toLocaleString()}`);
      console.log(`   Newest: ${new Date(newest.properties.timestamp).toLocaleString()}`);
    }
    console.log();

    console.log('🎉 All tests passed! NOAA API is working correctly.\n');
    return true;
  } catch (error) {
    console.error('❌ Test failed:');
    console.error(error instanceof Error ? error.message : error);
    console.error('\nFull error:', error);
    return false;
  }
}

// Run tests
testNOAAAPI().then(success => {
  process.exit(success ? 0 : 1);
});
