/**
 * The caller audience through the real dispatch (plan-http-entry-hardening).
 *
 * A real in-process MCP `Client` over `InMemoryTransport` and the real factory.
 * With `remoteCallers: true` the dispatch opens a remote scope around the tool
 * and again around the catch that formats a thrown error, so neither an error
 * nor a successful saved-location response carries the store path. With the
 * option absent, the text is what it always was.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Pinned before the factory's static import evaluates (GOTCHAS G61, G26).
vi.hoisted(() => {
  process.env.ENABLED_TOOLS = 'all';
  process.env.ANALYTICS_ENABLED = 'false';
  process.env.ANALYTICS_SALT = 'remote-caller-dispatch-test';
  process.env.WEATHER_DEFAULT_LOCATION = '';
});

import { createWeatherServer } from '../../src/server/weatherServer.js';
import { LocationStore } from '../../src/services/locationStore.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

let tempDir: string;
let storePath: string;
const open: Array<{ close: () => Promise<void> }> = [];

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'remote-dispatch-'));
  storePath = join(tempDir, 'locations.json');
});

afterEach(async () => {
  for (const closable of open.splice(0)) await closable.close();
  rmSync(tempDir, { recursive: true, force: true });
});

async function connect(remoteCallers?: boolean): Promise<Client> {
  const locationStore = new LocationStore(storePath);
  const server = createWeatherServer(remoteCallers === undefined ? { locationStore } : { locationStore, remoteCallers });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'remote-caller-dispatch-test', version: '0.0.0' });
  await client.connect(clientTransport);
  open.push(client, server);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: Array<{ type: string; text?: string }>;
  };
  return { isError: result.isError === true, text: result.content.map(block => block.text ?? '').join('') };
}

function expectNoPath(text: string): void {
  expect(text).not.toContain(storePath);
  expect(text).not.toContain(tempDir);
  expect(text).not.toContain('locations.json');
  expect(text).not.toContain('Storage location');
}

const UNREADABLE_LOCAL = (): string => `Error: Saved locations file could not be read: ${storePath}`;
const UNREADABLE_REMOTE = 'Error: The saved locations file on the server could not be read.';

describe('dispatch: an unreadable store', () => {
  beforeEach(() => {
    writeFileSync(storePath, 'not json');
  });

  it('remoteCallers: true — list_saved_locations has no path', async () => {
    const result = await call(await connect(true), 'list_saved_locations', {});
    expect(result.isError).toBe(true);
    expect(result.text.startsWith(UNREADABLE_REMOTE)).toBe(true);
    expectNoPath(result.text);
  });

  it('remoteCallers: true — get_forecast with a location_name has no path', async () => {
    const result = await call(await connect(true), 'get_forecast', { location_name: 'home' });
    expect(result.isError).toBe(true);
    expect(result.text.startsWith(UNREADABLE_REMOTE)).toBe(true);
    expectNoPath(result.text);
  });

  it.each([
    ['option absent', undefined],
    ['remoteCallers: false', false]
  ])('%s — the text names the file, as before', async (_name, remoteCallers) => {
    const client = await connect(remoteCallers);

    const listed = await call(client, 'list_saved_locations', {});
    expect(listed.isError).toBe(true);
    expect(listed.text.startsWith(UNREADABLE_LOCAL())).toBe(true);

    const forecast = await call(client, 'get_forecast', { location_name: 'home' });
    expect(forecast.isError).toBe(true);
    expect(forecast.text.startsWith(UNREADABLE_LOCAL())).toBe(true);
  });
});

describe('dispatch: a healthy store', () => {
  const SAVE = { alias: 'home', latitude: 47.6062, longitude: -122.3321, name: 'Seattle, WA' };

  it('remoteCallers: true — save and list print no storage location', async () => {
    const client = await connect(true);

    const saved = await call(client, 'save_location', SAVE);
    expect(saved.isError).toBe(false);
    expectNoPath(saved.text);

    const listed = await call(client, 'list_saved_locations', {});
    expect(listed.isError).toBe(false);
    expect(listed.text).toContain('Seattle, WA');
    expectNoPath(listed.text);
  });

  it('option absent — save and list end with the storage location, as before', async () => {
    const client = await connect();
    const footer = `*Storage location: ${storePath}*\n`;

    expect((await call(client, 'save_location', SAVE)).text.endsWith(footer)).toBe(true);
    expect((await call(client, 'list_saved_locations', {})).text.endsWith(footer)).toBe(true);
  });

  it('a fixed-message error reads the same for both audiences', async () => {
    const args = { latitude: 999, longitude: 0 };
    const remote = await call(await connect(true), 'get_forecast', args);
    const local = await call(await connect(), 'get_forecast', args);
    expect(remote.isError).toBe(true);
    expect(remote.text).toBe(local.text);
  });
});
