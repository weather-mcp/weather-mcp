/**
 * A wrong-shaped 200 from an alert feed never renders the all-clear, through the real MCP dispatch
 * (alert-feed-body-shape, T5).
 *
 * The factory's own service instances are stubbed at the prototype (G70): the private `makeRequest`
 * RESOLVES a body that is not the feed envelope, so the guard, the handler and the dispatch all run.
 * The spy call counts and the positive control prove the stub reaches the handler.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Pinned before the static imports below evaluate (GOTCHAS G61, G26). The cache is off because
// `clearServiceCaches()` clears only NOAA and Open-Meteo: with it on, a `[]` cached by one test (or by
// a mutant) is served to the next, and the rows depend on their order.
vi.hoisted(() => {
  process.env.CACHE_ENABLED = 'false';
  process.env.ENABLED_TOOLS = 'all';
  process.env.ANALYTICS_ENABLED = 'false';
  process.env.ANALYTICS_SALT = 'alert-feed-body-shape-dispatch-test';
  process.env.WEATHER_DEFAULT_LOCATION = '';
});

import { createWeatherServer, clearServiceCaches } from '../../src/server/weatherServer.js';
import { LocationStore } from '../../src/services/locationStore.js';
import { MeteoAlarmService } from '../../src/services/meteoalarm.js';
import { GeoMetService } from '../../src/services/geomet.js';
import { NominatimService } from '../../src/services/nominatim.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const BERLIN = { latitude: 52.52, longitude: 13.405 };
const TORONTO = { latitude: 43.6532, longitude: -79.3832 };
const METEOALARM_MSG = 'MeteoAlarm feed returned an unexpected shape';
const GEOMET_MSG = 'GeoMet API returned an unexpected shape';
const ALL_CLEAR = 'No active weather alerts';

describe('alert-feed wrong-shaped 200 through the MCP dispatch', () => {
  let tempDir: string;
  let client: Client;

  beforeEach(async () => {
    clearServiceCaches();
    tempDir = mkdtempSync(join(tmpdir(), 'weather-mcp-feed-shape-'));

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createWeatherServer({
      locationStore: new LocationStore(join(tempDir, 'locations.json'))
    });
    await server.connect(serverTransport);
    client = new Client({ name: 'alert-feed-body-shape-dispatch-test', version: '0.0.0' });
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

  function stubMeteoAlarm(body: unknown) {
    vi.spyOn(NominatimService.prototype, 'reverseCountry').mockResolvedValue('de');
    return vi.spyOn(MeteoAlarmService.prototype as any, 'makeRequest').mockResolvedValue(body);
  }

  function stubGeoMet(body: unknown) {
    vi.spyOn(NominatimService.prototype, 'reverseCountry').mockResolvedValue('ca');
    return vi.spyOn(GeoMetService.prototype as any, 'makeRequest').mockResolvedValue(body);
  }

  it('get_alerts, Berlin: a wrong-shaped MeteoAlarm 200 is an error result, not the all-clear', async () => {
    const spy = stubMeteoAlarm('<html>Maintenance</html>');

    const { result, text } = await call('get_alerts', BERLIN);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(text).toBe(`Error: ${METEOALARM_MSG}`);
    expect(text).not.toContain(ALL_CLEAR);
  });

  it('get_alerts, Toronto: a wrong-shaped GeoMet 200 is an error result, not the all-clear', async () => {
    const spy = stubGeoMet('');

    const { result, text } = await call('get_alerts', TORONTO);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(text).toBe(`Error: ${GEOMET_MSG}`);
    expect(text).not.toContain(ALL_CLEAR);
  });

  it('get_weather_summary, Berlin: the alerts section is unavailable with the fixed message', async () => {
    const spy = stubMeteoAlarm('<html>Maintenance</html>');

    const { result, text } = await call('get_weather_summary', { ...BERLIN, include: ['alerts'] });

    expect(spy).toHaveBeenCalledTimes(1);
    const section = alertsSection(text);
    expect(section).toContain(METEOALARM_MSG);
    expect(section).not.toContain(ALL_CLEAR);
    expect(result.isError).not.toBe(true);
  });

  it('get_weather_summary, Toronto: the alerts section is unavailable with the fixed message', async () => {
    const spy = stubGeoMet('');

    const { result, text } = await call('get_weather_summary', { ...TORONTO, include: ['alerts'] });

    expect(spy).toHaveBeenCalledTimes(1);
    const section = alertsSection(text);
    expect(section).toContain(GEOMET_MSG);
    expect(section).not.toContain(ALL_CLEAR);
    expect(result.isError).not.toBe(true);
  });

  it('positive control: an empty MeteoAlarm envelope renders the all-clear with no isError key', async () => {
    const spy = stubMeteoAlarm({ warnings: [] });

    const { result, text } = await call('get_alerts', BERLIN);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(text).toContain('No active weather alerts for Germany');
    expect(result).not.toHaveProperty('isError');
  });
});
