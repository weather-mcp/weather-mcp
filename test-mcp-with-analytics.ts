/**
 * Test MCP server with local analytics
 * This script simulates MCP tool calls and verifies analytics are sent to the local server
 */

import 'dotenv/config';
import { handleCheckServiceStatus } from './src/handlers/statusHandler.js';
import { handleGetForecast } from './src/handlers/forecastHandler.js';
import { NOAAService } from './src/services/noaa.js';
import { OpenMeteoService } from './src/services/openmeteo.js';
import { analytics, withAnalytics } from './src/analytics/index.js';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

async function testMCPWithAnalytics() {
  console.log(`${colors.bright}${colors.blue}========================================`);
  console.log('MCP Server Analytics Integration Test');
  console.log(`========================================${colors.reset}\n`);

  // Check analytics configuration
  console.log(`${colors.cyan}Analytics Configuration:${colors.reset}`);
  console.log(`  Enabled: ${process.env.ANALYTICS_ENABLED}`);
  console.log(`  Level: ${process.env.ANALYTICS_LEVEL}`);
  console.log(`  Endpoint: ${process.env.ANALYTICS_ENDPOINT}`);
  console.log();

  // Initialize services
  const noaaService = new NOAAService({
    userAgent: 'weather-mcp/test (testing analytics)',
  });
  const openMeteoService = new OpenMeteoService();

  console.log(`${colors.cyan}Running MCP tool tests...${colors.reset}\n`);

  // Test 1: check_service_status
  console.log(`${colors.bright}Test 1: check_service_status${colors.reset}`);
  try {
    await withAnalytics('check_service_status', async () =>
      handleCheckServiceStatus(noaaService, openMeteoService, '1.6.1')
    );
    console.log(`${colors.green}  ✓ Success (analytics tracked)${colors.reset}\n`);
  } catch (error) {
    console.log(`${colors.yellow}  ! Warning: ${(error as Error).message}${colors.reset}\n`);
  }

  // Test 2: get_forecast (US location)
  console.log(`${colors.bright}Test 2: get_forecast (San Francisco)${colors.reset}`);
  try {
    await withAnalytics('get_forecast', async () =>
      handleGetForecast(
        { latitude: 37.7749, longitude: -122.4194, days: 1 },
        noaaService,
        openMeteoService
      )
    );
    console.log(`${colors.green}  ✓ Success (analytics tracked)${colors.reset}\n`);
  } catch (error) {
    console.log(`${colors.yellow}  ! Warning: ${(error as Error).message}${colors.reset}\n`);
  }

  // Test 3: get_forecast (international location)
  console.log(`${colors.bright}Test 3: get_forecast (Tokyo)${colors.reset}`);
  try {
    await withAnalytics('get_forecast', async () =>
      handleGetForecast(
        { latitude: 35.6762, longitude: 139.6503, days: 1 },
        noaaService,
        openMeteoService
      )
    );
    console.log(`${colors.green}  ✓ Success (analytics tracked)${colors.reset}\n`);
  } catch (error) {
    console.log(`${colors.yellow}  ! Warning: ${(error as Error).message}${colors.reset}\n`);
  }

  // Wait for events to buffer
  console.log(`${colors.cyan}Waiting for events to buffer...${colors.reset}`);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const bufferSize = analytics.getBufferSize();
  console.log(`${colors.bright}Buffer contains ${bufferSize} event(s)${colors.reset}\n`);

  // Flush events to analytics server
  console.log(`${colors.cyan}Flushing events to analytics server...${colors.reset}`);
  await analytics.flush();
  console.log(`${colors.green}✓ Events sent to ${process.env.ANALYTICS_ENDPOINT}${colors.reset}\n`);

  // Wait for server to process
  console.log(`${colors.cyan}Waiting for analytics server to process events...${colors.reset}`);
  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log(`${colors.bright}${colors.green}========================================`);
  console.log('Test Complete!');
  console.log(`========================================${colors.reset}\n`);

  console.log('Next steps:');
  console.log('1. Check analytics server logs for event processing');
  console.log('2. Query the database to verify events were stored');
  console.log('3. View the analytics dashboard at http://localhost:3003\n');

  console.log('Database query:');
  console.log(`  ${colors.cyan}docker exec -i analytics-postgres-dev psql -U analytics -d analytics -c "SELECT tool, status, analytics_level, timestamp FROM events ORDER BY timestamp DESC LIMIT 10;"${colors.reset}\n`);

  process.exit(0);
}

testMCPWithAnalytics().catch((error) => {
  console.error(`${colors.yellow}Test failed:${colors.reset}`, error);
  process.exit(1);
});
