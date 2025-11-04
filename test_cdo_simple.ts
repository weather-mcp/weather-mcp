#!/usr/bin/env -S npx tsx

/**
 * Simple CDO API test using axios directly
 */

import 'dotenv/config';
import axios from 'axios';

async function testCDOAPI() {
  const token = process.env.NOAA_CDO_TOKEN;

  if (!token) {
    console.log('❌ No token found');
    return;
  }

  console.log('Testing CDO API with axios...\n');

  try {
    // Test 1: Simple stations query
    console.log('Test 1: Fetching stations list...');
    const response = await axios.get('https://www.ncei.noaa.gov/cdo-web/api/v2/stations', {
      headers: {
        'token': token,
        'Accept': 'application/json'
      },
      params: {
        datasetid: 'GHCND',
        limit: 5
      },
      timeout: 10000
    });

    console.log(`✅ Status: ${response.status}`);
    console.log(`✅ Found ${response.data.results?.length || 0} stations`);

    if (response.data.results && response.data.results.length > 0) {
      console.log('\nSample stations:');
      response.data.results.slice(0, 3).forEach((station: any, i: number) => {
        console.log(`  ${i + 1}. ${station.id}: ${station.name}`);
      });
    }

    // Test 2: Search by FIPS (New York State)
    console.log('\n\nTest 2: Searching New York stations by FIPS...');
    const nyResponse = await axios.get('https://www.ncei.noaa.gov/cdo-web/api/v2/stations', {
      headers: {
        'token': token,
        'Accept': 'application/json'
      },
      params: {
        locationid: 'FIPS:36',
        datasetid: 'GHCND',
        limit: 10
      },
      timeout: 10000
    });

    console.log(`✅ Status: ${nyResponse.status}`);
    console.log(`✅ Found ${nyResponse.data.results?.length || 0} NY stations`);

    if (nyResponse.data.results && nyResponse.data.results.length > 0) {
      console.log('\nNew York stations:');
      nyResponse.data.results.slice(0, 5).forEach((station: any, i: number) => {
        console.log(`  ${i + 1}. ${station.name} (${station.id})`);
        if (station.latitude && station.longitude) {
          console.log(`     Location: ${station.latitude}, ${station.longitude}`);
        }
      });
    }

    console.log('\n✅ CDO API is working correctly!');

  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.log('❌ Axios error:', error.message);
      if (error.response) {
        console.log('   Status:', error.response.status);
        console.log('   Data:', error.response.data);
      }
    } else {
      console.log('❌ Error:', error);
    }
  }
}

testCDOAPI();
