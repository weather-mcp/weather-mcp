/**
 * Test script to explore NOAA gridpoint data structure
 */

import { NOAAService } from '../src/services/noaa.js';

async function main() {
  console.log('Exploring NOAA Gridpoint Data Structure...\n');

  const service = new NOAAService({
    userAgent: 'weather-mcp-test/0.6.0 (test@example.com)'
  });

  // Test location: Denver, CO (known for severe weather)
  const latitude = 39.7392;
  const longitude = -104.9903;

  try {
    console.log(`Fetching gridpoint data for ${latitude}, ${longitude}...\n`);
    const gridpointData = await service.getGridpointDataByCoordinates(latitude, longitude);

    console.log('Available properties in gridpoint response:');
    console.log(Object.keys(gridpointData.properties).filter(key => !key.startsWith('@')).sort());
    console.log('\n');

    // Look for severe weather related fields
    const severeWeatherFields = Object.keys(gridpointData.properties).filter(key =>
      key.toLowerCase().includes('thunder') ||
      key.toLowerCase().includes('lightning') ||
      key.toLowerCase().includes('gust') ||
      key.toLowerCase().includes('tropical') ||
      key.toLowerCase().includes('tornado') ||
      key.toLowerCase().includes('hail') ||
      key.toLowerCase().includes('probability')
    );

    console.log('Potential severe weather fields found:');
    console.log(severeWeatherFields);
    console.log('\n');

    // Show a few sample values
    for (const field of severeWeatherFields.slice(0, 5)) {
      const data = (gridpointData.properties as any)[field];
      if (data && data.values) {
        console.log(`\n${field}:`);
        console.log('  Sample values:', data.values.slice(0, 3).map((v: any) => ({
          validTime: v.validTime,
          value: v.value
        })));
      }
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

main();
