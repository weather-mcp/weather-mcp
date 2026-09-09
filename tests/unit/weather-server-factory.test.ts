/**
 * The factory's contract, proved in-process — the first in-process MCP client
 * in this repo, and meant to be the pattern a future HTTP-transport plan
 * copies (InMemoryTransport.createLinkedPair() + a real @modelcontextprotocol/sdk
 * Client, wired to createWeatherServer() directly, no child process and no stdio).
 *
 * What this file proves:
 *   1. src/index.ts exports nothing; src/server/weatherServer.ts exports exactly
 *      the six names it is documented to export.
 *   2. Importing the factory, and calling createWeatherServer(), registers no
 *      SIGTERM/SIGINT listener — the entry point owns process lifecycle, not
 *      the factory.
 *   3. Two createWeatherServer() calls produce two distinct Server instances
 *      sharing one tool registry.
 *   4. initialize carries the right name/version, matching SERVER_NAME/
 *      SERVER_VERSION and src/utils/version.ts's VERSION.
 *   5. tools/list returns exactly the enabled slice of TOOL_DEFINITIONS for
 *      the pinned ENABLED_TOOLS=standard preset (12 tools).
 *   6. tools/call on a disabled tool, and on an unknown tool, both return the
 *      same fixed not-enabled message via isError — never the dispatch
 *      switch's own `Unknown tool: …`, which is unreachable through the
 *      public MCP surface (see the "unknown tool" test below).
 *   7. The LocationStore instance the caller passes to createWeatherServer()
 *      is the one the tools actually read from — proven by seeding a temp
 *      store and reading it back through list_saved_locations.
 *
 * This file deliberately never imports src/index.js (built or source) — doing
 * so starts a real server: constructs a StdioServerTransport, calls
 * server.connect(), and registers SIGTERM/SIGINT handlers unconditionally at
 * module scope, with no import.meta.url guard (GOTCHAS G61). src/index.ts is
 * read here only as text, via readFileSync, to assert what it does NOT export.
 */

import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Pinned before the static imports below evaluate — vi.hoisted is what buys
// that ordering over a beforeEach.
//   - ENABLED_TOOLS: Vitest loads no .env, but a developer's shell may export
//     one (GOTCHAS G26) and toolConfig is a module-scope singleton built from
//     process.env.ENABLED_TOOLS at import time — set it before the factory
//     import or the preset this file measures against is whatever the runner's
//     shell happens to carry. 'standard' is the preset with list_saved_locations
//     IN and get_marine_conditions OUT, at 12 tools (src/config/tools.ts).
//   - ANALYTICS_ENABLED / ANALYTICS_SALT: src/server/weatherServer.ts imports
//     ../analytics/index.js, which builds the analytics singleton at module
//     load (src/analytics/config.ts:193) and calls getOrGenerateAnalyticsSalt()
//     regardless of ANALYTICS_ENABLED. A fixed salt returns before any
//     filesystem access, keeping the import from touching ~/.weather-mcp.
//   - WEATHER_DEFAULT_LOCATION: forced empty so DEFAULT_LOCATION_HINT text in
//     the location schema fragments stays off — an inherited value would change
//     TOOL_DEFINITIONS's schema strings out from under the deep-equal in the
//     tools/list contract below.
const BEFORE = vi.hoisted(() => {
  process.env.ENABLED_TOOLS = 'standard';
  process.env.ANALYTICS_ENABLED = 'false';
  process.env.ANALYTICS_SALT = 'weather-server-factory-test';
  process.env.WEATHER_DEFAULT_LOCATION = '';
  return { sigterm: process.listenerCount('SIGTERM'), sigint: process.listenerCount('SIGINT') };
});

// Import the factory exactly once, statically. Never re-import it under
// vi.resetModules() — that would re-run the sixteen service constructors and
// their Cache timers again (GOTCHAS G21 point 3).
import {
  createWeatherServer,
  TOOL_DEFINITIONS,
  SERVER_NAME,
  SERVER_VERSION,
  clearServiceCaches,
} from '../../src/server/weatherServer.js';
import { LocationStore } from '../../src/services/locationStore.js';
import { toolConfig, PRESETS } from '../../src/config/tools.js';
import { VERSION } from '../../src/utils/version.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

describe('createWeatherServer — factory contract', () => {
  let tempDir: string;
  let locationStore: LocationStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'weather-mcp-test-'));
    locationStore = new LocationStore(join(tempDir, 'locations.json'));
  });

  afterEach(() => {
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  /**
   * Connect one in-process client to one freshly built server over a linked
   * in-memory transport pair. No network, no child process, no stdio.
   */
  async function connect(store: LocationStore): Promise<{
    client: Client;
    server: ReturnType<typeof createWeatherServer>;
  }> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createWeatherServer({ locationStore: store });
    await server.connect(serverTransport);

    const client = new Client({ name: 'weather-server-factory-test', version: '0.0.0' });
    await client.connect(clientTransport);

    return { client, server };
  }

  it('the entry exports nothing; the factory exports exactly six names', () => {
    const entrySource = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8');
    const factorySource = readFileSync(
      new URL('../../src/server/weatherServer.ts', import.meta.url),
      'utf8'
    );

    expect(/^export\b/m.test(entrySource), 'src/index.ts must export nothing').toBe(false);

    const exportRe = /^export (?:const|function|interface) (\w+)/gm;

    // G41 control: prove the regex actually captures something before trusting
    // its absence of a match on the entry, and its exact match set on the
    // factory, as meaningful.
    const controlMatches = [...'export const X = 1;\n'.matchAll(exportRe)].map((m) => m[1]);
    expect(controlMatches).toEqual(['X']);

    const factoryExports = [...factorySource.matchAll(exportRe)].map((m) => m[1]).sort();
    expect(factoryExports).toEqual(
      [
        'SERVER_NAME',
        'SERVER_VERSION',
        'TOOL_DEFINITIONS',
        'WeatherServerOptions',
        'clearServiceCaches',
        'createWeatherServer',
      ].sort()
    );
  });

  it('importing the factory, and constructing servers, registers no signal listener', async () => {
    expect(process.listenerCount('SIGTERM')).toBe(BEFORE.sigterm);
    expect(process.listenerCount('SIGINT')).toBe(BEFORE.sigint);

    createWeatherServer({ locationStore });
    createWeatherServer({ locationStore });

    expect(process.listenerCount('SIGTERM')).toBe(BEFORE.sigterm);
    expect(process.listenerCount('SIGINT')).toBe(BEFORE.sigint);
  });

  it('two instances are distinct Servers over one shared tool registry', async () => {
    const a = await connect(locationStore);
    const b = await connect(new LocationStore(join(tempDir, 'locations-b.json')));

    expect(a.server).not.toBe(b.server);

    const [toolsA, toolsB] = await Promise.all([a.client.listTools(), b.client.listTools()]);
    expect(toolsA).toEqual(toolsB);

    await a.client.close();
    await a.server.close();
    await b.client.close();
    await b.server.close();
  });

  it('initialize carries the server name and version', async () => {
    const { client, server } = await connect(locationStore);

    expect(client.getServerVersion()).toEqual({ name: SERVER_NAME, version: SERVER_VERSION });
    expect(SERVER_VERSION).toBe(VERSION);
    expect(SERVER_NAME).toBe('weather-mcp');

    await client.close();
    await server.close();
  });

  it('tools/list is exactly the enabled slice of TOOL_DEFINITIONS', async () => {
    const { client, server } = await connect(locationStore);

    const { tools } = await client.listTools();
    const expected = toolConfig.getEnabledTools().map((name) => TOOL_DEFINITIONS[name]);
    expect(tools).toEqual(expected);

    // Positive control (G41/G26): proves the ENABLED_TOOLS=standard pin
    // actually took, rather than the assertion above passing vacuously
    // against whatever preset the runner's shell happened to export.
    const names = new Set(tools.map((t) => t.name));
    expect(names).toEqual(new Set(PRESETS.standard));
    expect(tools.length).toBe(12);

    await client.close();
    await server.close();
  });

  it("tools/call on a name outside the preset returns the fixed not-enabled message", async () => {
    const { client, server } = await connect(locationStore);

    const result = await client.callTool({ name: 'get_marine_conditions', arguments: {} });

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ type: string; text: string }>)[0].text).toBe(
      "Error: Tool 'get_marine_conditions' is not enabled. Please check your ENABLED_TOOLS configuration."
    );

    await client.close();
    await server.close();
  });

  it('an unknown tool name returns the same not-enabled message, not the dispatch default arm', async () => {
    // toolConfig.isEnabled(name) is Set<ToolName>.has(name) (src/config/tools.ts:288-290),
    // checked in the CallToolRequestSchema handler before the switch(name) dispatch
    // (src/server/weatherServer.ts:849-851). An unrecognized name is never a member
    // of the enabled set, so it fails that check and throws the same "not enabled"
    // error before the switch runs at all — the dispatch's `default: throw new
    // Error('Unknown tool: ...')` arm (weatherServer.ts:946-947) is unreachable
    // through the public tools/call surface; it would only fire for a name that is
    // both enabled and absent from every case label, which tests/unit/tool-name-parity.test.ts
    // proves cannot happen (TOOL_NAMES == case labels == TOOL_DEFINITIONS keys).
    const { client, server } = await connect(locationStore);

    const result = await client.callTool({ name: 'no_such_tool', arguments: {} });

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ type: string; text: string }>)[0].text).toBe(
      "Error: Tool 'no_such_tool' is not enabled. Please check your ENABLED_TOOLS configuration."
    );

    await client.close();
    await server.close();
  });

  it('the store the caller passes to createWeatherServer is the store the tools read', async () => {
    locationStore.set('probe', {
      name: 'Probe City',
      latitude: 12.34,
      longitude: 56.78,
    });

    const { client, server } = await connect(locationStore);

    const result = await client.callTool({ name: 'list_saved_locations', arguments: {} });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    // Assert the rendered construct handleListSavedLocations actually emits
    // (src/handlers/savedLocationsHandler.ts:362-364), not the bare word
    // "probe" (GOTCHAS G62 — a bare-word lock breaks the moment that word
    // appears anywhere else in the rendered output for an unrelated reason).
    expect(text).toContain('## `probe`');
    expect(text).toContain('**Name:** Probe City');
    expect(text).toContain('**Coordinates:** 12.3400°, 56.7800°');

    expect(existsSync(join(tempDir, 'locations.json'))).toBe(true);

    await client.close();
    await server.close();
  });

  it('clearServiceCaches is callable and returns undefined without throwing', () => {
    expect(clearServiceCaches()).toBeUndefined();
  });
});
