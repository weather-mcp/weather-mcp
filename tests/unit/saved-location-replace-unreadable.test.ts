/**
 * Write-side contracts for a saved alias whose stored value is unreadable — T6 of
 * plan-saved-location-null-entry-bounds.
 *
 * Covers: replacing a non-object entry (`null`, `0`, `""`, `false`, `"abc"`, `[]` — all six,
 * every time, G56); refusing a metadata-only save over one; dropping a malformed stored
 * metadata field and naming it; refusing a partial update over an unusable stored
 * coordinate; and the dispatch over `createWeatherServer`.
 *
 * Fixtures are RAW JSON TEXT written with `writeFileSync` into a `mkdtempSync` directory and
 * read by a real `LocationStore(path)` — never the no-argument constructor, no `fs` mock
 * (G70, G117). The geocoder is a stub, so the unit project's socket guard is never hit.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Pinned before the factory's static import evaluates: 'standard' registers the saved-location tools.
const BEFORE = vi.hoisted(() => {
  process.env.ENABLED_TOOLS = 'standard';
  process.env.ANALYTICS_ENABLED = 'false';
  process.env.ANALYTICS_SALT = 'saved-location-replace-unreadable-test';
  process.env.WEATHER_DEFAULT_LOCATION = '';
  return {};
});
void BEFORE;

import { handleSaveLocation } from '../../src/handlers/savedLocationsHandler.js';
import { LocationStore } from '../../src/services/locationStore.js';
import type { NominatimService } from '../../src/services/nominatim.js';
import { createWeatherServer } from '../../src/server/weatherServer.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const BAD_VALUES: ReadonlyArray<{ label: string; raw: string }> = [
  { label: 'null', raw: 'null' },
  { label: '0', raw: '0' },
  { label: '""', raw: '""' },
  { label: 'false', raw: 'false' },
  { label: '"abc"', raw: '"abc"' },
  { label: '[]', raw: '[]' },
];

const HOME_RAW =
  '{"name":"Seattle, WA","latitude":47.6062,"longitude":-122.3321,"timezone":"America/Los_Angeles","country_code":"US","saved_at":"2025-01-15T10:30:00.000Z","updated_at":"2025-01-15T10:30:00.000Z"}';
const ZURICH_RAW =
  '{"name":"Zurich, Switzerland","latitude":47.3769,"longitude":8.5417,"alternateNames":["zueri"],"saved_at":"2025-01-15T11:00:00.000Z","updated_at":"2025-01-15T11:00:00.000Z"}';
const PROTO_RAW =
  '{"name":"Proto Place","latitude":10,"longitude":20,"saved_at":"2025-01-15T12:00:00.000Z","updated_at":"2025-01-15T12:00:00.000Z"}';

const REPLACED_LINE = '⚠️ Replaced a saved entry that could not be read.';
const NOT_READABLE =
  'Saved location "x" cannot be read: the entry is not an object. ' +
  'Provide location_query, or latitude + longitude + name, to replace it.';
const NOT_KEPT_PREFIX = '⚠️ Not kept from the stored entry because it was malformed:';

const tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Fixture {
  dir: string;
  file: string;
  store: LocationStore;
}

function fixture(entries: ReadonlyArray<readonly [string, string]>): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'wmcp-replace-'));
  tempDirs.push(dir);
  const file = join(dir, 'locations.json');
  const body = entries.map(([alias, raw]) => `  ${JSON.stringify(alias)}: ${raw}`).join(',\n');
  writeFileSync(file, `{\n${body}\n}\n`, 'utf-8');
  return { dir, file, store: new LocationStore(file) };
}

const withBad = (raw: string): Fixture =>
  fixture([['home', HOME_RAW], ['x', raw], ['__proto__', PROTO_RAW], ['zurich', ZURICH_RAW]]);

const stub = {
  searchLocation: vi.fn(async () => ({
    results: [
      { name: 'Geocoded X', latitude: 1.5, longitude: 2.5, timezone: 'Etc/UTC', country_code: 'xx', admin1: 'Reg' },
    ],
  })),
} as unknown as NominatimService;

function text(r: { content: Array<{ type: string; text: string }> }): string {
  return r.content[0].text;
}

function lines(t: string): string[] {
  return t.split('\n');
}

function parsed(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
}

/** Own-key read, so a `__proto__` entry is seen as data (G117). */
function own(o: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(o, key)?.value;
}

function tmpResidue(dir: string): string[] {
  return readdirSync(dir).filter((n) => n.startsWith('.locations.json.') && n.endsWith('.tmp'));
}

describe('replacing an unreadable entry with location details', () => {
  const calls: Array<{ label: string; args: Record<string, unknown> }> = [
    { label: 'coordinates', args: { alias: 'x', latitude: 40.5, longitude: -100.25, name: 'New Place' } },
    { label: 'location_query', args: { alias: 'x', location_query: 'anywhere' } },
  ];

  for (const { label: via, args } of calls) {
    for (const bad of BAD_VALUES) {
      it(`${via}: replaces x = ${bad.label}, keeps every other alias`, async () => {
        const fx = withBad(bad.raw);
        const before = parsed(fx.file);

        const result = await handleSaveLocation(args, fx.store, stub);
        const out = text(result);

        expect(out.startsWith('# Saved Location')).toBe(true);
        expect(lines(out)).toContain(REPLACED_LINE);

        const after = parsed(fx.file);
        const x = own(after, 'x') as Record<string, unknown>;
        expect(typeof x).toBe('object');
        expect(x).not.toBeNull();
        expect(typeof x.saved_at).toBe('string');
        expect(typeof x.updated_at).toBe('string');
        expect(Number.isNaN(Date.parse(x.saved_at as string))).toBe(false);
        if (via === 'coordinates') {
          expect(x.name).toBe('New Place');
          expect(x.latitude).toBe(40.5);
        } else {
          expect(x.name).toBe('Geocoded X');
          expect(x.latitude).toBe(1.5);
        }

        for (const alias of ['home', 'zurich', '__proto__']) {
          expect(own(after, alias)).toEqual(own(before, alias));
        }
        expect(own(after, '__proto__')).toBeDefined();
        expect(Object.keys(after).sort()).toEqual(['__proto__', 'home', 'x', 'zurich']);
      });
    }
  }
});

describe('metadata-only save over an unreadable entry', () => {
  for (const bad of BAD_VALUES) {
    it(`refuses x = ${bad.label} by name and leaves the file alone`, async () => {
      const fx = withBad(bad.raw);
      const bytes = readFileSync(fx.file, 'utf-8');
      const mtime = statSync(fx.file).mtimeMs;

      await expect(
        handleSaveLocation({ alias: 'x', notes: 'n' }, fx.store, stub)
      ).rejects.toThrow(new Error(NOT_READABLE));

      expect(readFileSync(fx.file, 'utf-8')).toBe(bytes);
      expect(statSync(fx.file).mtimeMs).toBe(mtime);
      expect(tmpResidue(fx.dir)).toEqual([]);
    });
  }
});

describe('malformed stored metadata on an object entry', () => {
  const OBJ =
    '{"name":"Old","latitude":47.6,"longitude":-122.3,"country_code":42,"alternateNames":"oops","saved_at":"2025-02-01T00:00:00.000Z","updated_at":"2025-02-01T00:00:00.000Z"}';

  it('full re-save drops alternateNames and names only it', async () => {
    const fx = fixture([['x', OBJ]]);
    const out = text(
      await handleSaveLocation({ alias: 'x', latitude: 10, longitude: 20, name: 'Fresh' }, fx.store, stub)
    );
    const x = own(parsed(fx.file), 'x') as Record<string, unknown>;
    expect(x.latitude).toBe(10);
    expect(x.name).toBe('Fresh');
    expect('alternateNames' in x).toBe(false);
    expect('country_code' in x).toBe(false);
    expect(x.saved_at).toBe('2025-02-01T00:00:00.000Z');
    expect(lines(out)).toContain(`${NOT_KEPT_PREFIX} \`alternateNames\`.`);
    const notKeptLine = lines(out).find((l) => l.startsWith(NOT_KEPT_PREFIX)) ?? '';
    expect(notKeptLine).not.toContain('country_code');
    expect(lines(out)).not.toContain(REPLACED_LINE);
  });

  it('partial update drops both and names them in order', async () => {
    const fx = fixture([['x', OBJ]]);
    const out = text(await handleSaveLocation({ alias: 'x', name: 'New' }, fx.store, stub));
    const x = own(parsed(fx.file), 'x') as Record<string, unknown>;
    expect(x.name).toBe('New');
    expect(x.latitude).toBe(47.6);
    expect('alternateNames' in x).toBe(false);
    expect('country_code' in x).toBe(false);
    expect(lines(out)).toContain(`${NOT_KEPT_PREFIX} \`country_code\`, \`alternateNames\`.`);
  });

  it('a call that supplies alternateNames writes it and does not name it', async () => {
    const fx = fixture([['x', OBJ]]);
    const out = text(
      await handleSaveLocation(
        { alias: 'x', latitude: 10, longitude: 20, name: 'Fresh', alternateNames: ['a'] },
        fx.store,
        stub
      )
    );
    const x = own(parsed(fx.file), 'x') as Record<string, unknown>;
    expect(x.alternateNames).toEqual(['a']);
    expect(out).not.toContain(NOT_KEPT_PREFIX);
  });

  it('partial update over an unusable stored latitude is refused and the file is unchanged', async () => {
    const fx = fixture([
      ['x', '{"name":"Old","latitude":"47.6","longitude":-122.3,"saved_at":"2025-02-01T00:00:00.000Z","updated_at":"2025-02-01T00:00:00.000Z"}'],
    ]);
    const bytes = readFileSync(fx.file, 'utf-8');
    await expect(handleSaveLocation({ alias: 'x', notes: 'n' }, fx.store, stub)).rejects.toThrow(
      new Error(
        'Saved location "x" has an unusable stored latitude. ' +
        'Provide location_query, or latitude + longitude + name, to replace it.'
      )
    );
    expect(readFileSync(fx.file, 'utf-8')).toBe(bytes);
    expect(tmpResidue(fx.dir)).toEqual([]);
  });
});

describe('a valid entry', () => {
  const VALID =
    '{"name":"Old","latitude":47.6,"longitude":-122.3,"notes":"keep","saved_at":"2025-02-01T00:00:00.000Z","updated_at":"2025-02-01T00:00:00.000Z"}';

  it('shows neither new sentence on a full re-save, and writes the new coordinates', async () => {
    const fx = fixture([['x', VALID]]);
    const out = text(
      await handleSaveLocation({ alias: 'x', latitude: 10, longitude: 20, name: 'Fresh' }, fx.store, stub)
    );
    expect(out.startsWith('# Updated Location')).toBe(true);
    expect(lines(out)).not.toContain(REPLACED_LINE);
    expect(out).not.toContain(NOT_KEPT_PREFIX);
    const x = own(parsed(fx.file), 'x') as Record<string, unknown>;
    expect(x.latitude).toBe(10);
    expect(x.longitude).toBe(20);
    expect(x.notes).toBe('keep');
  });

  it('shows neither new sentence on a metadata-only update, and keeps the coordinates', async () => {
    const fx = fixture([['x', VALID]]);
    const out = text(await handleSaveLocation({ alias: 'x', activities: ['hiking'] }, fx.store, stub));
    expect(lines(out)).not.toContain(REPLACED_LINE);
    expect(out).not.toContain(NOT_KEPT_PREFIX);
    const x = own(parsed(fx.file), 'x') as Record<string, unknown>;
    expect(x.latitude).toBe(47.6);
    expect(x.longitude).toBe(-122.3);
    expect(x.activities).toEqual(['hiking']);
  });
});

describe('dispatch', () => {
  it('save_location over x: null succeeds with the replaced line; get_saved_location renders it', async () => {
    const fx = withBad('null');
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createWeatherServer({ locationStore: fx.store });
    await server.connect(serverTransport);
    const client = new Client({ name: 'saved-location-replace-unreadable-test', version: '0.0.0' });
    await client.connect(clientTransport);
    try {
      const saved = await client.callTool({
        name: 'save_location',
        arguments: { alias: 'x', latitude: 40.5, longitude: -100.25, name: 'New Place' },
      });
      expect(saved.isError).toBeFalsy();
      const savedText = (saved.content as Array<{ type: string; text: string }>)[0].text;
      expect(savedText.startsWith('# Saved Location')).toBe(true);
      expect(lines(savedText)).toContain(REPLACED_LINE);

      const got = await client.callTool({ name: 'get_saved_location', arguments: { alias: 'x' } });
      expect(got.isError).toBeFalsy();
      const gotText = (got.content as Array<{ type: string; text: string }>)[0].text;
      expect(gotText).toContain('New Place');
      expect(gotText).toContain('40.5');
    } finally {
      await client.close();
      await server.close();
    }
  });
});
