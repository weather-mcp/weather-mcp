/**
 * Pure XML parsing utilities for the national CAP 1.2 alert feeds — SACHET
 * (India, NDMA), PAGASA (Philippines), and BMKG (Indonesia).
 *
 * Zero I/O, zero logging: XML strings in, typed records (or a thrown, fixed,
 * sanitized message) out. The service layer owns fetching, caching, and
 * deciding garnish-vs-contract failure handling; this module owns every
 * shape/size constant and every parsing decision that follows from field
 * names, never from position.
 *
 * Load-bearing behaviours, verified live and in scratch on 2026-08-23:
 * - `fast-xml-parser`'s own parser is lenient — `parse('<a><b></a>')` returns
 *   `{"a":{"b":""}}` without throwing — so it must never be the
 *   well-formedness check. `XMLValidator.validate` is the check, but it too
 *   has gaps: it *accepts* two distinct self-closing roots
 *   (`<rss>…</rss><feed/>`, `<a/><b/>`) and it *accepts* two self-closing
 *   roots that share a tag name (`<alert/><alert/>`, which the parser then
 *   silently coalesces into a single `alert` key holding an array). Only a
 *   post-parse structural check — exactly one non-PI root key, and that
 *   key's value is not an array — catches every case actually seen.
 * - SACHET documents use a `cap:` namespace prefix throughout and carry no
 *   `<?xml` prolog; PAGASA and BMKG use a default namespace and do have one.
 *   `removeNSPrefix: true` makes this transparent to every accessor here.
 * - RSS `<guid>`/Atom `<id>` may parse as a plain string or as
 *   `{ '#text': string, '@_...': string }` when the tag also carries
 *   attributes (SACHET's `<guid isPermaLink="false">…</guid>`) — every index
 *   field is read through a text-or-`#text` accessor, never a bare cast.
 * - An HTTP 200 HTML error page is a *shape* failure, not a DOCTYPE failure —
 *   it gets its own message so a caller doesn't have to pattern-match on the
 *   word "DOCTYPE" to recognise "this wasn't even trying to be CAP".
 *
 * Every thrown message here is fixed text — never the input XML, never a
 * raw parser error — so an oversize or malformed feed can't leak upstream
 * content into logs or user-facing errors.
 */

import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type {
  CapAlertArea,
  CapAlertDocument,
  CapAlertInfo,
  CapAlertParameter,
  CapIndexEntry,
  NationalCapFeed,
  NationalCapWarning,
  NormalizedCapIndexEntry
} from '../types/cap.js';

/** Maximum accepted byte size of a fetched CAP document or feed index. */
export const MAX_DOCUMENT_BYTES = 2_000_000;
/** Maximum number of entries kept from one feed index. */
export const MAX_INDEX_ITEMS = 200;
/** Maximum number of polygon rings kept for one warning's geometry. */
export const MAX_RINGS_PER_WARNING = 256;
/** Maximum number of coordinate pairs kept for one polygon ring. */
export const MAX_POINTS_PER_RING = 10_000;

/** Tag names fast-xml-parser must always coerce to an array, single-or-many. */
const ARRAY_TAGS = new Set([
  'info',
  'area',
  'polygon',
  'parameter',
  'geocode',
  'item',
  'entry',
  'link',
  'category',
  'responseType'
]);

/** One `XMLParser`, configured once at module scope — see the file header for why each option is set. */
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

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Text content of a node that may be a plain string, or `{ '#text': string,
 * '@_...': string }` when the tag also carries attributes (RSS `<guid
 * isPermaLink="...">`, Atom `<id>` variants).
 */
function textValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (isPlainObject(value) && typeof value['#text'] === 'string') {
    return value['#text'];
  }
  return undefined;
}

/**
 * Parse an XML document into an untyped structural tree, applying every
 * pre-parse guard in a fixed order and throwing a fixed, sanitized message —
 * never the input text, never a raw parser error — for any failure.
 */
export function parseXml(xml: string): unknown {
  // 1. Size guard — before anything else touches the string.
  if (Buffer.byteLength(xml) > MAX_DOCUMENT_BYTES) {
    throw new Error('CAP document too large');
  }

  // 2. Strip a BOM and any CDN-prepended leading whitespace before `<?xml`.
  //    Neither is a well-formedness failure worth failing a country on, but
  //    XMLValidator does reject an XML declaration that isn't the very
  //    first thing in the document.
  const stripped = xml.replace(/^\uFEFF/, '').trimStart();

  // 3. A 200 HTML error page — report it as *shape*, not as DOCTYPE.
  if (/^\s*(<!DOCTYPE\s+html|<html)/i.test(stripped)) {
    throw new Error('Alert feed returned an unexpected shape');
  }

  // 4. Any other DOCTYPE — these feeds never use one; defence in depth
  //    against entity expansion.
  if (/<!DOCTYPE/i.test(stripped)) {
    throw new Error('CAP document contains a DOCTYPE declaration');
  }

  // 5. The well-formedness check. The parser itself is lenient and must
  //    never be trusted for this (see file header).
  const validation = XMLValidator.validate(stripped);
  if (validation !== true) {
    throw new Error('CAP document is not well-formed XML');
  }

  // 6. Parse, wrapping any parser exception as the same not-well-formed
  //    message (defence in depth — XMLValidator should have already caught
  //    anything the parser itself would choke on).
  let parsed: unknown;
  try {
    parsed = parser.parse(stripped);
  } catch {
    throw new Error('CAP document is not well-formed XML');
  }

  if (!isPlainObject(parsed)) {
    throw new Error('CAP document is not well-formed XML');
  }

  // 7. Exactly one non-PI root key, and — because XMLValidator accepts two
  //    self-closing roots sharing one tag name (`<alert/><alert/>`, which
  //    the parser coalesces into a single `alert` key holding an array) —
  //    that key's value must not itself be an array. None of our three
  //    valid roots (`rss`, `feed`, `alert`) is legitimately an array at the
  //    top level, so this is a safe extra guard, not an over-restriction.
  const rootKeys = Object.keys(parsed).filter(key => !key.startsWith('?'));
  if (rootKeys.length !== 1 || Array.isArray(parsed[rootKeys[0]])) {
    throw new Error('CAP document is not well-formed XML');
  }

  return parsed;
}

/** Cap a raw items/entries array at `MAX_INDEX_ITEMS`, reporting whether it trimmed anything. */
function capIndexItems<T>(items: T[]): { items: T[]; trimmed: boolean } {
  if (items.length > MAX_INDEX_ITEMS) {
    return { items: items.slice(0, MAX_INDEX_ITEMS), trimmed: true };
  }
  return { items, trimmed: false };
}

/** First non-empty href of the Atom `link` array whose `@_type` is `application/cap+xml`, else the first link's href. */
function preferredAtomLink(value: unknown): string | undefined {
  const links = Array.isArray(value) ? value.filter(isPlainObject) : [];
  const capLink = links.find(link => link['@_type'] === 'application/cap+xml');
  const chosen = capLink ?? links.find(link => typeof link['@_href'] === 'string');
  return chosen ? asString(chosen['@_href']) : undefined;
}

/** First non-empty text value of an RSS `link` array. */
function firstLinkText(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return textValue(value);
  }
  for (const entry of value) {
    const text = textValue(entry);
    if (text) {
      return text;
    }
  }
  return undefined;
}

/** Atom `author`: `entry.author?.name` when it is an object, else the string, else `undefined` — never a non-string. */
function atomAuthor(value: unknown): string | undefined {
  if (isPlainObject(value)) {
    return asString(value.name);
  }
  return asString(value);
}

/**
 * Parse a CAP feed index (RSS or Atom) into flat entries, by field name
 * only. Root/envelope checks require an **exact** root↔kind pairing and a
 * non-null envelope object — an rss-configured feed that returns Atom (or
 * vice versa), or any other unexpected top shape, throws rather than
 * returning `[]`: a silent empty list on safety data is a fabricated
 * all-clear. A recognised envelope with no `item`/`entry` array is an
 * honest empty and returns normally.
 */
export function parseCapIndex(
  xml: string,
  kind: 'rss' | 'atom'
): { entries: CapIndexEntry[]; trimmed: boolean } {
  const parsed = parseXml(xml);
  if (!isPlainObject(parsed)) {
    throw new Error('Alert feed index has an unexpected shape');
  }

  if (kind === 'rss') {
    if (!('rss' in parsed) || !isPlainObject(parsed.rss)) {
      throw new Error('Alert feed index has an unexpected shape');
    }
    const rss = parsed.rss;
    if (!isPlainObject(rss.channel)) {
      throw new Error('Alert feed index has an unexpected shape');
    }
    const rawItems = Array.isArray(rss.channel.item) ? rss.channel.item.filter(isPlainObject) : [];
    const { items, trimmed } = capIndexItems(rawItems);
    const entries: CapIndexEntry[] = items.map(item => ({
      identifier: textValue(item.guid),
      documentUrl: firstLinkText(item.link),
      published: asString(item.pubDate),
      author: asString(item.author)
    }));
    return { entries, trimmed };
  }

  if (!('feed' in parsed) || !isPlainObject(parsed.feed)) {
    throw new Error('Alert feed index has an unexpected shape');
  }
  const feed = parsed.feed;
  const rawEntries = Array.isArray(feed.entry) ? feed.entry.filter(isPlainObject) : [];
  const { items, trimmed } = capIndexItems(rawEntries);
  const entries: CapIndexEntry[] = items.map(entry => ({
    identifier: textValue(entry.id),
    documentUrl: preferredAtomLink(entry.link),
    published: asString(entry.updated),
    author: atomAuthor(entry.author)
  }));
  return { entries, trimmed };
}

/**
 * Drop and count any index entry lacking a non-empty trimmed `identifier` or
 * `documentUrl`; dedupe duplicate identifiers, first wins. Only validated
 * values may become cache keys downstream.
 */
export function normalizeIndexEntries(
  entries: CapIndexEntry[]
): { entries: NormalizedCapIndexEntry[]; dropped: number } {
  const seen = new Set<string>();
  const result: NormalizedCapIndexEntry[] = [];
  let dropped = 0;

  for (const entry of entries) {
    const identifier = entry.identifier?.trim();
    const documentUrl = entry.documentUrl?.trim();
    if (!identifier || !documentUrl) {
      dropped += 1;
      continue;
    }
    if (seen.has(identifier)) {
      continue;
    }
    seen.add(identifier);
    result.push({
      identifier,
      documentUrl,
      published: entry.published,
      author: entry.author
    });
  }

  return { entries: result, dropped };
}

/**
 * Pure SSRF guard for every feed-supplied URL (index links, CAP document
 * URLs, SACHET `Polygon URL` parameters alike): `https:` only, hostname
 * **exactly** in the feed's allowlist (no port, no userinfo — a `user@host`
 * form is rejected), path starting with one of the feed's allowed prefixes.
 * Never throws.
 */
export function isAllowedFeedUrl(
  url: string,
  feed: Pick<NationalCapFeed, 'allowedHosts' | 'allowedPathPrefixes'>
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') {
    return false;
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return false;
  }
  // An explicit port is rejected even on an allowlisted host: the allowlist
  // authorises a published feed on 443, not every service that happens to
  // listen on another port behind the same hostname.
  if (parsed.port !== '') {
    return false;
  }
  if (!feed.allowedHosts.includes(parsed.hostname)) {
    return false;
  }
  return feed.allowedPathPrefixes.some(prefix => parsed.pathname.startsWith(prefix));
}

/** A CAP `<responseType>`-shaped array, always an array (possibly empty). */
function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function parseParameterArray(value: unknown): CapAlertParameter[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isPlainObject).map(node => ({
    valueName: asString(node.valueName),
    value: asString(node.value)
  }));
}

function parseAreaArray(value: unknown): CapAlertArea[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isPlainObject).map(node => ({
    areaDesc: asString(node.areaDesc),
    polygon: parseStringArray(node.polygon),
    geocode: node.geocode
  }));
}

function parseInfo(node: RawRecord): CapAlertInfo {
  return {
    language: asString(node.language),
    event: asString(node.event),
    responseType: parseStringArray(node.responseType),
    urgency: asString(node.urgency),
    severity: asString(node.severity),
    certainty: asString(node.certainty),
    effective: asString(node.effective),
    onset: asString(node.onset),
    expires: asString(node.expires),
    senderName: asString(node.senderName),
    headline: asString(node.headline),
    description: asString(node.description),
    instruction: asString(node.instruction),
    web: asString(node.web),
    parameter: parseParameterArray(node.parameter),
    area: parseAreaArray(node.area)
  };
}

function parseInfoArray(value: unknown): CapAlertInfo[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isPlainObject).map(parseInfo);
}

/**
 * Parse a CAP alert document. Root must be `alert` (any namespace prefix
 * already stripped) — else throws. `info[]`/`area[]`/`parameter[]`/
 * `polygon[]` are always arrays, never `undefined`, whether the source XML
 * had zero, one, or many.
 */
export function parseCapDocument(xml: string): CapAlertDocument {
  const parsed = parseXml(xml);
  if (!isPlainObject(parsed) || !isPlainObject(parsed.alert)) {
    throw new Error('CAP document has an unexpected shape');
  }
  const alert = parsed.alert;

  return {
    identifier: asString(alert.identifier),
    sender: asString(alert.sender),
    sent: asString(alert.sent),
    status: asString(alert.status),
    msgType: asString(alert.msgType),
    scope: asString(alert.scope),
    references: asString(alert.references),
    info: parseInfoArray(alert.info)
  };
}

/**
 * Run every ring text through `parseCapPolygon`, applying the ring cap and
 * counting the rings that failed to parse.
 *
 * `failed > 0` means the published geometry is only partly usable. The caller
 * must treat that set as **incomplete**: fine for a positive match, never
 * usable to decide that a warning does *not* cover a point. This is the same
 * rule the ring cap enforces below, reached through the other door — a
 * malformed `<polygon>` sibling rather than a 257th valid one.
 */
function buildRings(
  polygonTexts: string[]
): { rings: Array<Array<[number, number]>>; trimmed: boolean; failed: number } {
  const rings: Array<Array<[number, number]>> = [];
  let failed = 0;
  for (const text of polygonTexts) {
    const ring = parseCapPolygon(text);
    if (ring) {
      rings.push(ring);
    } else {
      failed += 1;
    }
  }
  // Ring-cap rule: a partial ring set must never be used for exclusion — a
  // point covered only by ring 257 must not read as "elsewhere". Keep none,
  // and say so, rather than silently truncating.
  if (rings.length > MAX_RINGS_PER_WARNING) {
    return { rings: [], trimmed: true, failed };
  }
  return { rings, trimmed: false, failed };
}

/**
 * Parse SACHET's separate linked-polygon document: `<alert><identifier/>
 * <polygon>…</polygon><polygon>…</polygon></alert>` siblings. Each ring
 * through `parseCapPolygon`; invalid rings are dropped silently — this may
 * legitimately return `rings: []` (the *service* decides what that means:
 * geometry unavailable). More than `MAX_RINGS_PER_WARNING` valid rings
 * keeps none and reports `trimmed: true`.
 */
export function parsePolygonDocument(
  xml: string
): { rings: Array<Array<[number, number]>>; trimmed: boolean; failed: number } {
  const parsed = parseXml(xml);
  if (!isPlainObject(parsed) || !isPlainObject(parsed.alert)) {
    throw new Error('CAP document has an unexpected shape');
  }
  return buildRings(parseStringArray(parsed.alert.polygon));
}

/**
 * Parse one CAP polygon string: whitespace-separated `"lat,lon"` pairs.
 * Never throws — returns `null` for fewer than 4 points, a non-finite
 * number, an out-of-range lat/lon, an **unclosed** ring (first point ≠ last
 * point — never auto-closed), or more than `MAX_POINTS_PER_RING` points.
 */
export function parseCapPolygon(text: string): Array<[number, number]> | null {
  const tokens = text.trim().split(/\s+/).filter(token => token.length > 0);
  if (tokens.length === 0 || tokens.length > MAX_POINTS_PER_RING || tokens.length < 4) {
    return null;
  }

  const points: Array<[number, number]> = [];
  for (const token of tokens) {
    const parts = token.split(',');
    if (parts.length !== 2) {
      return null;
    }
    // An empty part must be rejected explicitly: `Number('')` is 0, so a
    // malformed `",5"` would otherwise silently become the valid coordinate
    // 0 rather than failing the ring (the same null-coerces-to-0 trap the
    // project conventions call out).
    if (parts[0].trim() === '' || parts[1].trim() === '') {
      return null;
    }
    const lat = Number(parts[0]);
    const lon = Number(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return null;
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return null;
    }
    points.push([lat, lon]);
  }

  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return null;
  }

  return points;
}

/**
 * Select the language variant to render: the first block whose `language`
 * starts (case-insensitively) with `preferLanguage`, else the first block.
 * Generalised from `selectEnglishInfo` in `src/services/meteoalarm.ts:116`.
 * No script detection — a mislabelled `language` renders unmodified, same
 * as MeteoAlarm.
 */
export function selectPreferredInfo(
  info: CapAlertInfo[] | undefined,
  preferLanguage: string
): CapAlertInfo | undefined {
  if (!info || info.length === 0) {
    return undefined;
  }
  const preferred = preferLanguage.toLowerCase();
  return info.find(entry => (entry.language ?? '').toLowerCase().startsWith(preferred)) ?? info[0];
}

/**
 * Extract the referenced identifiers from a CAP `references` value: a
 * space-separated list of `sender,identifier,sent` triples. Entries without
 * a comma are taken as bare identifiers (permissive — feeds vary).
 *
 * Deliberate copy of `parseReferences` in `src/services/meteoalarm.ts`
 * (lines 145-161) rather than a shared import: this is a pure util and must
 * not import a service module, and the MeteoAlarm path — including its
 * existing tests — is locked and must not change to accommodate this
 * feature.
 */
export function parseReferences(references: string | undefined): string[] {
  if (!references) {
    return [];
  }
  const identifiers: string[] = [];
  for (const triple of references.trim().split(/\s+/)) {
    if (!triple) {
      continue;
    }
    const parts = triple.split(',');
    const identifier = parts.length >= 2 ? parts[1] : parts[0];
    if (identifier) {
      identifiers.push(identifier);
    }
  }
  return identifiers;
}

/** The selected info block's `parameter` whose `valueName === 'Polygon URL'` (SACHET). */
export function linkedPolygonUrl(info: CapAlertInfo): string | undefined {
  return info.parameter?.find(parameter => parameter.valueName === 'Polygon URL')?.value;
}

/**
 * Flatten a parsed CAP document to a single-language-variant warning.
 * Returns `undefined` when there is no identifier or no info block — a
 * document-shape failure the caller must count as unavailable, not an
 * honest empty.
 *
 * `polygonSource: 'inline'` reads rings from every `area[].polygon[]` in the
 * *selected* info block. `polygonSource: 'linked-parameter'` sets
 * `linkedPolygonUrl` and leaves `polygons: []` for the service to fill after
 * fetching that URL.
 *
 * `polygonUnavailable`/`geometryTrimmed` are normally the service's call,
 * with one exception handled here: an inline document whose `<polygon>`
 * elements *all* failed to parse, or whose ring count exceeded
 * `MAX_RINGS_PER_WARNING`, sets `polygonUnavailable: true` (geometry was
 * published but is unusable/trimmed) — the trim case also sets
 * `geometryTrimmed: true`.
 */
export function flattenCapAlert(
  doc: CapAlertDocument,
  feed: Pick<NationalCapFeed, 'preferLanguage' | 'polygonSource'>,
  countryCode: string
): NationalCapWarning | undefined {
  if (!doc.identifier || !doc.info || doc.info.length === 0) {
    return undefined;
  }

  const info = selectPreferredInfo(doc.info, feed.preferLanguage);
  if (!info) {
    return undefined;
  }

  const areaDesc = (info.area ?? [])
    .map(area => area.areaDesc)
    .filter((desc): desc is string => typeof desc === 'string' && desc.length > 0);

  const warning: NationalCapWarning = {
    identifier: doc.identifier,
    status: doc.status,
    msgType: doc.msgType,
    references: parseReferences(doc.references),
    event: info.event,
    severity: info.severity,
    urgency: info.urgency,
    certainty: info.certainty,
    onset: info.onset,
    effective: info.effective,
    expires: info.expires,
    sent: doc.sent,
    headline: info.headline,
    description: info.description,
    instruction: info.instruction,
    senderName: info.senderName,
    areaDesc,
    responseType: info.responseType,
    web: info.web,
    polygons: [],
    language: info.language,
    countryCode
  };

  if (feed.polygonSource === 'linked-parameter') {
    warning.linkedPolygonUrl = linkedPolygonUrl(info);
    return warning;
  }

  const polygonTexts = (info.area ?? []).flatMap(area => area.polygon ?? []);
  const { rings, trimmed, failed } = buildRings(polygonTexts);

  // Three cases, all of which mean "do not exclude on this geometry":
  // nothing parsed, the cap discarded the set, or *some* rings parsed and
  // some did not. The last one is the dangerous one — the survivors look
  // like a complete area, so a point inside a dropped ring would read as
  // "elsewhere" and the warning would vanish from the output entirely.
  if (polygonTexts.length > 0 && (rings.length === 0 || failed > 0)) {
    warning.polygonUnavailable = true;
    if (trimmed) {
      warning.geometryTrimmed = true;
    }
    if (failed > 0) {
      warning.ringsDropped = failed;
    }
  }
  warning.polygons = rings;

  return warning;
}

/**
 * Read-time filter pipeline, in this exact order:
 *  1. drop `status` present and ≠ `'Actual'`;
 *  2. drop `msgType === 'Cancel'`;
 *  3. drop expired `expires` (unparseable/missing → keep);
 *  4. build the superseded set from every *surviving* `msgType === 'Update'`
 *     — including `AllClear` ones;
 *  5. drop superseded;
 *  6. **last**, drop `responseType` containing `'AllClear'`.
 *
 * Steps 4-6 must run in this order: dropping AllClear before building the
 * superseded set (step 4) would leave a PAGASA-cancelled-but-still-unexpired
 * advisory live — PAGASA's "Final" advisory is itself `msgType: 'Update'` +
 * `responseType: ['AllClear']`, and *it* is the message that retires the
 * prior advisory via `references`. On SACHET, supersession is a no-op:
 * SACHET republishes a warning under a new numeric identifier with
 * `references` pointing at the prior version, but that prior version was
 * never independently indexed, so steps 4-5 never have anything to match —
 * only step 3 (expiry) or step 6 (an explicit AllClear) retires a SACHET
 * warning.
 */
export function filterActiveCapWarnings(warnings: NationalCapWarning[], now: Date): NationalCapWarning[] {
  const current = warnings.filter(warning => {
    if (warning.status !== undefined && warning.status !== 'Actual') {
      return false;
    }
    if (warning.msgType === 'Cancel') {
      return false;
    }
    if (warning.expires) {
      const expires = new Date(warning.expires);
      if (!isNaN(expires.getTime()) && expires.getTime() <= now.getTime()) {
        return false;
      }
    }
    return true;
  });

  const superseded = new Set<string>();
  for (const warning of current) {
    if (warning.msgType === 'Update') {
      for (const identifier of warning.references) {
        superseded.add(identifier);
      }
    }
  }

  const afterSupersession = current.filter(warning => !superseded.has(warning.identifier));

  return afterSupersession.filter(warning => !(warning.responseType ?? []).includes('AllClear'));
}
