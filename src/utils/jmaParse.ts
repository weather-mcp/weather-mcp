/**
 * Pure XML parsing for JMA's disaster-prevention feed — the Atom index and a
 * VPWW53 warning document.
 *
 * Zero I/O, zero logging: XML strings in, typed records (or a thrown, fixed,
 * sanitized message) out. The service layer owns fetching, caching, revalidation
 * and the contract-vs-garnish decision; this module owns every shape and size
 * constant and every parsing decision, which follow from **field names, never
 * from position**.
 *
 * **This is JMA's own H27 schema, not CAP.** `src/utils/capParse.ts` does not
 * apply and is not called from here. What *is* deliberately reused is its
 * guard sequence and parser configuration, reproduced below with JMA wording,
 * because the index needs its own byte cap (5.27 MB observed against CAP's
 * 2 MB `MAX_DOCUMENT_BYTES`) and every thrown message must name JMA rather than
 * CAP. The order of the guards is the load-bearing part and is identical:
 *
 *   size -> BOM/whitespace strip -> HTML error page -> DOCTYPE ->
 *   `XMLValidator.validate` -> parse -> exactly one non-array, non-PI root key.
 *
 * Two of those exist because `fast-xml-parser` cannot be trusted for
 * well-formedness on its own (G3): its parser is lenient (`<a><b></a>` parses
 * without throwing), and `XMLValidator` *accepts* several documents that are
 * not one root — two self-closing roots, and two self-closing roots sharing a
 * tag name, which the parser then coalesces into one key holding an array. Only
 * the post-parse structural check catches every case.
 *
 * **An unusable envelope throws; a recognised envelope with nothing in it
 * returns an honest empty (G4).** A feed whose root is not `feed`, or a
 * document with no `Body`, or a document whose `Body` carries no class10
 * `Warning` block, is a *shape* failure and throws — it is not "no warnings".
 * A class10 `Warning` block with no `Item`s is a genuine empty and returns
 * normally. On safety data those are different sentences and the caller must
 * be able to tell them apart.
 *
 * Every thrown message is fixed text — never the input XML, never a raw parser
 * error — so a malformed or oversize feed cannot leak upstream content into
 * logs or user-facing errors.
 *
 * Verified live 2026-09-03 against `feed/extra_l.xml` and 14 VPWW53 documents
 * from 14 distinct offices.
 */

import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type {
  JmaIndexEntry,
  JmaIndexResult,
  JmaWarningArea,
  JmaWarningDocument,
  JmaWarningKind
} from '../types/jma.js';

/**
 * Maximum accepted byte size of the Atom index.
 *
 * The long-term index decompressed to **5,267,421 bytes** on 2026-09-03, so
 * CAP's 2 MB `MAX_DOCUMENT_BYTES` cannot be reused for it. 12 MB leaves better
 * than 2x headroom for growth while still refusing anything that is no longer
 * an index.
 *
 * These constants live in this pure module and are imported by the service,
 * never the other way round (CLAUDE.md design pattern 6, and the same placement
 * `capParse.ts` uses).
 */
export const JMA_MAX_INDEX_BYTES = 12_000_000;

/** Maximum accepted byte size of one warning document. Observed: 25 KB; the plan's earlier sample, 171 KB. */
export const JMA_MAX_DOCUMENT_BYTES = 2_000_000;

/**
 * Maximum number of `<entry>` elements kept from one index.
 *
 * The live index carried 8,597 entries over seven days. A trim is a **caveat
 * the caller renders, never a reason to exclude an office** (G8) — see
 * `JmaIndexResult.trimmed`.
 */
export const JMA_MAX_INDEX_ENTRIES = 20_000;

/** Maximum number of class10 areas kept from one warning document. Observed: 2-8. */
export const JMA_MAX_AREAS_PER_DOCUMENT = 500;

/** Maximum number of kinds kept for one area. Observed: 1-6. */
export const JMA_MAX_KINDS_PER_AREA = 100;

/**
 * The bulletin type this feature reads.
 *
 * Measured over seven days: VPWW53 carries 2,515 entries covering **all 58
 * offices**, and no office publishes VPWW54 (also 2,515 entries) or an R06
 * split without also publishing VPWW53. It is therefore the correct and
 * complete single source, and consuming any second type would double-render
 * every warning.
 */
export const JMA_WARNING_INFO_TYPE = 'VPWW53';

/**
 * Substring identifying the class10 (`一次細分区域等`, "primary subdivision
 * areas") granularity level among a document's five sibling `Warning` blocks.
 *
 * Matched as a substring rather than by equality because the surrounding label
 * differs between the `Head` summary and the `Body`
 * (`気象警報・注意報（一次細分区域等）`), and because a schema generation that
 * re-words the prefix should not silently drop the level and render an empty
 * document as "no warnings".
 */
export const JMA_CLASS10_WARNING_LEVEL = '一次細分区域';

/** Tag names `fast-xml-parser` must always coerce to an array, single-or-many. */
const ARRAY_TAGS = new Set(['entry', 'link', 'Warning', 'Item', 'Kind', 'Area', 'Information']);

/** One `XMLParser`, configured once at module scope — the same options `capParse.ts` uses. */
const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  isArray: (name: string) => ARRAY_TAGS.has(name)
});

/** Loosely-typed parsed-XML node, narrowed with `isPlainObject` before any field access. */
type RawRecord = Record<string, unknown>;

function isPlainObject(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Text content of a node that may be a plain string, or `{ '#text': string,
 * '@_...': string }` when the tag also carries attributes.
 *
 * Returns `undefined` for an empty or whitespace-only value, so `<EventID/>`
 * and `<Serial/>` — both routinely empty in a real VPWW53 — read as absent
 * rather than as the empty string.
 */
function textValue(value: unknown): string | undefined {
  let raw: string | undefined;
  if (typeof value === 'string') {
    raw = value;
  } else if (isPlainObject(value) && typeof value['#text'] === 'string') {
    raw = value['#text'];
  }
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/** Coerce a possibly-single node to an array, dropping non-objects. */
function asRecordArray(value: unknown): RawRecord[] {
  if (Array.isArray(value)) {
    return value.filter(isPlainObject);
  }
  return isPlainObject(value) ? [value] : [];
}

/**
 * Parse a JMA XML document into an untyped structural tree, applying every
 * pre-parse guard in a fixed order and throwing a fixed, sanitized message.
 *
 * `maxBytes` differs between the index and a document, which is the reason this
 * is not simply `capParse.parseXml`.
 */
function parseJmaXml(xml: string, maxBytes: number, label: string): RawRecord {
  // 1. Size guard — before anything else touches the string.
  if (Buffer.byteLength(xml) > maxBytes) {
    throw new Error(`JMA ${label} too large`);
  }

  // 2. Strip a BOM and any CDN-prepended leading whitespace before `<?xml`.
  //    XMLValidator rejects an XML declaration that is not the very first
  //    thing in the document.
  const stripped = xml.replace(/^﻿/, '').trimStart();

  // 3. A 200 HTML error page — reported as *shape*, so a caller need not
  //    pattern-match on the word "DOCTYPE" to recognise "this was not even
  //    trying to be XML".
  if (/^\s*(<!DOCTYPE\s+html|<html)/i.test(stripped)) {
    throw new Error(`JMA ${label} returned an unexpected shape`);
  }

  // 4. Any other DOCTYPE — these feeds never use one; defence in depth
  //    against entity expansion.
  if (/<!DOCTYPE/i.test(stripped)) {
    throw new Error(`JMA ${label} contains a DOCTYPE declaration`);
  }

  // 5. The well-formedness check. The parser itself is lenient and must never
  //    be trusted for this (G3).
  if (XMLValidator.validate(stripped) !== true) {
    throw new Error(`JMA ${label} is not well-formed XML`);
  }

  // 6. Parse, wrapping any parser exception as the same message — defence in
  //    depth; XMLValidator should already have caught anything the parser
  //    would choke on.
  let parsed: unknown;
  try {
    parsed = parser.parse(stripped);
  } catch {
    throw new Error(`JMA ${label} is not well-formed XML`);
  }

  if (!isPlainObject(parsed)) {
    throw new Error(`JMA ${label} is not well-formed XML`);
  }

  // 7. Exactly one non-PI root key, and that key's value must not itself be
  //    an array — XMLValidator accepts two self-closing roots sharing a tag
  //    name, which the parser coalesces into one key holding an array (G3).
  const rootKeys = Object.keys(parsed).filter(key => !key.startsWith('?'));
  if (rootKeys.length !== 1 || Array.isArray(parsed[rootKeys[0]])) {
    throw new Error(`JMA ${label} is not well-formed XML`);
  }

  return parsed;
}

/**
 * Derive the bulletin type and publishing office from a document URL's
 * filename.
 *
 * `…/20260903042854_0_VPWW53_180000.xml` -> `{ infoType: 'VPWW53',
 * officeCode: '180000' }`.
 *
 * Returns `undefined` when the filename does not match, which the caller
 * counts rather than discards — see `JmaIndexEntry`.
 */
function parseDocumentFilename(url: string): { infoType: string; officeCode: string } | undefined {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return undefined;
  }
  const filename = pathname.slice(pathname.lastIndexOf('/') + 1);
  const match = /^\d{14}_\d+_([A-Z][A-Z0-9]*)_([0-9A-Za-z]+)\.xml$/.exec(filename);
  if (!match) {
    return undefined;
  }
  return { infoType: match[1], officeCode: match[2] };
}

/** The `href` of an entry's `application/xml` link, else the first link carrying one. */
function entryLinkHref(value: unknown): string | undefined {
  const links = asRecordArray(value);
  const typed = links.find(link => link['@_type'] === 'application/xml');
  const chosen = typed ?? links.find(link => typeof link['@_href'] === 'string');
  return chosen && typeof chosen['@_href'] === 'string' ? chosen['@_href'] : undefined;
}

/**
 * Parse the Atom index into flat entries.
 *
 * Throws when the envelope is wrong — a root that is not `feed` is a shape
 * failure, **not** an empty feed (G4). A `feed` with no entries returns an
 * honest empty result.
 */
export function parseJmaIndex(xml: string): JmaIndexResult {
  const parsed = parseJmaXml(xml, JMA_MAX_INDEX_BYTES, 'index');

  // Step 7 above already proved there is exactly one non-PI root key, so this
  // decides *which* envelope we were handed, not how many.
  if (!('feed' in parsed)) {
    throw new Error('JMA index has an unexpected root element');
  }

  // `<feed/>` and `<feed></feed>` parse to the string `''`, not to an object.
  // That is a recognised envelope carrying nothing — an honest empty index, not
  // a shape failure (G4). Only a *different* root is a shape failure.
  const feed = parsed['feed'];
  const feedRecord: RawRecord = isPlainObject(feed) ? feed : {};

  const rawEntries = asRecordArray(feedRecord['entry']);
  const totalEntries = rawEntries.length;
  const trimmed = totalEntries > JMA_MAX_INDEX_ENTRIES;
  const kept = trimmed ? rawEntries.slice(0, JMA_MAX_INDEX_ENTRIES) : rawEntries;

  const entries: JmaIndexEntry[] = [];
  let unparsedEntries = 0;

  for (const raw of kept) {
    // The link is preferred over `<id>`: both carry the URL in practice, but
    // `<id>` is nominally an identifier and only the link is nominally a
    // locator.
    const documentUrl = entryLinkHref(raw['link']) ?? textValue(raw['id']);
    if (!documentUrl) {
      unparsedEntries += 1;
      continue;
    }

    const filename = parseDocumentFilename(documentUrl);
    if (!filename) {
      unparsedEntries += 1;
    }

    entries.push({
      documentUrl,
      ...(filename ? { infoType: filename.infoType, officeCode: filename.officeCode } : {}),
      ...(textValue(raw['updated']) ? { updated: textValue(raw['updated']) } : {}),
      ...(textValue(raw['title']) ? { title: textValue(raw['title']) } : {})
    });
  }

  return { entries, totalEntries, unparsedEntries, trimmed };
}

/** Read one `Kind` node. Nothing is dropped — an unknown or lifted status is the renderer's call. */
function parseKind(raw: RawRecord): JmaWarningKind {
  const kind: JmaWarningKind = {};
  const name = textValue(raw['Name']);
  const code = textValue(raw['Code']);
  const status = textValue(raw['Status']);
  const condition = textValue(raw['Condition']);
  if (name !== undefined) kind.name = name;
  if (code !== undefined) kind.code = code;
  if (status !== undefined) kind.status = status;
  if (condition !== undefined) kind.condition = condition;
  return kind;
}

/**
 * Parse a VPWW53 warning document, reading **only** the class10
 * (`一次細分区域等`) granularity level.
 *
 * Throws when the envelope is unusable: no `Report` root, no `Body`, no
 * `Warning` blocks at all, or `Warning` blocks none of which is the class10
 * level. A class10 block carrying no `Item`s returns `areas: []` — an honest
 * empty for a document that really was fetched and really says nothing is in
 * force (G4).
 */
export function parseJmaWarningDocument(xml: string): JmaWarningDocument {
  const parsed = parseJmaXml(xml, JMA_MAX_DOCUMENT_BYTES, 'warning document');

  if (!('Report' in parsed)) {
    throw new Error('JMA warning document has an unexpected root element');
  }

  // Unlike the index, an empty envelope is not an honest empty here: a warning
  // document with no `Body` at all cannot say "nothing is in force", it can only
  // say "this is not the document I asked for". `<Report/>` parses to the
  // string `''` and falls through to the missing-body throw below.
  const report = parsed['Report'];
  const reportRecord: RawRecord = isPlainObject(report) ? report : {};

  const control = isPlainObject(reportRecord['Control']) ? reportRecord['Control'] : undefined;
  const head = isPlainObject(reportRecord['Head']) ? reportRecord['Head'] : undefined;
  const body = reportRecord['Body'];
  if (!isPlainObject(body)) {
    throw new Error('JMA warning document is missing its body');
  }

  const warnings = asRecordArray(body['Warning']);
  if (warnings.length === 0) {
    throw new Error('JMA warning document is missing its body');
  }

  // Exactly one of the five sibling levels. Reading a second would render
  // every warning twice, at two different geographic resolutions.
  const classTen = warnings.find(warning => {
    const type = warning['@_type'];
    return typeof type === 'string' && type.includes(JMA_CLASS10_WARNING_LEVEL);
  });
  if (!classTen) {
    throw new Error('JMA warning document has no area-level warning block');
  }

  const items = asRecordArray(classTen['Item']);
  const areas: JmaWarningArea[] = [];

  for (const item of items.slice(0, JMA_MAX_AREAS_PER_DOCUMENT)) {
    // One `Area` per `Item`; `Area` is in ARRAY_TAGS so it arrives as an array.
    const areaNode = asRecordArray(item['Area'])[0];
    if (!areaNode) {
      continue;
    }

    const kinds = asRecordArray(item['Kind'])
      .slice(0, JMA_MAX_KINDS_PER_AREA)
      .map(parseKind);

    const area: JmaWarningArea = { kinds };
    const code = textValue(areaNode['Code']);
    const name = textValue(areaNode['Name']);
    if (code !== undefined) area.code = code;
    if (name !== undefined) area.name = name;
    areas.push(area);
  }

  const document: JmaWarningDocument = { areas };
  const reportDateTime = head ? textValue(head['ReportDateTime']) : undefined;
  const publishingOffice = control ? textValue(control['PublishingOffice']) : undefined;
  const title = head ? textValue(head['Title']) : undefined;
  const infoType = head ? textValue(head['InfoType']) : undefined;
  if (reportDateTime !== undefined) document.reportDateTime = reportDateTime;
  if (publishingOffice !== undefined) document.publishingOffice = publishingOffice;
  if (title !== undefined) document.title = title;
  if (infoType !== undefined) document.infoType = infoType;
  return document;
}
