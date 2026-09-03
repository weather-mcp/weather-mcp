import { describe, it, expect } from 'vitest';
import {
  parseJmaIndex,
  parseJmaWarningDocument,
  JMA_MAX_INDEX_BYTES,
  JMA_CLASS10_WARNING_LEVEL
} from '../../src/utils/jmaParse.js';

// ---------------------------------------------------------------------------
// Inline XML builders — no fixture files (see plan T6).
// ---------------------------------------------------------------------------

/** One Atom `<entry>` for the long-term index. */
function indexEntry(opts: {
  href: string;
  title?: string;
  updated?: string;
  id?: string;
  author?: string;
}): string {
  const { href, title = '気象特別警報・警報・注意報', updated = '2026-09-03T04:28:53Z', id, author = '福井地方気象台' } =
    opts;
  return `<entry>
<title>${title}</title>
<id>${id ?? href}</id>
<updated>${updated}</updated>
<author><name>${author}</name></author>
<link type="application/xml" href="${href}"/>
<content type="text">【福井県気象警報・注意報】…</content>
</entry>`;
}

/** The Atom feed envelope around zero or more entries. */
function indexFeed(entries: string[]): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" lang="ja">
<title>長期（随時）</title>
<updated>2026-09-03T13:29:22+09:00</updated>
${entries.join('\n')}
</feed>`;
}

/** A well-formed document filename matching the JMA convention. */
function docFilename(infoType: string, officeCode: string, ts = '20260903042854', seq = '0'): string {
  return `https://www.data.jma.go.jp/developer/xml/data/${ts}_${seq}_${infoType}_${officeCode}.xml`;
}

/** One `Kind` node inside an `Item`. */
function kindXml(opts: { name: string; code?: string; status?: string; condition?: string }): string {
  const { name, code, status, condition } = opts;
  return `<Kind><Name>${name}</Name>${code ? `<Code>${code}</Code>` : ''}${
    status ? `<Status>${status}</Status>` : ''
  }${condition ? `<Condition>${condition}</Condition>` : ''}</Kind>`;
}

/** One `Item` (one Area, many Kinds). */
function itemXml(opts: { areaName: string; areaCode: string; kinds: string[] }): string {
  return `<Item>${opts.kinds.join('')}<Area><Name>${opts.areaName}</Name><Code>${opts.areaCode}</Code></Area></Item>`;
}

/** One `Warning` block at a given granularity `type`, carrying zero or more `Item`s. */
function warningBlock(type: string, items: string[]): string {
  return `<Warning type="${type}">${items.join('')}</Warning>`;
}

const CLASS10_TYPE = '気象警報・注意報（一次細分区域等）';
const PREF_TYPE = '気象警報・注意報（府県予報区等）';
const GROUPED_TYPE = '気象警報・注意報（市町村等をまとめた地域等）';
const CITY_TYPE = '気象警報・注意報（市町村等）';

/** The `Report` envelope around a `Body` carrying the given `Warning` blocks. */
function reportDoc(opts: {
  warnings: string[];
  reportDateTime?: string;
  publishingOffice?: string;
  title?: string;
  infoType?: string;
  omitBody?: boolean;
}): string {
  const {
    warnings,
    reportDateTime = '2026-09-03T13:28:00+09:00',
    publishingOffice = '福井地方気象台',
    title = '福井県気象警報・注意報',
    infoType = '発表',
    omitBody = false
  } = opts;
  const body = omitBody ? '' : `<Body>${warnings.join('')}</Body>`;
  return `<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
<Control><Title>気象特別警報・警報・注意報</Title><PublishingOffice>${publishingOffice}</PublishingOffice></Control>
<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/">
<Title>${title}</Title>
<ReportDateTime>${reportDateTime}</ReportDateTime>
<InfoType>${infoType}</InfoType>
<Headline><Text>…</Text><Information type="…">…</Information></Headline>
</Head>
${body}
</Report>`;
}

describe('parseJmaIndex', () => {
  it('parses a well-formed index into entries with infoType/officeCode from the filename', () => {
    const xml = indexFeed([
      indexEntry({ href: docFilename('VPWW53', '180000') }),
      indexEntry({ href: docFilename('VPWW53', '140000') })
    ]);
    const result = parseJmaIndex(xml);
    expect(result.totalEntries).toBe(2);
    expect(result.entries[0]).toMatchObject({ infoType: 'VPWW53', officeCode: '180000' });
    expect(result.entries[1]).toMatchObject({ infoType: 'VPWW53', officeCode: '140000' });
    expect(result.unparsedEntries).toBe(0);
    expect(result.trimmed).toBe(false);
  });

  it('derives infoType from the filename, never the title — a misleading title with the right filename', () => {
    // Title uses old-schema wording; filename says VPWW53. Filename wins.
    const xml = indexFeed([
      indexEntry({
        href: docFilename('VPWW53', '180000'),
        title: '気象警報・注意報（Ｈ２７）'
      })
    ]);
    const result = parseJmaIndex(xml);
    expect(result.entries[0].infoType).toBe('VPWW53');
  });

  it('derives infoType from the filename, never the title — warning vocabulary in the title with an unrelated filename', () => {
    // Title contains warning vocabulary; filename says a different bulletin type. Filename wins.
    const xml = indexFeed([
      indexEntry({
        href: docFilename('VPFJ50', '180000'),
        title: '気象特別警報・警報・注意報'
      })
    ]);
    const result = parseJmaIndex(xml);
    expect(result.entries[0].infoType).toBe('VPFJ50');
    expect(result.entries[0].infoType).not.toBe('VPWW53');
  });

  it('throws when the root is not feed, rather than returning an empty result (G4)', () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title></channel></rss>`;
    expect(() => parseJmaIndex(xml)).toThrow('JMA index has an unexpected root element');
  });

  it('returns an honest empty for <feed/> with no entries, and does not throw (G4, the other half)', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`;
    const result = parseJmaIndex(xml);
    expect(result.entries).toEqual([]);
    expect(result.totalEntries).toBe(0);
    expect(result.unparsedEntries).toBe(0);
  });

  it('keeps an entry whose filename does not match the convention, with infoType/officeCode undefined, counted in unparsedEntries', () => {
    const xml = indexFeed([
      indexEntry({ href: 'https://www.data.jma.go.jp/developer/xml/data/not-a-jma-filename.xml' }),
      indexEntry({ href: docFilename('VPWW53', '180000') })
    ]);
    const result = parseJmaIndex(xml);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].infoType).toBeUndefined();
    expect(result.entries[0].officeCode).toBeUndefined();
    expect(result.entries[0].documentUrl).toBe(
      'https://www.data.jma.go.jp/developer/xml/data/not-a-jma-filename.xml'
    );
    expect(result.unparsedEntries).toBe(1);
  });

  it('throws a fixed message, never echoing the input, for an HTML error page', () => {
    const html = '<!DOCTYPE html><html><body>503 Service Unavailable</body></html>';
    try {
      parseJmaIndex(html);
      throw new Error('expected parseJmaIndex to throw');
    } catch (error) {
      expect((error as Error).message).toBe('JMA index returned an unexpected shape');
      expect((error as Error).message).not.toContain('503');
      expect((error as Error).message).not.toContain('Service Unavailable');
    }
  });

  it('throws a fixed message for a DOCTYPE declaration', () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE feed [<!ENTITY x "y">]><feed></feed>`;
    expect(() => parseJmaIndex(xml)).toThrow('JMA index contains a DOCTYPE declaration');
  });

  it('throws a fixed message for malformed XML', () => {
    const xml = `<?xml version="1.0"?><feed><entry><title>Unclosed</entry></feed>`;
    expect(() => parseJmaIndex(xml)).toThrow('JMA index is not well-formed XML');
  });

  it('throws a fixed message for two self-closing roots', () => {
    const xml = `<?xml version="1.0"?><feed/><feed/>`;
    expect(() => parseJmaIndex(xml)).toThrow('JMA index is not well-formed XML');
  });

  it('throws a fixed message for two self-closing roots with different tag names', () => {
    const xml = `<?xml version="1.0"?><feed/><other/>`;
    expect(() => parseJmaIndex(xml)).toThrow('JMA index is not well-formed XML');
  });

  it('throws the too-large message for an index over JMA_MAX_INDEX_BYTES', () => {
    const filler = 'x'.repeat(JMA_MAX_INDEX_BYTES + 1);
    const xml = `<?xml version="1.0"?><feed><!--${filler}--></feed>`;
    expect(() => parseJmaIndex(xml)).toThrow('JMA index too large');
  });
});

describe('parseJmaWarningDocument', () => {
  it('parses reportDateTime, publishingOffice, title, infoType and class10 areas with kinds', () => {
    const xml = reportDoc({
      warnings: [
        warningBlock(CLASS10_TYPE, [
          itemXml({
            areaName: '嶺北',
            areaCode: '180010',
            kinds: [
              kindXml({ name: '大雨注意報', code: '10', status: '継続' }),
              kindXml({ name: '雷注意報', code: '14', status: '継続' })
            ]
          })
        ])
      ]
    });
    const doc = parseJmaWarningDocument(xml);
    expect(doc.reportDateTime).toBe('2026-09-03T13:28:00+09:00');
    expect(doc.publishingOffice).toBe('福井地方気象台');
    expect(doc.title).toBe('福井県気象警報・注意報');
    expect(doc.infoType).toBe('発表');
    expect(doc.areas).toEqual([
      {
        code: '180010',
        name: '嶺北',
        kinds: [
          { name: '大雨注意報', code: '10', status: '継続' },
          { name: '雷注意報', code: '14', status: '継続' }
        ]
      }
    ]);
  });

  it('reads only the class10 level even when all five sibling levels carry distinguishable warnings (double-render guard)', () => {
    const xml = reportDoc({
      warnings: [
        warningBlock(PREF_TYPE, [
          itemXml({ areaName: '福井県', areaCode: '180000', kinds: [kindXml({ name: 'PREFECTURE-LEVEL' })] })
        ]),
        warningBlock(CLASS10_TYPE, [
          itemXml({ areaName: '嶺北', areaCode: '180010', kinds: [kindXml({ name: 'CLASS10-LEVEL' })] })
        ]),
        warningBlock(GROUPED_TYPE, [
          itemXml({ areaName: 'グループ', areaCode: '1801000', kinds: [kindXml({ name: 'GROUPED-LEVEL' })] })
        ]),
        warningBlock(CITY_TYPE, [
          itemXml({ areaName: '福井市', areaCode: '18201', kinds: [kindXml({ name: 'CITY-LEVEL' })] })
        ])
      ]
    });
    const doc = parseJmaWarningDocument(xml);
    expect(doc.areas).toHaveLength(1);
    expect(doc.areas[0].name).toBe('嶺北');
    expect(doc.areas[0].kinds.map(k => k.name)).toEqual(['CLASS10-LEVEL']);
    // Sanity: prove the level substring is what discriminates, not a fluke of order.
    expect(JMA_CLASS10_WARNING_LEVEL).toBe('一次細分区域');
  });

  it('throws when Body is missing entirely', () => {
    const xml = reportDoc({ warnings: [], omitBody: true });
    expect(() => parseJmaWarningDocument(xml)).toThrow('JMA warning document is missing its body');
  });

  it('throws when Body carries no Warning at all', () => {
    const xml = reportDoc({ warnings: [] });
    expect(() => parseJmaWarningDocument(xml)).toThrow('JMA warning document is missing its body');
  });

  it('throws when no Warning block is the class10 level', () => {
    const xml = reportDoc({
      warnings: [
        warningBlock(PREF_TYPE, [
          itemXml({ areaName: '福井県', areaCode: '180000', kinds: [kindXml({ name: '大雨警報' })] })
        ])
      ]
    });
    expect(() => parseJmaWarningDocument(xml)).toThrow('JMA warning document has no area-level warning block');
  });

  it('returns an honest empty areas array for a class10 block with no Items', () => {
    const xml = reportDoc({ warnings: [warningBlock(CLASS10_TYPE, [])] });
    const doc = parseJmaWarningDocument(xml);
    expect(doc.areas).toEqual([]);
  });

  it('carries Status through verbatim on every kind, including 解除 (lifted)', () => {
    const xml = reportDoc({
      warnings: [
        warningBlock(CLASS10_TYPE, [
          itemXml({
            areaName: '嶺北',
            areaCode: '180010',
            kinds: [
              kindXml({ name: '大雨警報', code: '03', status: '解除' }),
              kindXml({ name: '雷注意報', code: '14', status: '発表' }),
              kindXml({ name: '強風注意報', code: '15', status: '警報から注意報' })
            ]
          })
        ])
      ]
    });
    const doc = parseJmaWarningDocument(xml);
    expect(doc.areas[0].kinds.map(k => k.status)).toEqual(['解除', '発表', '警報から注意報']);
  });

  it('carries the bare quiet marker through as a name-less, code-less kind', () => {
    // JMA encodes "nothing in force here" as a Kind with only a Status. The
    // parser's job is to carry it verbatim — deciding it is not a warning is
    // the handler's (see tests/unit/alerts-jma.test.ts). Pinned here so a
    // future parser that drops name-less kinds cannot do it silently.
    const xml = reportDoc({
      warnings: [
        warningBlock(CLASS10_TYPE, [
          itemXml({
            areaName: '小笠原諸島',
            areaCode: '130040',
            kinds: ['<Kind><Status>発表警報・注意報はなし</Status></Kind>']
          })
        ])
      ]
    });
    const doc = parseJmaWarningDocument(xml);
    expect(doc.areas[0].kinds).toEqual([
      { name: undefined, code: undefined, status: '発表警報・注意報はなし', condition: undefined }
    ]);
  });

  it('captures Condition, including the compound 土砂災害、浸水害', () => {
    const xml = reportDoc({
      warnings: [
        warningBlock(CLASS10_TYPE, [
          itemXml({
            areaName: '嶺北',
            areaCode: '180010',
            kinds: [
              kindXml({ name: '大雨警報', status: '継続', condition: '土砂災害、浸水害' }),
              kindXml({ name: '洪水警報', status: '継続', condition: '浸水害' })
            ]
          })
        ])
      ]
    });
    const doc = parseJmaWarningDocument(xml);
    expect(doc.areas[0].kinds[0].condition).toBe('土砂災害、浸水害');
    expect(doc.areas[0].kinds[1].condition).toBe('浸水害');
  });

  it('throws when the root is not Report', () => {
    const xml = `<?xml version="1.0"?><NotReport><Body/></NotReport>`;
    expect(() => parseJmaWarningDocument(xml)).toThrow('JMA warning document has an unexpected root element');
  });
});
