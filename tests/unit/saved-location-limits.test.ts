/**
 * Size limits, the 100-location cap and oversize old data — T7 of
 * plan-saved-location-null-entry-bounds (design section 5, Verification 6, 7, 8).
 *
 * Every threshold below is a LITERAL, never the exported constant (G160): a fixture built
 * from `SAVED_LOCATION_TEXT_LIMITS.notes` moves with a mutation of it and the mutation
 * survives. The constant-equals-literal assertions live in saved-location-entry-limits.test.ts.
 * Messages are asserted whole, anchored (G62, G65).
 *
 * Fixtures are RAW JSON TEXT written with `writeFileSync` into a `mkdtempSync` directory and
 * read by a real `LocationStore(path)` — never the no-argument constructor, no `fs` mock
 * (G70, G117). The geocoder is a stub, so the unit project's socket guard is never hit.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  handleSaveLocation,
  handleListSavedLocations,
  handleGetSavedLocation,
  handleRemoveSavedLocation,
} from '../../src/handlers/savedLocationsHandler.js';
import { LocationStore } from '../../src/services/locationStore.js';
import { resolveLocation } from '../../src/utils/locationResolver.js';
import type { GeocodingService } from '../../src/services/geocoding.js';

const tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const STAMPS = '"saved_at":"2025-01-15T10:30:00.000Z","updated_at":"2025-01-15T10:30:00.000Z"';

/** Raw JSON text of one stored entry; `extra` is already-serialised `,"field":value` text. */
function entryRaw(name: string, extra = ''): string {
  return `{"name":${JSON.stringify(name)},"latitude":47.6062,"longitude":-122.3321${extra},${STAMPS}}`;
}

interface Fixture {
  dir: string;
  file: string;
  store: LocationStore;
}

function fixture(entries: ReadonlyArray<readonly [string, string]>): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'wmcp-limits-'));
  tempDirs.push(dir);
  const file = join(dir, 'locations.json');
  const body = entries.map(([alias, raw]) => `  ${JSON.stringify(alias)}: ${raw}`).join(',\n');
  writeFileSync(file, `{\n${body}\n}\n`, 'utf-8');
  return { dir, file, store: new LocationStore(file) };
}

/** A store with one ordinary alias, so a refused save has bytes to leave unchanged. */
const withHome = (): Fixture => fixture([['home', entryRaw('Seattle, WA')]]);

/** `count` aliases loc000.., the last one `lastRaw` when given. */
function crowded(count: number, lastRaw?: string): Fixture {
  const entries: Array<readonly [string, string]> = [];
  for (let i = 0; i < count; i++) {
    const alias = `loc${String(i).padStart(3, '0')}`;
    entries.push([alias, i === count - 1 && lastRaw !== undefined ? lastRaw : entryRaw(`Place ${i}`)]);
  }
  return fixture(entries);
}

const stub = {
  geocode: vi.fn(async () => [
    { name: 'g'.repeat(501), display_name: 'g'.repeat(501), latitude: 1.5, longitude: 2.5, timezone: 'Etc/UTC', country_code: 'xx', confidence: 'medium', source: 'openmeteo' },
  ]),
} as unknown as GeocodingService;

function text(r: { content: Array<{ type: string; text: string }> }): string {
  return r.content[0].text;
}

function snap(fx: Fixture): { bytes: string; mtime: number } {
  return { bytes: readFileSync(fx.file, 'utf-8'), mtime: statSync(fx.file).mtimeMs };
}

function tmpResidue(dir: string): string[] {
  return readdirSync(dir).filter((n) => n.startsWith('.locations.json.') && n.endsWith('.tmp'));
}

function parsed(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
}

/** Own-key read, so a `__proto__`-style alias is data (G117). */
function own(o: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(o, key)?.value;
}

/** Whole-message match: `toThrow('x')` is a substring match, so anchor and escape. */
function exactly(message: string): RegExp {
  return new RegExp(`^${message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

const COORDS = { latitude: 40.5, longitude: -100.25 };

// ---------------------------------------------------------------------------------------
// Field limits through handleSaveLocation
// ---------------------------------------------------------------------------------------

describe('field limits through save_location', () => {
  const names = (n: number): string[] => Array.from({ length: n }, (_, i) => `n${i}`);
  const acts = (n: number): string[] => Array.from({ length: n }, (_, i) => `a${i}`);

  const rows: Array<{
    label: string;
    ok: Record<string, unknown>;
    bad: Record<string, unknown>;
    message: string;
  }> = [
    {
      label: 'name 500 / 501',
      ok: { name: 'a'.repeat(500) },
      bad: { name: 'a'.repeat(501) },
      message: 'name must be 500 characters or less',
    },
    {
      label: 'description 500 / 501',
      ok: { name: 'N', description: 'a'.repeat(500) },
      bad: { name: 'N', description: 'a'.repeat(501) },
      message: 'description must be 500 characters or less',
    },
    {
      label: 'notes 2000 / 2001',
      ok: { name: 'N', notes: 'a'.repeat(2000) },
      bad: { name: 'N', notes: 'a'.repeat(2001) },
      message: 'notes must be 2000 characters or less',
    },
    {
      label: 'alternateNames count 20 / 21',
      ok: { name: 'N', alternateNames: names(20) },
      bad: { name: 'N', alternateNames: names(21) },
      message: 'alternateNames must have 20 entries or fewer',
    },
    {
      label: 'alternateNames element 100 / 101',
      ok: { name: 'N', alternateNames: ['a'.repeat(100)] },
      bad: { name: 'N', alternateNames: ['a'.repeat(101)] },
      message: 'Each alternate name must be 100 characters or less',
    },
    {
      label: 'activities count 20 / 21',
      ok: { name: 'N', activities: acts(20) },
      bad: { name: 'N', activities: acts(21) },
      message: 'activities must have 20 entries or fewer',
    },
  ];

  for (const row of rows) {
    it(`${row.label}: accepted at the limit`, async () => {
      const fx = withHome();
      const result = await handleSaveLocation({ alias: 'new', ...COORDS, ...row.ok }, fx.store, stub);
      expect(text(result).startsWith('# Saved Location')).toBe(true);
      expect(own(parsed(fx.file), 'new')).toBeDefined();
    });

    it(`${row.label}: refused one past, file untouched`, async () => {
      const fx = withHome();
      const before = snap(fx);
      await expect(
        handleSaveLocation({ alias: 'new', ...COORDS, ...row.bad }, fx.store, stub)
      ).rejects.toThrow(exactly(row.message));
      expect(snap(fx)).toEqual(before);
      expect(tmpResidue(fx.dir)).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------------------
// Field limits through LocationStore.set directly
// ---------------------------------------------------------------------------------------

describe('field limits through LocationStore.set', () => {
  const names = (n: number): string[] => Array.from({ length: n }, (_, i) => `n${i}`);
  const acts = (n: number): string[] => Array.from({ length: n }, (_, i) => `a${i}`);

  const rows: Array<{
    label: string;
    ok: Record<string, unknown>;
    bad: Record<string, unknown>;
    message: string;
  }> = [
    { label: 'name 500 / 501', ok: { name: 'a'.repeat(500) }, bad: { name: 'a'.repeat(501) }, message: 'name must be 500 characters or less' },
    { label: 'description 500 / 501', ok: { description: 'a'.repeat(500) }, bad: { description: 'a'.repeat(501) }, message: 'description must be 500 characters or less' },
    { label: 'notes 2000 / 2001', ok: { notes: 'a'.repeat(2000) }, bad: { notes: 'a'.repeat(2001) }, message: 'notes must be 2000 characters or less' },
    { label: 'timezone 200 / 201', ok: { timezone: 'a'.repeat(200) }, bad: { timezone: 'a'.repeat(201) }, message: 'timezone must be 200 characters or less' },
    { label: 'country_code 200 / 201', ok: { country_code: 'a'.repeat(200) }, bad: { country_code: 'a'.repeat(201) }, message: 'country_code must be 200 characters or less' },
    { label: 'admin1 200 / 201', ok: { admin1: 'a'.repeat(200) }, bad: { admin1: 'a'.repeat(201) }, message: 'admin1 must be 200 characters or less' },
    { label: 'admin2 200 / 201', ok: { admin2: 'a'.repeat(200) }, bad: { admin2: 'a'.repeat(201) }, message: 'admin2 must be 200 characters or less' },
    { label: 'alternateNames count 20 / 21', ok: { alternateNames: names(20) }, bad: { alternateNames: names(21) }, message: 'alternateNames must have 20 entries or fewer' },
    { label: 'alternateNames element 100 / 101', ok: { alternateNames: ['a'.repeat(100)] }, bad: { alternateNames: ['a'.repeat(101)] }, message: 'Each entry in alternateNames must be 100 characters or less' },
    { label: 'activities count 20 / 21', ok: { activities: acts(20) }, bad: { activities: acts(21) }, message: 'activities must have 20 entries or fewer' },
    { label: 'activities element 50 / 51', ok: { activities: ['a'.repeat(50)] }, bad: { activities: ['a'.repeat(51)] }, message: 'Each entry in activities must be 50 characters or less' },
  ];

  const record = (extra: Record<string, unknown>): Parameters<LocationStore['set']>[1] =>
    ({ name: 'N', latitude: 10, longitude: 20, ...extra }) as Parameters<LocationStore['set']>[1];

  for (const row of rows) {
    it(`${row.label}: accepted at the limit`, () => {
      const fx = withHome();
      const saved = fx.store.set('new', record(row.ok));
      expect(typeof saved.saved_at).toBe('string');
      expect(own(parsed(fx.file), 'new')).toBeDefined();
    });

    it(`${row.label}: refused one past, existing file untouched`, () => {
      const fx = withHome();
      const before = snap(fx);
      expect(() => fx.store.set('new', record(row.bad))).toThrow(exactly(row.message));
      expect(snap(fx)).toEqual(before);
      expect(tmpResidue(fx.dir)).toEqual([]);
    });

    it(`${row.label}: refused one past on a fresh directory creates no file`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'wmcp-limits-fresh-'));
      tempDirs.push(dir);
      const file = join(dir, 'locations.json');
      const store = new LocationStore(file);
      expect(() => store.set('new', record(row.bad))).toThrow(exactly(row.message));
      expect(existsSync(file)).toBe(false);
      expect(readdirSync(dir)).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------------------
// Geocoded name
// ---------------------------------------------------------------------------------------

describe('a geocoded name over 500', () => {
  it('is refused with the whole message when no name parameter is given', async () => {
    const fx = withHome();
    const before = snap(fx);
    await expect(
      handleSaveLocation({ alias: 'geo', location_query: 'anywhere' }, fx.store, stub)
    ).rejects.toThrow(
      exactly(
        'The geocoded name is 501 characters, over the 500-character limit. ' +
        'Pass a shorter name with the name parameter.'
      )
    );
    expect(snap(fx)).toEqual(before);
    expect(tmpResidue(fx.dir)).toEqual([]);
  });

  it('succeeds when a name parameter is passed', async () => {
    const fx = withHome();
    const result = await handleSaveLocation(
      { alias: 'geo', location_query: 'anywhere', name: 'Short Name' },
      fx.store,
      stub
    );
    expect(text(result).startsWith('# Saved Location')).toBe(true);
    expect((own(parsed(fx.file), 'geo') as Record<string, unknown>).name).toBe('Short Name');
  });

  it('is accepted at exactly 500', async () => {
    const fx = withHome();
    const at500 = {
      geocode: vi.fn(async () => [
        { name: 'g'.repeat(500), display_name: 'g'.repeat(500), latitude: 1.5, longitude: 2.5, confidence: 'medium', source: 'nominatim' },
      ]),
    } as unknown as GeocodingService;
    await handleSaveLocation({ alias: 'geo', location_query: 'anywhere' }, fx.store, at500);
    expect(((own(parsed(fx.file), 'geo') as Record<string, unknown>).name as string).length).toBe(500);
  });
});

// ---------------------------------------------------------------------------------------
// The 100-location cap
// ---------------------------------------------------------------------------------------

const CAP_MESSAGE =
  'Cannot save more than 100 locations. Remove one with remove_saved_location, then save again.';

describe('the 100-location cap', () => {
  for (const total of [100, 101]) {
    describe(`with ${total} aliases on disk`, () => {
      it('refuses a new alias with the whole message, file unchanged', async () => {
        const fx = crowded(total);
        const before = snap(fx);
        await expect(
          handleSaveLocation({ alias: 'brandnew', ...COORDS, name: 'New' }, fx.store, stub)
        ).rejects.toThrow(exactly(CAP_MESSAGE));
        expect(snap(fx)).toEqual(before);
        expect(tmpResidue(fx.dir)).toEqual([]);
      });

      it('refuses a new alias through set() directly', () => {
        const fx = crowded(total);
        const before = snap(fx);
        expect(() => fx.store.set('brandnew', { name: 'N', latitude: 1, longitude: 2 })).toThrow(
          exactly(CAP_MESSAGE)
        );
        expect(snap(fx)).toEqual(before);
      });

      it('still updates an existing alias', async () => {
        const fx = crowded(total);
        const result = await handleSaveLocation({ alias: 'loc000', notes: 'updated' }, fx.store, stub);
        expect(text(result).startsWith('# Updated Location')).toBe(true);
        const after = parsed(fx.file);
        expect(Object.keys(after)).toHaveLength(total);
        expect((own(after, 'loc000') as Record<string, unknown>).notes).toBe('updated');
      });

      it('still replaces a stored null', async () => {
        const fx = crowded(total, 'null');
        const last = `loc${String(total - 1).padStart(3, '0')}`;
        const result = await handleSaveLocation(
          { alias: last, ...COORDS, name: 'Replacement' },
          fx.store,
          stub
        );
        expect(text(result)).toContain('⚠️ Replaced a saved entry that could not be read.');
        const after = parsed(fx.file);
        expect(Object.keys(after)).toHaveLength(total);
        expect((own(after, last) as Record<string, unknown>).name).toBe('Replacement');
      });

      it('still removes an alias', async () => {
        const fx = crowded(total);
        const result = await handleRemoveSavedLocation({ alias: 'loc001' }, fx.store);
        expect(text(result)).toContain(`**Remaining locations:** ${total - 1}`);
        expect(Object.keys(parsed(fx.file))).toHaveLength(total - 1);
      });
    });
  }

  it('accepts a new alias at 99 (the 100th)', async () => {
    const fx = crowded(99);
    const result = await handleSaveLocation({ alias: 'brandnew', ...COORDS, name: 'New' }, fx.store, stub);
    expect(text(result).startsWith('# Saved Location')).toBe(true);
    expect(Object.keys(parsed(fx.file))).toHaveLength(100);
  });
});

// ---------------------------------------------------------------------------------------
// Oversize old data
// ---------------------------------------------------------------------------------------

describe('a stored notes of 2001 characters', () => {
  const BIG_NOTES = 'a'.repeat(2001);
  const bigFixture = (): Fixture =>
    fixture([
      ['home', entryRaw('Seattle, WA')],
      ['big', entryRaw('Big Notes Place', `,"notes":${JSON.stringify(BIG_NOTES)}`)],
    ]);

  it('is still listed: oversize is not malformed', async () => {
    const fx = bigFixture();
    const listed = text(await handleListSavedLocations(fx.store));
    expect(listed).toContain('## `big`');
    expect(listed).toContain('**Name:** Big Notes Place');
    expect(listed).not.toContain('cannot be shown');
  });

  it('is still shown by get_saved_location', async () => {
    const fx = bigFixture();
    const got = text(await handleGetSavedLocation({ alias: 'big' }, fx.store));
    expect(got).toContain('**Name:** Big Notes Place');
    expect(got).toContain(BIG_NOTES);
  });

  it('still resolves by location_name', () => {
    const fx = bigFixture();
    const resolved = resolveLocation({ location_name: 'big' }, fx.store);
    expect(resolved.latitude).toBe(47.6062);
    expect(resolved.longitude).toBe(-122.3321);
  });

  it('refuses a name-only update with the whole message, file unchanged', async () => {
    const fx = bigFixture();
    const before = snap(fx);
    await expect(handleSaveLocation({ alias: 'big', name: 'Renamed' }, fx.store, stub)).rejects.toThrow(
      exactly('Stored notes is 2001 characters, over the 2000-character limit. Shorten it or clear it in this call.')
    );
    expect(snap(fx)).toEqual(before);
    expect(tmpResidue(fx.dir)).toEqual([]);
  });

  it('succeeds with notes "" and clears the stored notes', async () => {
    const fx = bigFixture();
    const result = await handleSaveLocation({ alias: 'big', notes: '' }, fx.store, stub);
    expect(text(result).startsWith('# Updated Location')).toBe(true);
    const big = own(parsed(fx.file), 'big') as Record<string, unknown>;
    expect(big.notes).toBeUndefined();
    expect(big.name).toBe('Big Notes Place');
  });

  it('succeeds with notes "short"', async () => {
    const fx = bigFixture();
    await handleSaveLocation({ alias: 'big', notes: 'short' }, fx.store, stub);
    const big = own(parsed(fx.file), 'big') as Record<string, unknown>;
    expect(big.notes).toBe('short');
  });

  it('is refused by set() called directly with the same notes: no exemption at the store', () => {
    const fx = bigFixture();
    const before = snap(fx);
    expect(() =>
      fx.store.set('big', { name: 'Big Notes Place', latitude: 47.6062, longitude: -122.3321, notes: BIG_NOTES })
    ).toThrow(exactly('notes must be 2000 characters or less'));
    expect(snap(fx)).toEqual(before);
    expect(tmpResidue(fx.dir)).toEqual([]);
  });
});

describe('the remedy follows the stored field that is over its limit', () => {
  it('a stored name of 501: pass a shorter name', async () => {
    const fx = fixture([['wide', entryRaw('n'.repeat(501))]]);
    const before = snap(fx);
    await expect(handleSaveLocation({ alias: 'wide', notes: 'x' }, fx.store, stub)).rejects.toThrow(
      exactly('Stored name is 501 characters, over the 500-character limit. Pass a shorter name with the name parameter.')
    );
    expect(snap(fx)).toEqual(before);
  });

  it('a stored name of 501 with a new name parameter succeeds', async () => {
    const fx = fixture([['wide', entryRaw('n'.repeat(501))]]);
    await handleSaveLocation({ alias: 'wide', name: 'Short' }, fx.store, stub);
    expect((own(parsed(fx.file), 'wide') as Record<string, unknown>).name).toBe('Short');
  });

  it('a stored timezone of 201: replace the location details', async () => {
    const fx = fixture([['zone', entryRaw('Zone Place', `,"timezone":${JSON.stringify('t'.repeat(201))}`)]]);
    const before = snap(fx);
    await expect(handleSaveLocation({ alias: 'zone', notes: 'x' }, fx.store, stub)).rejects.toThrow(
      exactly(
        'Stored timezone is 201 characters, over the 200-character limit. ' +
        'Provide location_query, or latitude + longitude + name, to replace it.'
      )
    );
    expect(snap(fx)).toEqual(before);
  });

  it('a stored list of 21 alternate names: shorten or clear it', async () => {
    const list = JSON.stringify(Array.from({ length: 21 }, (_, i) => `n${i}`));
    const fx = fixture([['many', entryRaw('Many', `,"alternateNames":${list}`)]]);
    await expect(handleSaveLocation({ alias: 'many', notes: 'x' }, fx.store, stub)).rejects.toThrow(
      exactly('Stored alternateNames has 21 entries, over the 20-entry limit. Shorten it or clear it in this call.')
    );
  });

  it('a stored alternate name of 101 characters: shorten or clear it', async () => {
    const list = JSON.stringify(['a'.repeat(101)]);
    const fx = fixture([['long', entryRaw('Long', `,"alternateNames":${list}`)]]);
    await expect(handleSaveLocation({ alias: 'long', notes: 'x' }, fx.store, stub)).rejects.toThrow(
      exactly(
        'Stored alternateNames has an entry of 101 characters, over the 100-character limit. ' +
        'Shorten it or clear it in this call.'
      )
    );
  });
});
