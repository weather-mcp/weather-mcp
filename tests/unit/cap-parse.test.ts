import { describe, it, expect } from 'vitest';
import {
  parseXml,
  parseCapIndex,
  normalizeIndexEntries,
  isAllowedFeedUrl,
  parseCapDocument,
  parsePolygonDocument,
  parseCapPolygon,
  selectPreferredInfo,
  parseReferences,
  linkedPolygonUrl,
  flattenCapAlert,
  filterActiveCapWarnings,
  MAX_DOCUMENT_BYTES,
  MAX_INDEX_ITEMS,
  MAX_RINGS_PER_WARNING
} from '../../src/utils/capParse.js';
import type { CapIndexEntry, NationalCapWarning } from '../../src/types/cap.js';

/** Far-future / long-past instants so fixtures never age out mid-run. */
const FUTURE = '2099-01-01T00:00:00+00:00';
const PAST = '2020-01-01T00:00:00+00:00';

/**
 * Reduced from the live SACHET capture (2026-08-23, see
 * `.claude/scratch/national-cap-alerts/CAPTURE-NOTES.md`) — `cap:` namespace
 * prefix throughout, no `<?xml` prolog (SACHET documents start directly at
 * `<cap:alert>`). Info-block order here is HI-first/en-IN-second so the
 * `selectPreferredInfo` test is non-vacuous; live samples on 2026-08-23
 * actually put `en-IN` first (noted in CAPTURE-NOTES.md as a correction to
 * the plan's assumption) — this fixture's order is a deliberate test
 * construction, not a live-shape claim. Each info block carries a `Polygon
 * URL` parameter with a *different* URL so the test can prove the selected
 * info's URL — not just any info's URL — is the one returned.
 */
const SACHET_ALERT_XML = `<cap:alert xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2">
<cap:identifier>IN-1234567890_1</cap:identifier>
<cap:sender>Test-SDMA</cap:sender>
<cap:sent>2026-08-23T10:27:44+05:30</cap:sent>
<cap:status>Actual</cap:status>
<cap:msgType>Update</cap:msgType>
<cap:scope>Public</cap:scope>
<cap:references>IMD-Test,IN-1234567890_0,2026-08-23T10:23:59+05:30</cap:references>
<cap:info>
<cap:language>HI</cap:language>
<cap:event>Thunder shower</cap:event>
<cap:urgency>Expected</cap:urgency>
<cap:severity>Moderate</cap:severity>
<cap:certainty>Possible</cap:certainty>
<cap:expires>${FUTURE}</cap:expires>
<cap:headline>हिंदी शीर्षक</cap:headline>
<cap:parameter>
<cap:valueName>Polygon URL</cap:valueName>
<cap:value>https://sachet.ndma.gov.in/cap_public_website/FetchPolygonXMLFile?identifier=HI0001</cap:value>
</cap:parameter>
<cap:area>
<cap:areaDesc>Test district (HI)</cap:areaDesc>
</cap:area>
</cap:info>
<cap:info>
<cap:language>en-IN</cap:language>
<cap:event>Thunder shower</cap:event>
<cap:urgency>Expected</cap:urgency>
<cap:severity>Moderate</cap:severity>
<cap:certainty>Possible</cap:certainty>
<cap:expires>${FUTURE}</cap:expires>
<cap:headline>Light to moderate rain likely</cap:headline>
<cap:parameter>
<cap:valueName>Polygon URL</cap:valueName>
<cap:value>https://sachet.ndma.gov.in/cap_public_website/FetchPolygonXMLFile?identifier=EN0001</cap:value>
</cap:parameter>
<cap:area>
<cap:areaDesc>Test district (EN)</cap:areaDesc>
</cap:area>
</cap:info>
</cap:alert>`;

/**
 * Reduced from the live PAGASA capture: `msgType: Update` + `responseType:
 * AllClear` + `urgency: Past` (a "Final" advisory), `identifier` bare uuid
 * (the index `id` — see the Atom fixture below — is `urn:uuid:<same uuid>`),
 * two `<area>` blocks with inline polygons (one area has two rings) —
 * deliberately not a count any test should assume is universal; the live
 * "Final" sampled 2026-08-23 had one area / three polygons.
 */
const PAGASA_ALERT_XML = `<?xml version="1.0"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
<identifier>8a8d3a9c-df82-4f85-be5c-9c007e90a557</identifier>
<sender>PAGASA-DOST</sender>
<sent>2026-08-21T05:15:47+08:00</sent>
<status>Actual</status>
<msgType>Update</msgType>
<scope>Public</scope>
<references>PAGASA-DOST,b3b0a099-5e54-4687-a2a2-a94abb873247,2026-08-20T17:31:20+08:00</references>
<info>
<category>Met</category>
<event>General Flood Advisory (Final)</event>
<responseType>AllClear</responseType>
<urgency>Past</urgency>
<severity>Minor</severity>
<certainty>Unlikely</certainty>
<expires>${FUTURE}</expires>
<senderName>PAGASA-DOST</senderName>
<headline>General Flood Advisory (Final)</headline>
<area>
<areaDesc>La Union</areaDesc>
<polygon>16.79,120.54 16.78,120.53 16.65,120.59 16.79,120.54</polygon>
</area>
<area>
<areaDesc>Ilocos Sur</areaDesc>
<polygon>17.55,120.48 17.48,120.59 17.34,120.53 17.55,120.48</polygon>
<polygon>17.70,120.54 17.56,120.48 17.90,120.44 17.70,120.54</polygon>
</area>
</info>
</alert>`;

/** Reduced from the live BMKG capture: one area, several inline polygon rings. */
const BMKG_ALERT_XML = `<?xml version="1.0" ?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>2.49.0.1.360.0.2026.08.23.04.12.001</identifier>
  <sender>cuaca.ekstrem@bmkg.go.id</sender>
  <sent>2026-08-23T11:15:00+07:00</sent>
  <status>Actual</status>
  <msgType>Alert</msgType>
  <scope>Public</scope>
  <info>
    <language>en</language>
    <event>Thunderstorm</event>
    <urgency>Immediate</urgency>
    <severity>Moderate</severity>
    <certainty>Observed</certainty>
    <expires>${FUTURE}</expires>
    <headline>Thunderstorm This Afternoon in Sumatera Utara</headline>
    <area>
      <areaDesc>Sumatera Utara</areaDesc>
      <polygon>0.606,97.884 0.589,97.854 0.572,97.841 0.606,97.884</polygon>
      <polygon>0.823,97.726 0.805,97.719 0.795,97.723 0.823,97.726</polygon>
      <polygon>1.426,99.005 1.405,98.996 1.404,98.976 1.426,99.005</polygon>
    </area>
  </info>
</alert>`;

/** A CAP document with exactly one `<info>`/`<area>`/`<polygon>` — must still parse to arrays. */
const SINGLE_EVERYTHING_XML = `<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
<identifier>SINGLE-1</identifier>
<info>
<language>en</language>
<event>Test</event>
<area>
<areaDesc>Only Area</areaDesc>
<polygon>10,10 10,20 20,20 10,10</polygon>
</area>
</info>
</alert>`;

/** Reduced RSS index shape: `<?xml?>` + `<?xml-stylesheet?>` PIs, `guid` with `isPermaLink`, `link`, `pubDate`. */
const RSS_INDEX_XML = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<?xml-stylesheet title="XSL_formatting" type="text/xsl" href="feed.xsl"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Test National Alerts</title>
    <link>https://example.test/rss.xml</link>
    <item>
      <title>Test alert headline</title>
      <link>https://example.test/doc?identifier=123</link>
      <author>alerts@example.test (Test Office)</author>
      <guid isPermaLink="false">123</guid>
      <pubDate>Sun, 23 Aug 2026 04:57:45 GMT</pubDate>
    </item>
  </channel>
</rss>`;

/** Reduced Atom index shape: `cap+xml` link beside an `alternate` link, `urn:uuid:` id, object-form author. */
const ATOM_INDEX_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes'?>
<feed xmlns="http://www.w3.org/2005/Atom">
<id>https://example.test/feeds/</id>
<title type="text">Test Feed</title>
<updated>2026-08-21T05:15:47+08:00</updated>
<entry>
  <id>urn:uuid:8a8d3a9c-df82-4f85-be5c-9c007e90a557</id>
  <title>GFA #10 (Final)</title>
  <updated>2026-08-21T05:15:47+08:00</updated>
  <author><name>PAGASA DOST</name></author>
  <link rel="alternate" href="https://example.test/output/gfa/8a8d3a9c.html"/>
  <link type="application/cap+xml" href="https://example.test/output/gfa/8a8d3a9c-df82-4f85-be5c-9c007e90a557.cap"/>
</entry>
</feed>`;

function makeWarning(overrides: Partial<NationalCapWarning> = {}): NationalCapWarning {
  return {
    identifier: 'W-1',
    references: [],
    areaDesc: [],
    polygons: [],
    countryCode: 'PH',
    ...overrides
  };
}

describe('parseXml', () => {
  it('parses a minimal valid document with no throw', () => {
    expect(() => parseXml('<rss><channel><title>x</title></channel></rss>')).not.toThrow();
  });

  it('tolerates a leading newline before the <?xml?> declaration', () => {
    const xml = '\n<?xml version="1.0"?><rss><channel><title>x</title></channel></rss>';
    expect(() => parseXml(xml)).not.toThrow();
  });

  it('tolerates a BOM before the <?xml?> declaration', () => {
    const xml = '\uFEFF<?xml version="1.0"?><rss><channel><title>x</title></channel></rss>';
    expect(() => parseXml(xml)).not.toThrow();
  });

  it('rejects an oversize document with a fixed message', () => {
    const huge = 'a'.repeat(MAX_DOCUMENT_BYTES + 1);
    expect(() => parseXml(huge)).toThrow('CAP document too large');
  });

  it('reports a 200 HTML error page as unexpected shape, not DOCTYPE', () => {
    const html = '<!DOCTYPE html><html><body>404 Not Found</body></html>';
    expect(() => parseXml(html)).toThrow('Alert feed returned an unexpected shape');
  });

  it('rejects a non-HTML DOCTYPE with the DOCTYPE message', () => {
    const xml = '<!DOCTYPE alert [<!ENTITY x "y">]><alert><identifier>x</identifier></alert>';
    expect(() => parseXml(xml)).toThrow('CAP document contains a DOCTYPE declaration');
  });

  it('rejects a premature closing tag as not well-formed', () => {
    expect(() => parseXml('<a><b></a>')).toThrow('CAP document is not well-formed XML');
  });

  it('rejects two paired root elements as not well-formed', () => {
    const xml = '<alert><identifier>a</identifier></alert><alert><identifier>b</identifier></alert>';
    expect(() => parseXml(xml)).toThrow('CAP document is not well-formed XML');
  });

  it('rejects two self-closing roots sharing a tag name as not well-formed', () => {
    expect(() => parseXml('<alert/><alert/>')).toThrow('CAP document is not well-formed XML');
  });

  it('rejects a trailing self-closing second root of a different name as not well-formed', () => {
    const xml = '<rss><channel><item/></channel></rss><feed/>';
    expect(() => parseXml(xml)).toThrow('CAP document is not well-formed XML');
  });

  it('never includes the input text in any thrown message', () => {
    const cases: Array<() => unknown> = [
      () => parseXml('UNIQUE_MARKER_TOOBIG' + 'a'.repeat(MAX_DOCUMENT_BYTES)),
      () => parseXml('<a>UNIQUE_MARKER_MALFORMED<b></a>'),
      () => parseXml('<!DOCTYPE UNIQUE_MARKER_DOCTYPE><alert>x</alert>'),
      () => parseXml('<!DOCTYPE html><html>UNIQUE_MARKER_HTML</html>'),
      () => parseCapDocument('<notanalert>UNIQUE_MARKER_SHAPE</notanalert>')
    ];

    for (const run of cases) {
      try {
        run();
        throw new Error('expected the case to throw');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).not.toMatch(/UNIQUE_MARKER_/);
      }
    }
  });
});

describe('parseCapDocument + flattenCapAlert (SACHET)', () => {
  it('flattens to the en-IN record, using the selected info block linked Polygon URL', () => {
    const doc = parseCapDocument(SACHET_ALERT_XML);
    const warning = flattenCapAlert(doc, { preferLanguage: 'en', polygonSource: 'linked-parameter' }, 'IN');

    expect(warning).toBeDefined();
    expect(warning?.language).toBe('en-IN');
    expect(warning?.headline).toBe('Light to moderate rain likely');
    expect(warning?.references).toEqual(['IN-1234567890_0']);
    expect(warning?.linkedPolygonUrl).toBe(
      'https://sachet.ndma.gov.in/cap_public_website/FetchPolygonXMLFile?identifier=EN0001'
    );
    // Proves selection, not accidental first-element luck: the other info's URL differs.
    expect(warning?.linkedPolygonUrl).not.toContain('HI0001');
  });
});

describe('parseCapDocument + flattenCapAlert (PAGASA)', () => {
  it('flattens inline rings from its areas and preserves responseType', () => {
    const doc = parseCapDocument(PAGASA_ALERT_XML);
    const warning = flattenCapAlert(doc, { preferLanguage: 'en', polygonSource: 'inline' }, 'PH');

    expect(warning).toBeDefined();
    expect(warning?.responseType).toEqual(['AllClear']);
    expect(warning?.urgency).toBe('Past');
    expect(warning?.areaDesc).toEqual(['La Union', 'Ilocos Sur']);
    // Three polygon strings total across the two areas in this fixture.
    expect(warning?.polygons).toHaveLength(3);
    expect(warning?.polygonUnavailable).toBeUndefined();
  });
});

describe('parseCapDocument + flattenCapAlert (BMKG)', () => {
  it('flattens one area with many inline rings', () => {
    const doc = parseCapDocument(BMKG_ALERT_XML);
    const warning = flattenCapAlert(doc, { preferLanguage: 'en', polygonSource: 'inline' }, 'ID');

    expect(warning).toBeDefined();
    expect(warning?.areaDesc).toEqual(['Sumatera Utara']);
    expect(warning?.polygons).toHaveLength(3);
  });
});

describe('parseCapDocument single-element arrays', () => {
  it('yields arrays for a document with exactly one info/area/polygon', () => {
    const doc = parseCapDocument(SINGLE_EVERYTHING_XML);
    expect(doc.info).toHaveLength(1);
    expect(doc.info?.[0].area).toHaveLength(1);
    expect(doc.info?.[0].area?.[0].polygon).toHaveLength(1);
    expect(doc.info?.[0].area?.[0].polygon?.[0]).toBe('10,10 10,20 20,20 10,10');
  });
});

describe('parseCapIndex (RSS)', () => {
  it('parses entries by field name: guid object → string, link array → url, pubDate', () => {
    const { entries, trimmed } = parseCapIndex(RSS_INDEX_XML, 'rss');
    expect(trimmed).toBe(false);
    expect(entries).toHaveLength(1);
    expect(entries[0].identifier).toBe('123');
    expect(entries[0].documentUrl).toBe('https://example.test/doc?identifier=123');
    expect(entries[0].published).toBe('Sun, 23 Aug 2026 04:57:45 GMT');
    expect(entries[0].author).toBe('alerts@example.test (Test Office)');
  });
});

describe('parseCapIndex (Atom)', () => {
  it('chooses the cap+xml link over the alternate link, keeps urn:uuid: verbatim, and reads object-form author', () => {
    const { entries, trimmed } = parseCapIndex(ATOM_INDEX_XML, 'atom');
    expect(trimmed).toBe(false);
    expect(entries).toHaveLength(1);
    expect(entries[0].identifier).toBe('urn:uuid:8a8d3a9c-df82-4f85-be5c-9c007e90a557');
    expect(entries[0].documentUrl).toBe(
      'https://example.test/output/gfa/8a8d3a9c-df82-4f85-be5c-9c007e90a557.cap'
    );
    expect(entries[0].author).toBe('PAGASA DOST');
  });
});

describe('parseCapIndex shape failures', () => {
  it('throws when an RSS document is parsed with kind "atom"', () => {
    expect(() => parseCapIndex(RSS_INDEX_XML, 'atom')).toThrow('Alert feed index has an unexpected shape');
  });

  it('throws when an Atom document is parsed with kind "rss"', () => {
    expect(() => parseCapIndex(ATOM_INDEX_XML, 'rss')).toThrow('Alert feed index has an unexpected shape');
  });

  it('throws (never returns []) for an RSS envelope with no channel', () => {
    expect(() => parseCapIndex('<rss><error>maintenance</error></rss>', 'rss')).toThrow(
      'Alert feed index has an unexpected shape'
    );
  });

  it('throws (never returns []) for a self-closed empty channel', () => {
    expect(() => parseCapIndex('<rss><channel/></rss>', 'rss')).toThrow(
      'Alert feed index has an unexpected shape'
    );
  });

  it('returns an honest empty list for a valid envelope with no items', () => {
    const { entries, trimmed } = parseCapIndex('<rss><channel><title>x</title></channel></rss>', 'rss');
    expect(entries).toEqual([]);
    expect(trimmed).toBe(false);
  });

  it('caps at MAX_INDEX_ITEMS and reports trimmed: true', () => {
    const items = Array.from(
      { length: MAX_INDEX_ITEMS + 5 },
      (_unused, index) =>
        `<item><guid>id-${index}</guid><link>https://example.test/doc?id=${index}</link></item>`
    ).join('');
    const xml = `<rss><channel><title>x</title>${items}</channel></rss>`;
    const { entries, trimmed } = parseCapIndex(xml, 'rss');
    expect(entries).toHaveLength(MAX_INDEX_ITEMS);
    expect(trimmed).toBe(true);
  });
});

describe('normalizeIndexEntries', () => {
  it('drops and counts an entry missing an identifier', () => {
    const entries: CapIndexEntry[] = [{ documentUrl: 'https://example.test/a' }];
    const result = normalizeIndexEntries(entries);
    expect(result.entries).toEqual([]);
    expect(result.dropped).toBe(1);
  });

  it('drops and counts an entry missing a documentUrl', () => {
    const entries: CapIndexEntry[] = [{ identifier: 'id-1' }];
    const result = normalizeIndexEntries(entries);
    expect(result.entries).toEqual([]);
    expect(result.dropped).toBe(1);
  });

  it('dedupes duplicate identifiers, first wins', () => {
    const entries: CapIndexEntry[] = [
      { identifier: 'dup', documentUrl: 'https://example.test/first' },
      { identifier: 'dup', documentUrl: 'https://example.test/second' }
    ];
    const result = normalizeIndexEntries(entries);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].documentUrl).toBe('https://example.test/first');
  });
});

describe('isAllowedFeedUrl', () => {
  const feed = {
    allowedHosts: ['example.test'],
    allowedPathPrefixes: ['/output/gfa/']
  };

  it('allows the feed\'s own document URL', () => {
    expect(isAllowedFeedUrl('https://example.test/output/gfa/x.cap', feed)).toBe(true);
  });

  it('rejects http://', () => {
    expect(isAllowedFeedUrl('http://example.test/output/gfa/x.cap', feed)).toBe(false);
  });

  it('rejects localhost', () => {
    expect(isAllowedFeedUrl('https://localhost/output/gfa/x.cap', feed)).toBe(false);
  });

  it('rejects a link-local metadata address', () => {
    expect(isAllowedFeedUrl('https://169.254.169.254/output/gfa/x.cap', feed)).toBe(false);
  });

  it('rejects a cross-origin host', () => {
    expect(isAllowedFeedUrl('https://evil.test/output/gfa/x.cap', feed)).toBe(false);
  });

  it('rejects a wrong path prefix', () => {
    expect(isAllowedFeedUrl('https://example.test/other/x.cap', feed)).toBe(false);
  });

  it('rejects a user@host form', () => {
    expect(isAllowedFeedUrl('https://user@example.test/output/gfa/x.cap', feed)).toBe(false);
  });

  it('rejects an unparseable string', () => {
    expect(isAllowedFeedUrl('not a url', feed)).toBe(false);
  });

  it('rejects an explicit port on an allowlisted host', () => {
    // The allowlist authorises the published feed on 443, not whatever else
    // listens behind the same hostname on another port.
    expect(isAllowedFeedUrl('https://example.test:9200/output/gfa/x.cap', feed)).toBe(false);
  });
});

describe('flattenCapAlert edge cases', () => {
  it('returns undefined for a document with no identifier and no info block', () => {
    const doc = parseCapDocument('<alert><status>Actual</status></alert>');
    const warning = flattenCapAlert(doc, { preferLanguage: 'en', polygonSource: 'inline' }, 'IN');
    expect(warning).toBeUndefined();
  });

  it('marks polygonUnavailable when every inline ring fails to parse', () => {
    // Expanded from the task's shorthand `<alert><polygon>bad</polygon></alert>`
    // into a minimal valid alert/info/area skeleton, since flattenCapAlert
    // requires an identifier and an info block to produce a warning at all.
    const xml = `<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
<identifier>BAD-POLY-1</identifier>
<info>
<language>en</language>
<event>Test</event>
<area>
<areaDesc>Somewhere</areaDesc>
<polygon>bad</polygon>
</area>
</info>
</alert>`;
    const doc = parseCapDocument(xml);
    const warning = flattenCapAlert(doc, { preferLanguage: 'en', polygonSource: 'inline' }, 'IN');

    expect(warning).toBeDefined();
    expect(warning?.polygons).toEqual([]);
    expect(warning?.polygonUnavailable).toBe(true);
    expect(warning?.geometryTrimmed).toBeUndefined();
  });

  it('marks polygonUnavailable and geometryTrimmed when rings exceed MAX_RINGS_PER_WARNING', () => {
    const validRing = '0,0 0,1 1,1 0,0';
    const polygonCount = MAX_RINGS_PER_WARNING + 1;
    const polygons = Array.from({ length: polygonCount }, () => `<polygon>${validRing}</polygon>`).join('');
    const xml = `<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
<identifier>TOO-MANY-RINGS-1</identifier>
<info>
<language>en</language>
<event>Test</event>
<area>
<areaDesc>Somewhere</areaDesc>
${polygons}
</area>
</info>
</alert>`;
    const doc = parseCapDocument(xml);
    const warning = flattenCapAlert(doc, { preferLanguage: 'en', polygonSource: 'inline' }, 'IN');

    expect(warning).toBeDefined();
    expect(warning?.polygons).toEqual([]);
    expect(warning?.polygonUnavailable).toBe(true);
    expect(warning?.geometryTrimmed).toBe(true);
  });
});

describe('parsePolygonDocument', () => {
  it('returns empty, untrimmed rings when there is no <polygon> element', () => {
    const result = parsePolygonDocument('<alert><identifier>x</identifier></alert>');
    expect(result).toEqual({ rings: [], trimmed: false });
  });

  it('parses SACHET-shaped sibling polygons under one <alert>', () => {
    const xml = `<alert>
<identifier>1234567890</identifier>
<polygon>30.32,78.03 30.33,78.05 30.30,78.08 30.32,78.03</polygon>
<polygon>29.95,78.13 29.98,78.16 29.94,78.19 29.95,78.13</polygon>
</alert>`;
    const result = parsePolygonDocument(xml);
    expect(result.trimmed).toBe(false);
    expect(result.rings).toHaveLength(2);
  });
});

describe('parseCapPolygon', () => {
  it('parses a valid closed ring', () => {
    const ring = parseCapPolygon('10,10 10,20 20,20 10,10');
    expect(ring).toEqual([
      [10, 10],
      [10, 20],
      [20, 20],
      [10, 10]
    ]);
  });

  it('returns null for fewer than 4 points', () => {
    expect(parseCapPolygon('10,10 10,20 20,20')).toBeNull();
  });

  it('returns null for an unclosed ring (does not auto-close)', () => {
    expect(parseCapPolygon('10,10 10,20 20,20 20,10')).toBeNull();
  });

  it('returns null for a non-numeric coordinate', () => {
    expect(parseCapPolygon('10,10 abc,20 20,20 10,10')).toBeNull();
  });

  it('returns null for NaN-producing input', () => {
    expect(parseCapPolygon('NaN,10 10,20 20,20 NaN,10')).toBeNull();
  });

  it('returns null for an out-of-range latitude', () => {
    expect(parseCapPolygon('95,10 10,20 20,20 95,10')).toBeNull();
  });

  it('returns null for an empty coordinate part rather than reading it as 0', () => {
    // `Number('')` is 0, so an unguarded parser would silently turn ",10"
    // into the valid coordinate (0, 10) in the Gulf of Guinea.
    expect(parseCapPolygon(',10 10,20 20,20 ,10')).toBeNull();
    expect(parseCapPolygon('10, 10,20 20,20 10,')).toBeNull();
  });
});

describe('selectPreferredInfo', () => {
  it('selects the first block whose language starts with preferLanguage, case-insensitively', () => {
    const info = [
      { language: 'HI', event: 'hindi' },
      { language: 'en-IN', event: 'english' }
    ];
    expect(selectPreferredInfo(info, 'EN')?.event).toBe('english');
  });

  it('falls back to the first block when no language matches', () => {
    const info = [{ language: 'fr', event: 'french' }, { language: 'de', event: 'german' }];
    expect(selectPreferredInfo(info, 'en')?.event).toBe('french');
  });

  it('returns undefined for undefined or empty info', () => {
    expect(selectPreferredInfo(undefined, 'en')).toBeUndefined();
    expect(selectPreferredInfo([], 'en')).toBeUndefined();
  });
});

describe('parseReferences', () => {
  it('extracts identifiers from sender,identifier,sent triples', () => {
    expect(parseReferences('A,ref-1,2020-01-01T00:00:00Z B,ref-2,2020-01-02T00:00:00Z')).toEqual([
      'ref-1',
      'ref-2'
    ]);
  });

  it('returns [] for undefined', () => {
    expect(parseReferences(undefined)).toEqual([]);
  });
});

describe('linkedPolygonUrl', () => {
  it('reads the Polygon URL parameter from the given info block', () => {
    const info = {
      parameter: [
        { valueName: 'Other', value: 'ignored' },
        { valueName: 'Polygon URL', value: 'https://example.test/poly' }
      ]
    };
    expect(linkedPolygonUrl(info)).toBe('https://example.test/poly');
  });

  it('returns undefined when there is no Polygon URL parameter', () => {
    expect(linkedPolygonUrl({})).toBeUndefined();
  });
});

describe('filterActiveCapWarnings', () => {
  it('excludes AllClear', () => {
    const w = makeWarning({ responseType: ['AllClear'], expires: FUTURE, status: 'Actual' });
    expect(filterActiveCapWarnings([w], new Date())).toEqual([]);
  });

  it('excludes Cancel', () => {
    const w = makeWarning({ msgType: 'Cancel', expires: FUTURE, status: 'Actual' });
    expect(filterActiveCapWarnings([w], new Date())).toEqual([]);
  });

  it('excludes expired warnings', () => {
    const w = makeWarning({ expires: PAST, status: 'Actual' });
    expect(filterActiveCapWarnings([w], new Date())).toEqual([]);
  });

  it('excludes non-Actual status (e.g. Exercise)', () => {
    const w = makeWarning({ status: 'Exercise', expires: FUTURE });
    expect(filterActiveCapWarnings([w], new Date())).toEqual([]);
  });

  it('excludes a warning superseded by a surviving Update', () => {
    const original = makeWarning({ identifier: 'ORIG-1', status: 'Actual', expires: FUTURE });
    const update = makeWarning({
      identifier: 'UPDATE-1',
      status: 'Actual',
      msgType: 'Update',
      expires: FUTURE,
      references: ['ORIG-1']
    });
    const result = filterActiveCapWarnings([original, update], new Date());
    expect(result.map(w => w.identifier)).toEqual(['UPDATE-1']);
  });

  it('keeps a warning with a missing/unparseable expires', () => {
    const w = makeWarning({ status: 'Actual' });
    expect(filterActiveCapWarnings([w], new Date())).toEqual([w]);
  });

  it('retires the advisory a PAGASA-style Final (Update + AllClear + references) points at', () => {
    const original = makeWarning({ identifier: 'GFA-1', status: 'Actual', msgType: 'Alert', expires: FUTURE });
    const final = makeWarning({
      identifier: 'GFA-1-FINAL',
      status: 'Actual',
      msgType: 'Update',
      responseType: ['AllClear'],
      references: ['GFA-1'],
      expires: FUTURE
    });
    const result = filterActiveCapWarnings([original, final], new Date());
    expect(result).toEqual([]);
  });

  it('makes an expired Update\'s references inert (the original reappears)', () => {
    const original = makeWarning({ identifier: 'ORIG-2', status: 'Actual', msgType: 'Alert', expires: FUTURE });
    const expiredUpdate = makeWarning({
      identifier: 'UPDATE-2',
      status: 'Actual',
      msgType: 'Update',
      expires: PAST,
      references: ['ORIG-2']
    });
    const result = filterActiveCapWarnings([original, expiredUpdate], new Date());
    expect(result.map(w => w.identifier)).toEqual(['ORIG-2']);
  });

  it('keeps numeric-looking identifiers as strings', () => {
    const w = makeWarning({ identifier: '1787460951822009', status: 'Actual', expires: FUTURE });
    const result = filterActiveCapWarnings([w], new Date());
    expect(result).toHaveLength(1);
    expect(typeof result[0].identifier).toBe('string');
    expect(result[0].identifier).toBe('1787460951822009');
  });
});
