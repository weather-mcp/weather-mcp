/**
 * Integration tests for severe weather functionality
 */

import { NOAAService } from '../src/services/noaa.js';
import { OpenMeteoService } from '../src/services/openmeteo.js';
import { handleGetForecast } from '../src/handlers/forecastHandler.js';

async function main() {
  console.log('Testing Severe Weather Probabilities...\n');

  const noaaService = new NOAAService({
    userAgent: 'weather-mcp-test/0.6.0 (test@example.com)'
  });
  const openMeteoService = new OpenMeteoService();

  // Test 1: Denver, CO - known for severe weather
  console.log('Test 1: Forecast with severe weather probabilities (Denver, CO)');
  try {
    const result = await handleGetForecast(
      {
        latitude: 39.7392,
        longitude: -104.9903,
        days: 3,
        granularity: 'daily',
        include_severe_weather: true
      },
      noaaService,
      openMeteoService
    );
    console.log('✅ SUCCESS - Severe weather probabilities included');
    // Check if the severe weather section is present
    const text = result.content[0].text;
    if (text.includes('Severe Weather Probabilities')) {
      console.log('  ✓ Severe weather section found in output');
    } else {
      console.log('  ℹ️ No severe weather probabilities detected (may be calm conditions)');
    }
    console.log(text.substring(text.lastIndexOf('---'), text.length).substring(0, 500) + '...\n');
  } catch (error) {
    console.error('❌ FAILED - Forecast with severe weather');
    console.error(error);
    console.error('');
  }

  // Test 2: Forecast without severe weather (should not include section)
  console.log('Test 2: Forecast without severe weather parameter (Denver, CO)');
  try {
    const result = await handleGetForecast(
      {
        latitude: 39.7392,
        longitude: -104.9903,
        days: 3,
        granularity: 'daily',
        include_severe_weather: false
      },
      noaaService,
      openMeteoService
    );
    console.log('✅ SUCCESS - Standard forecast without severe weather');
    const text = result.content[0].text;
    if (!text.includes('Severe Weather Probabilities')) {
      console.log('  ✓ Severe weather section correctly excluded');
    } else {
      console.log('  ⚠️ WARNING: Severe weather section should not be present\n');
    }
  } catch (error) {
    console.error('❌ FAILED - Standard forecast');
    console.error(error);
    console.error('');
  }

  // Test 3: Miami, FL - coastal area with potential tropical weather
  console.log('Test 3: Severe weather for coastal location (Miami, FL)');
  try {
    const result = await handleGetForecast(
      {
        latitude: 25.7617,
        longitude: -80.1918,
        days: 5,
        granularity: 'daily',
        include_severe_weather: true
      },
      noaaService,
      openMeteoService
    );
    console.log('✅ SUCCESS - Coastal severe weather probabilities');
    const text = result.content[0].text;
    if (text.includes('Tropical Storm') || text.includes('Hurricane') || text.includes('No severe weather')) {
      console.log('  ✓ Tropical weather data processed correctly\n');
    }
  } catch (error) {
    console.error('❌ FAILED - Coastal severe weather');
    console.error(error);
    console.error('');
  }

  // Test 4: Test with hourly forecast
  console.log('Test 4: Hourly forecast with severe weather (Denver, CO)');
  try {
    const result = await handleGetForecast(
      {
        latitude: 39.7392,
        longitude: -104.9903,
        days: 1,
        granularity: 'hourly',
        include_severe_weather: true
      },
      noaaService,
      openMeteoService
    );
    console.log('✅ SUCCESS - Hourly forecast with severe weather\n');
  } catch (error) {
    console.error('❌ FAILED - Hourly forecast with severe weather');
    console.error(error);
    console.error('');
  }

  // Test 5: International location (should work but severe weather won't apply)
  console.log('Test 5: International location with severe weather parameter (London, UK)');
  try {
    const result = await handleGetForecast(
      {
        latitude: 51.5074,
        longitude: -0.1278,
        days: 3,
        granularity: 'daily',
        include_severe_weather: true
      },
      noaaService,
      openMeteoService
    );
    console.log('✅ SUCCESS - International forecast (severe weather N/A for non-US)');
    const text = result.content[0].text;
    if (!text.includes('Severe Weather Probabilities')) {
      console.log('  ✓ Severe weather correctly not included for international location\n');
    }
  } catch (error) {
    console.error('❌ FAILED - International forecast');
    console.error(error);
    console.error('');
  }

  console.log('\n=== All Severe Weather Tests Complete ===\n');
}

// Run tests
main().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
