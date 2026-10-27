/**
 * `isError` through the real MCP dispatch (upstream-failure-iserror, T4, contract 7).
 *
 * upstream-failure-iserror.test.ts pins the flag at the handler. This file proves it survives the
 * dispatch to a real in-process MCP `Client` over `InMemoryTransport`: the factory's own service
 * instances are stubbed at the prototype (G70), and a success carries no `isError` key at all.
 * The spy call counts are the positive control — an inert spy would let the real call reach the
 * socket guard and render the same `❌` block from a different error.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Pinned before the static imports below evaluate (GOTCHAS G61, G26). 'all' is needed because the
// 'standard' preset has neither tool.
vi.hoisted(() => {
  process.env.ENABLED_TOOLS = 'all';
  process.env.ANALYTICS_ENABLED = 'false';
  process.env.ANALYTICS_SALT = 'upstream-failure-iserror-dispatch-test';
  process.env.WEATHER_DEFAULT_LOCATION = '';
});

import { createWeatherServer, clearServiceCaches } from '../../src/server/weatherServer.js';
import { LocationStore } from '../../src/services/locationStore.js';
import { NIFCService } from '../../src/services/nifc.js';
import { NOAAService } from '../../src/services/noaa.js';
import { NominatimService } from '../../src/services/nominatim.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const DISPATCH_NIFC_FAIL = 'zq-dispatch-nifc-fail-4417';
const DISPATCH_NWPS_FAIL = 'zq-dispatch-nwps-fail-4417';

const BOISE = { latitude: 43.6150, longitude: -116.2023 };
const GRAND_RAPIDS = { latitude: 42.9634, longitude: -85.6681 };

describe('isError through the MCP dispatch', () => {
  let tempDir: string;
  let client: Client;

  beforeEach(async () => {
    clearServiceCaches();
    tempDir = mkdtempSync(join(tmpdir(), 'weather-mcp-iserror-'));
    vi.spyOn(NominatimService.prototype, 'reverseCountry').mockResolvedValue('us');

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createWeatherServer({
      locationStore: new LocationStore(join(tempDir, 'locations.json'))
    });
    await server.connect(serverTransport);
    client = new Client({ name: 'upstream-failure-iserror-dispatch-test', version: '0.0.0' });
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

  it('get_wildfire_info: a failed NIFC fetch arrives with isError true and the report body', async () => {
    const spy = vi.spyOn(NIFCService.prototype, 'queryFirePerimeters')
      .mockRejectedValue(new Error(DISPATCH_NIFC_FAIL));

    const { result, text } = await call('get_wildfire_info', BOISE);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(text.startsWith('# Wildfire Information Report')).toBe(true);
    expect(text.startsWith('Error:')).toBe(false);
    expect(text).toContain(`Error details: ${DISPATCH_NIFC_FAIL}`);
  });

  it('get_river_conditions: a failed NWPS gauge fetch arrives with isError true and the report body', async () => {
    const spy = vi.spyOn(NOAAService.prototype, 'getNWPSGaugesInBoundingBox')
      .mockRejectedValue(new Error(DISPATCH_NWPS_FAIL));

    const { result, text } = await call('get_river_conditions', GRAND_RAPIDS);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(text.startsWith('Error:')).toBe(false);
    expect(text).toContain('❌ **Error retrieving river gauge data**');
    expect(text).toContain(DISPATCH_NWPS_FAIL);
  });

  it('get_wildfire_info: an all-clear answer arrives with no isError key', async () => {
    const spy = vi.spyOn(NIFCService.prototype, 'queryFirePerimeters')
      .mockResolvedValue({ features: [] });

    const { result, text } = await call('get_wildfire_info', BOISE);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(text).toContain('✅ **No active wildfires found within');
    expect(result).not.toHaveProperty('isError');
  });

  it('get_river_conditions: an empty gauge answer arrives with no isError key', async () => {
    const spy = vi.spyOn(NOAAService.prototype, 'getNWPSGaugesInBoundingBox')
      .mockResolvedValue([]);

    const { result, text } = await call('get_river_conditions', GRAND_RAPIDS);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(text).toContain('No river gauges found within');
    expect(text).not.toContain('❌ **Error retrieving river gauge data**');
    expect(result).not.toHaveProperty('isError');
  });
});
