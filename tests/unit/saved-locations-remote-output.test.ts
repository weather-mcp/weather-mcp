/**
 * The saved-location tools print where the store file is to the machine's
 * owner, and never to a remote caller. Most of these are successful
 * responses, so the error formatter cannot be what keeps the path out.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  handleGetSavedLocation,
  handleListSavedLocations,
  handleSaveLocation
} from '../../src/handlers/savedLocationsHandler.js';
import { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import { formatErrorForUser } from '../../src/errors/ApiError.js';
import { runWithCallerAudience } from '../../src/utils/callerAudience.js';

/** Coordinates are supplied, so the geocoder is never consulted. */
const geocoding = {} as GeocodingService;

let tempDir: string;
let storePath: string;
let store: LocationStore;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'saved-remote-out-'));
  storePath = join(tempDir, 'locations.json');
  store = new LocationStore(storePath);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((block) => block.text ?? '').join('');
}

function expectNoPath(text: string): void {
  expect(text).not.toContain(storePath);
  expect(text).not.toContain(tempDir);
  expect(text).not.toContain(basename(tempDir));
  expect(text).not.toContain('locations.json');
  expect(text).not.toContain('Storage location');
}

const FOOTER = (): string => `*Storage location: ${storePath}*\n`;

async function inBoth<T>(fn: () => Promise<T>): Promise<{ none: T; local: T; remote: T }> {
  return {
    none: await fn(),
    local: await runWithCallerAudience(false, fn),
    remote: await runWithCallerAudience(true, fn)
  };
}

const SAVE_ARGS = { alias: 'home', latitude: 47.6062, longitude: -122.3321, name: 'Seattle, WA' };

describe('saved-location tools: the store path by audience', () => {
  it('save_location success', async () => {
    const { none, local, remote } = await inBoth(async () =>
      textOf(await handleSaveLocation(SAVE_ARGS, store, geocoding))
    );

    expect(none.endsWith(FOOTER())).toBe(true);
    expect(local.endsWith(FOOTER())).toBe(true);
    expectNoPath(remote);
    // The remote text is the local text with the footer line removed, and nothing else.
    expect(local.slice(0, local.length - FOOTER().length)).toBe(remote);
  });

  it('list_saved_locations, empty store', async () => {
    const { none, local, remote } = await inBoth(async () => textOf(await handleListSavedLocations(store)));

    expect(none.endsWith(FOOTER())).toBe(true);
    expect(local).toBe(none);
    expectNoPath(remote);
    expect(none.slice(0, none.length - FOOTER().length)).toBe(remote);
    expect(remote).toContain('No saved locations yet.');
  });

  it('list_saved_locations, populated store', async () => {
    await handleSaveLocation(SAVE_ARGS, store, geocoding);

    const { none, local, remote } = await inBoth(async () => textOf(await handleListSavedLocations(store)));

    expect(none.endsWith(FOOTER())).toBe(true);
    expect(local).toBe(none);
    expectNoPath(remote);
    expect(none.slice(0, none.length - FOOTER().length)).toBe(remote);
    expect(remote).toContain('Seattle, WA');
  });

  it('list_saved_locations, one malformed entry', async () => {
    writeFileSync(storePath, JSON.stringify({ broken: { name: 5, latitude: 1, longitude: 2 } }));

    const { none, local, remote } = await inBoth(async () => textOf(await handleListSavedLocations(store)));

    expect(none).toContain('or repair it in the file below.');
    expect(none.endsWith(FOOTER())).toBe(true);
    expect(local).toBe(none);

    expectNoPath(remote);
    expect(remote).not.toContain('the file below');
    expect(remote).toContain("or ask the server's operator to repair the saved-locations file.");
    expect(remote).toContain('remove_saved_location(alias="broken")');
  });

  it('get_saved_location, malformed entry', async () => {
    writeFileSync(storePath, JSON.stringify({ broken: { name: 5, latitude: 1, longitude: 2 } }));

    const attempt = async (): Promise<Error> => {
      try {
        await handleGetSavedLocation({ alias: 'broken' }, store);
      } catch (error) {
        return error as Error;
      }
      throw new Error('expected get_saved_location to refuse a malformed entry');
    };
    const { none, local, remote } = await inBoth(attempt);

    expect(none.message).toContain(`Remove it with remove_saved_location or repair it in ${storePath}.`);
    expect(local.message).toBe(none.message);

    expectNoPath(remote.message);
    expect(remote.message).toContain(
      "Remove it with remove_saved_location, or ask the server's operator to repair the saved-locations file."
    );
    // The part that names the defect is the same for both audiences.
    expect(remote.message.split('\n\n')[0]).toBe(none.message.split('\n\n')[0]);
    expectNoPath(runWithCallerAudience(true, () => formatErrorForUser(remote)));
  });
});
