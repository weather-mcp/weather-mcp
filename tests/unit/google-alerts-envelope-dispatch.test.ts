/**
 * A wrong-shaped 200 from the Google Weather alerts feed never renders the all-clear, through the
 * real MCP dispatch (google-alerts-envelope, T3).
 *
 * The factory's own GoogleWeatherService is stubbed at the prototype (G70): the private
 * `requestPublicAlerts` RESOLVES a body that is not the alerts envelope, so the guard, the handler
 * and the dispatch all run. The spy call counts and the positive control prove the stub reaches
 * the handler.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Pinned before the static imports below evaluate (GOTCHAS G61, G26). The key is read at import by
// src/config/api.ts, so it is pinned here and never taken from the repo's .env. The cache is off
// because `clearServiceCaches()` does not clear the Google cache (G158).
vi.hoisted(() => {
  process.env.CACHE_ENABLED = 'false';
  process.env.ENABLED_TOOLS = 'all';
  process.env.ANALYTICS_ENABLED = 'false';
  process.env.ANALYTICS_SALT = 'google-alerts-envelope-dispatch-test';
  process.env.WEATHER_DEFAULT_LOCATION = '';
  process.env.GOOGLE_WEATHER_API_KEY = 'dispatch-test-key-hyg';
});

import { createWeatherServer, clearServiceCaches } from '../../src/server/weatherServer.js';
import { LocationStore } from '../../src/services/locationStore.js';
import { GoogleWeatherService } from '../../src/services/googleWeather.js';
import { NominatimService } from '../../src/services/nominatim.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const SYDNEY = { latitude: -33.87, longitude: 151.21 };
const FIXED_MSG = 'Google Weather API returned an unexpected response.';
const ALL_CLEAR = 'No active weather alerts found for this location via the Google Weather API';

describe('Google alerts wrong-shaped 200 through the MCP dispatch', () => {
  let tempDir: string;
  let client: Client;

  beforeEach(async () => {
    clearServiceCaches();
    tempDir = mkdtempSync(join(tmpdir(), 'weather-mcp-google-envelope-'));

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createWeatherServer({
      locationStore: new LocationStore(join(tempDir, 'locations.json'))
    });
    await server.connect(serverTransport);
    client = new Client({ name: 'google-alerts-envelope-dispatch-test', version: '0.0.0' });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    vi.restoreAllMocks();
    clearServiceCaches();
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function call(name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as Array<{ type: string; text: string }>;
    return { result, text: content[0].text };
  }

  function alertsSection(text: string): string {
    const start = text.indexOf('## alerts (unavailable)');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = text.indexOf('---', start);
    return end === -1 ? text.slice(start) : text.slice(start, end);
  }

  function stubGoogle(answer: { covered: boolean; body?: unknown }) {
    vi.spyOn(NominatimService.prototype, 'reverseCountry').mockResolvedValue('au');
    return vi
      .spyOn(GoogleWeatherService.prototype as any, 'requestPublicAlerts')
      .mockResolvedValue(answer);
  }

  it.each([
    ['an HTML body', '<html>Maintenance</html>'],
    ['an object without weatherAlerts', { regionCode: 'AU' }],
    ['a weatherAlerts array holding null', { weatherAlerts: [null] }]
  ])('get_alerts, Sydney: %s is an error result, not the all-clear', async (_label, body) => {
    const spy = stubGoogle({ covered: true, body });

    const { result, text } = await call('get_alerts', SYDNEY);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(text).toBe(`Error: ${FIXED_MSG}`);
    expect(text).not.toContain(ALL_CLEAR);
  });

  it('get_weather_summary, Sydney: the alerts section is unavailable with the fixed message', async () => {
    const spy = stubGoogle({ covered: true, body: '<html>Maintenance</html>' });

    const { result, text } = await call('get_weather_summary', { ...SYDNEY, include: ['alerts'] });

    expect(spy).toHaveBeenCalledTimes(1);
    const section = alertsSection(text);
    expect(section).toContain(FIXED_MSG);
    expect(section).not.toContain(ALL_CLEAR);
    expect(result.isError).not.toBe(true);
  });

  it('positive control: an empty envelope renders the honest all-clear', async () => {
    const spy = stubGoogle({
      covered: true,
      body: { weatherAlerts: [], regionCode: 'AU', nextPageToken: '' }
    });

    const { result, text } = await call('get_alerts', SYDNEY);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(text).toContain(`✅ **${ALL_CLEAR}.**`);
    expect(result).not.toHaveProperty('isError');
  });

  it('positive control: an uncovered location renders no coverage and no all-clear', async () => {
    const spy = stubGoogle({ covered: false });

    const { text } = await call('get_alerts', SYDNEY);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(text).toContain('No alert coverage for this location');
    expect(text).not.toContain('✅');
  });
});
