/**
 * Integration tests for marine conditions functionality
 */

import { OpenMeteoService } from '../src/services/openmeteo.js';
import { handleGetMarineConditions } from '../src/handlers/marineConditionsHandler.js';

async function main() {
  console.log('Testing Marine Conditions...\n');

  const service = new OpenMeteoService();

  // Test 1: Current marine conditions (San Francisco Bay - Pacific Coast)
  console.log('Test 1: Current marine conditions (San Francisco, CA)');
  try {
    const result = await handleGetMarineConditions(
      {
        latitude: 37.7749,
        longitude: -122.4194,
        forecast: false
      },
      service
    );
    console.log('✅ SUCCESS - Current marine conditions');
    console.log(result.content[0].text.substring(0, 500) + '...\n');
  } catch (error) {
    console.error('❌ FAILED - Current marine conditions');
    console.error(error);
    console.error('');
  }

  // Test 2: Marine forecast (Hawaii - Open Ocean)
  console.log('Test 2: Marine forecast with 5-day outlook (Honolulu, HI)');
  try {
    const result = await handleGetMarineConditions(
      {
        latitude: 21.3099,
        longitude: -157.8581,
        forecast: true
      },
      service
    );
    console.log('✅ SUCCESS - Marine forecast');
    console.log(result.content[0].text.substring(0, 500) + '...\n');
  } catch (error) {
    console.error('❌ FAILED - Marine forecast');
    console.error(error);
    console.error('');
  }

  // Test 3: Atlantic Ocean conditions (Miami, FL)
  console.log('Test 3: Marine conditions (Miami, FL - Atlantic)');
  try {
    const result = await handleGetMarineConditions(
      {
        latitude: 25.7617,
        longitude: -80.1918,
        forecast: false
      },
      service
    );
    console.log('✅ SUCCESS - Atlantic marine conditions');
    console.log(result.content[0].text.substring(0, 500) + '...\n');
  } catch (error) {
    console.error('❌ FAILED - Atlantic marine conditions');
    console.error(error);
    console.error('');
  }

  // Test 4: European waters (Lisbon, Portugal)
  console.log('Test 4: Marine conditions (Lisbon, Portugal - European Atlantic)');
  try {
    const result = await handleGetMarineConditions(
      {
        latitude: 38.7223,
        longitude: -9.1393,
        forecast: true
      },
      service
    );
    console.log('✅ SUCCESS - European marine conditions with forecast');
    console.log(result.content[0].text.substring(0, 500) + '...\n');
  } catch (error) {
    console.error('❌ FAILED - European marine conditions');
    console.error(error);
    console.error('');
  }

  // Test 5: Southern Ocean (Sydney, Australia)
  console.log('Test 5: Marine conditions (Sydney, Australia - Pacific)');
  try {
    const result = await handleGetMarineConditions(
      {
        latitude: -33.8688,
        longitude: 151.2093,
        forecast: false
      },
      service
    );
    console.log('✅ SUCCESS - Southern hemisphere marine conditions');
    console.log(result.content[0].text.substring(0, 500) + '...\n');
  } catch (error) {
    console.error('❌ FAILED - Southern hemisphere marine conditions');
    console.error(error);
    console.error('');
  }

  // Test 6: Error handling - invalid coordinates
  console.log('Test 6: Error handling - invalid latitude');
  try {
    await handleGetMarineConditions(
      {
        latitude: 95, // Invalid
        longitude: -122.4194,
        forecast: false
      },
      service
    );
    console.error('❌ FAILED - Should have thrown error for invalid latitude\n');
  } catch (error) {
    console.log('✅ SUCCESS - Correctly rejected invalid coordinates');
    console.log(`Error: ${(error as Error).message}\n`);
  }

  // Test 7: Missing required parameters
  console.log('Test 7: Error handling - missing coordinates');
  try {
    await handleGetMarineConditions(
      {},
      service
    );
    console.error('❌ FAILED - Should have thrown error for missing coordinates\n');
  } catch (error) {
    console.log('✅ SUCCESS - Correctly rejected missing coordinates');
    console.log(`Error: ${(error as Error).message}\n`);
  }

  console.log('\n=== All Marine Conditions Tests Complete ===\n');
}

// Run tests
main().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
