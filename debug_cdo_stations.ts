#!/usr/bin/env -S npx tsx

/**
 * Debug script to investigate CDO station lookup
 */

import 'dotenv/config';
import { CDOService } from './src/services/cdo.js';

async function debugStationLookup() {
  console.log('🔍 Debugging CDO Station Lookup\n');

  const cdoToken = process.env.NOAA_CDO_TOKEN;
  if (!cdoToken) {
    console.log('❌ No CDO token found');
    return;
  }

  console.log('✅ CDO token found:', cdoToken.substring(0, 10) + '...\n');

  const cdoService = new CDOService({ token: cdoToken });

  // Test location: New York
  const lat = 40.7128;
  const lon = -74.0060;
  const startDate = '2024-01-15';
  const endDate = '2024-01-17';

  console.log(`Testing location: New York (${lat}, ${lon})`);
  console.log(`Date range: ${startDate} to ${endDate}\n`);

  // Test direct API call to see what's available
  console.log('=== Test 1: List any stations ===');
  try {
    const response = await fetch('https://www.ncei.noaa.gov/cdo-web/api/v2/stations?datasetid=GHCND&limit=5', {
      headers: {
        'token': cdoToken,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      console.log(`❌ API returned status: ${response.status}`);
      const text = await response.text();
      console.log('Response:', text.substring(0, 200));
    } else {
      const data = await response.json();
      console.log(`✅ Found ${data.metadata?.resultset?.count || 0} total stations`);
      if (data.results && data.results.length > 0) {
        console.log('Sample stations:');
        for (let i = 0; i < Math.min(3, data.results.length); i++) {
          console.log(`  ${i + 1}. ${data.results[i].id} - ${data.results[i].name}`);
        }
      }
    }
  } catch (error) {
    console.log('❌ Error:', error instanceof Error ? error.message : error);
  }

  // Test with FIPS code
  console.log('\n=== Test 2: Search by FIPS code (New York = FIPS:36) ===');
  try {
    const response = await fetch('https://www.ncei.noaa.gov/cdo-web/api/v2/stations?locationid=FIPS:36&datasetid=GHCND&limit=10', {
      headers: {
        'token': cdoToken,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      console.log(`❌ API returned status: ${response.status}`);
      const text = await response.text();
      console.log('Response:', text.substring(0, 200));
    } else {
      const data = await response.json();
      console.log(`✅ Found ${data.results?.length || 0} stations in New York state`);
      if (data.results && data.results.length > 0) {
        console.log('Sample stations:');
        for (let i = 0; i < Math.min(5, data.results.length); i++) {
          const s = data.results[i];
          console.log(`  ${i + 1}. ${s.name} (${s.id})`);
          if (s.latitude && s.longitude) {
            const dist = calculateDistance(lat, lon, s.latitude, s.longitude);
            console.log(`     Location: (${s.latitude}, ${s.longitude}) - ${dist.toFixed(1)}km away`);
          }
        }
      }
    }
  } catch (error) {
    console.log('❌ Error:', error instanceof Error ? error.message : error);
  }

  // Test using our service method
  console.log('\n=== Test 3: Using CDOService.findStationsByLocation() ===');
  try {
    const stations = await cdoService.findStationsByLocation(lat, lon, startDate, endDate, 10);
    console.log(`Found ${stations.results?.length || 0} stations`);

    if (stations.results && stations.results.length > 0) {
      console.log('Stations found:');
      for (let i = 0; i < Math.min(5, stations.results.length); i++) {
        const s = stations.results[i];
        const dist = calculateDistance(lat, lon, s.latitude, s.longitude);
        console.log(`  ${i + 1}. ${s.name} - ${dist.toFixed(1)}km away`);
      }
    } else {
      console.log('❌ No stations found by our method');
    }
  } catch (error) {
    console.log('❌ Error:', error instanceof Error ? error.message : error);
  }

  // Test getting actual data
  console.log('\n=== Test 4: Try to get data from a station ===');
  try {
    const data = await cdoService.getHistoricalData(lat, lon, startDate, endDate, 100);
    console.log(`✅ Successfully retrieved ${data.results?.length || 0} data points`);

    if (data.results && data.results.length > 0) {
      console.log('Sample data:');
      for (let i = 0; i < Math.min(3, data.results.length); i++) {
        const d = data.results[i];
        console.log(`  ${d.date}: ${d.datatype} = ${d.value}`);
      }
    }
  } catch (error) {
    console.log('❌ Error:', error instanceof Error ? error.message : error);
  }
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

debugStationLookup().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
