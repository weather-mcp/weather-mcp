/**
 * Pins both `escapeMarkdown` copies through the renderers that call them.
 *
 * Two private copies exist, so each gets its own seam (G40):
 *   - search copy:  src/handlers/locationHandler.ts, via `handleSearchLocation`
 *     (`**Query:**`, `## 1.` heading, `**Full Name:**`);
 *   - saved copy:   src/handlers/savedLocationsHandler.ts, via
 *     `handleGetSavedLocation` over a real temp-file `LocationStore`.
 *
 * The alias renders inside a code span, where backslash escapes print
 * literally (G116), so no alias escaping is asserted and the alias is `probe`.
 *
 * Every expected line is written by hand from the escape table — backslash
 * first, then * _ [ ] ( ) < > ` ~ # !, newline to a space, CR removed — and is
 * asserted whole, from its label through its last character.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { handleSearchLocation } from '../../src/handlers/locationHandler.js';
import { handleGetSavedLocation } from '../../src/handlers/savedLocationsHandler.js';
import { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService, GeocodingResult } from '../../src/services/geocoding.js';

// One hostile string: link, image, emphasis, code, heading, HTML, a lone
// backslash, a newline and a carriage return.
const HOSTILE =
  '[x](http://e.example) ![i](http://e.example/p.png) *b* _u_ `c` # h <script>\\ end\nnext\rline';

// Hand-derived: every special character escaped, "\n" -> " ", "\r" removed.
const ESCAPED =
  '\\[x\\]\\(http://e.example\\) \\!\\[i\\]\\(http://e.example/p.png\\) ' +
  '\\*b\\* \\_u\\_ \\`c\\` \\# h &lt;script&gt;\\\\ end nextline';

function linesOf(result: { content: Array<{ type: string; text: string }> }): string[] {
  return result.content[0].text.split('\n');
}

function linesStartingWith(lines: string[], prefix: string): string[] {
  return lines.filter(l => l.startsWith(prefix));
}

// --- Search copy ---------------------------------------------------------

function buildResult(overrides: Partial<GeocodingResult> = {}): GeocodingResult {
  return {
    name: 'Springfield',
    display_name: 'Springfield, Test County, Testland',
    latitude: 39.78,
    longitude: -89.65,
    country: 'Testland',
    country_code: 'tl',
    admin1: 'Test County',
    timezone: 'America/Chicago',
    confidence: 'high',
    source: 'nominatim',
    ...overrides
  };
}

function fakeGeocoder(result: GeocodingResult): GeocodingService {
  return { geocode: vi.fn().mockResolvedValue([result]) } as unknown as GeocodingService;
}

describe('search_location escapeMarkdown (locationHandler.ts)', () => {
  it('escapes the query on the whole **Query:** line', async () => {
    const result = await handleSearchLocation({ query: HOSTILE }, fakeGeocoder(buildResult()));
    expect(linesStartingWith(linesOf(result), '**Query:**')).toEqual([`**Query:** "${ESCAPED}"`]);
  });

  it('escapes a provider-returned name on the whole result heading line', async () => {
    const result = await handleSearchLocation(
      { query: 'x' },
      fakeGeocoder(buildResult({ name: HOSTILE }))
    );
    expect(linesStartingWith(linesOf(result), '## 1.')).toEqual([`## 1. ${ESCAPED}`]);
  });

  it('escapes a provider-returned display_name on the whole **Full Name:** line', async () => {
    const result = await handleSearchLocation(
      { query: 'x' },
      fakeGeocoder(buildResult({ display_name: HOSTILE }))
    );
    expect(linesStartingWith(linesOf(result), '**Full Name:**')).toEqual([
      `**Full Name:** ${ESCAPED}`
    ]);
  });

  it('leaves no raw newline-injected structure from the hostile input', async () => {
    const result = await handleSearchLocation({ query: HOSTILE }, fakeGeocoder(buildResult()));
    const lines = linesOf(result);
    // "next" followed the newline in the input; it must stay on the Query line.
    expect(lines.some(l => l.startsWith('next'))).toBe(false);
  });
});

// --- Saved copy ----------------------------------------------------------

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
  tempDirs = [];
});

function storeWith(overrides: Record<string, unknown>): LocationStore {
  const dir = mkdtempSync(join(tmpdir(), 'weather-mcp-escape-'));
  tempDirs.push(dir);
  const storePath = join(dir, 'locations.json');
  const entry = {
    name: 'Plain Name',
    latitude: 47.6062,
    longitude: -122.3321,
    saved_at: '2025-01-15T10:30:00.000Z',
    updated_at: '2025-01-15T10:30:00.000Z',
    ...overrides
  };
  writeFileSync(storePath, JSON.stringify({ probe: entry }, null, 2));
  return new LocationStore(storePath);
}

async function renderSaved(overrides: Record<string, unknown>): Promise<string[]> {
  const result = await handleGetSavedLocation({ alias: 'probe' }, storeWith(overrides));
  return linesOf(result);
}

describe('get_saved_location escapeMarkdown (savedLocationsHandler.ts)', () => {
  it('escapes name on the whole **Name:** line', async () => {
    const lines = await renderSaved({ name: HOSTILE });
    expect(linesStartingWith(lines, '**Name:**')).toEqual([`**Name:** ${ESCAPED}`]);
  });

  it('escapes description on the whole **Description:** line', async () => {
    const lines = await renderSaved({ description: HOSTILE });
    expect(linesStartingWith(lines, '**Description:**')).toEqual([`**Description:** ${ESCAPED}`]);
  });

  it('escapes notes on the whole **Notes:** line', async () => {
    const lines = await renderSaved({ notes: HOSTILE });
    expect(linesStartingWith(lines, '**Notes:**')).toEqual([`**Notes:** ${ESCAPED}`]);
  });

  it('escapes admin1 on the whole **Region:** line', async () => {
    const lines = await renderSaved({ admin1: HOSTILE });
    expect(linesStartingWith(lines, '**Region:**')).toEqual([`**Region:** ${ESCAPED}`]);
  });

  it('escapes admin2 on the whole **County:** line', async () => {
    const lines = await renderSaved({ admin2: HOSTILE });
    expect(linesStartingWith(lines, '**County:**')).toEqual([`**County:** ${ESCAPED}`]);
  });

  it('escapes each alternate name and joins them with ", "', async () => {
    const lines = await renderSaved({ alternateNames: [HOSTILE, 'a_b'] });
    expect(linesStartingWith(lines, '**Alternate Names:**')).toEqual([
      `**Alternate Names:** ${ESCAPED}, a\\_b`
    ]);
  });

  it('escapes each activity and joins them with ", "', async () => {
    const lines = await renderSaved({ activities: [HOSTILE, 'a_b'] });
    expect(linesStartingWith(lines, '**Activities:**')).toEqual([
      `**Activities:** ${ESCAPED}, a\\_b`
    ]);
  });

  it('leaves no raw newline-injected structure from the hostile input', async () => {
    const lines = await renderSaved({ notes: HOSTILE, description: HOSTILE });
    expect(lines.some(l => l.startsWith('next'))).toBe(false);
  });
});
